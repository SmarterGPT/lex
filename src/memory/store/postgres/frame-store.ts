import { createHash } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type {
  FrameStore,
  FrameSearchCriteria,
  FrameListOptions,
  FrameListResult,
  SaveResult,
  StoreStats,
  TurnCostMetrics,
  FrameStoreMetadata,
  FrameStoreHealth,
} from "../frame-store.js";
import type { Frame, FrameStatusSnapshot, FrameSpendMetadata } from "../../frames/types.js";
import { Frame as FrameSchema } from "../../frames/types.js";
import { type PostgresSchemaTargetV1 } from "../../../shared/runtime-scope/postgres-schema.js";
import { durableFrameMetadata, parseDurableFrameMetadata } from "../durable-frame-metadata.js";
import {
  createPostgresCompatibilitySchemaTarget,
  migratePostgresCompatibilityFrameStore,
  POSTGRES_COMPATIBILITY_FRAME_STORE_SCHEMA_VERSION,
} from "./compatibility-migrations.js";
import { buildPostgresTextSearchQuery } from "./search-query.js";

interface PaginationCursor {
  timestamp: string;
  frame_id: string;
}

export type PostgresFrameStoreAccessMode = "read-only" | "read-write";

export interface PostgresFrameStoreOptions {
  /** Defaults to read-write; read-only validates schema without running migrations. */
  accessMode?: PostgresFrameStoreAccessMode;
  /** Explicit PostgreSQL schema target. Defaults to public for 2.x compatibility. */
  schema?: string;
}

interface PostgresFrameRow extends QueryResultRow {
  id: string;
  timestamp: string;
  branch: string;
  jira: string | null;
  module_scope: string[];
  summary_caption: string;
  reference_point: string;
  status_snapshot: FrameStatusSnapshot | string;
  keywords: string[] | null;
  atlas_frame_id: string | null;
  feature_flags: string[] | null;
  permissions: string[] | null;
  module_attribution: Frame["module_attribution"] | string | null;
  run_id: string | null;
  plan_hash: string | null;
  spend: FrameSpendMetadata | string | null;
  user_id: string | null;
  superseded_by: string | null;
  merged_from: string[] | null;
  frame_metadata: Readonly<Record<string, unknown>> | string;
}

type FrameValue = string | string[] | object | null;

const FRAME_COLUMNS = `
  id, "timestamp" AS timestamp, branch, jira, module_scope, summary_caption,
  reference_point, status_snapshot, keywords, atlas_frame_id, feature_flags,
  permissions, module_attribution, run_id, plan_hash, spend, user_id,
  superseded_by, merged_from, frame_metadata
`;

function upsertFrameSql(target: PostgresSchemaTargetV1): string {
  return `
  INSERT INTO ${target.relation("frames")} (
    id, "timestamp", branch, jira, module_scope, summary_caption,
    reference_point, status_snapshot, keywords, atlas_frame_id, feature_flags,
    permissions, module_attribution, run_id, plan_hash, spend, user_id,
    superseded_by, merged_from, frame_metadata
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
    $15, $16, $17, $18, $19, $20
  )
  ON CONFLICT (id) DO UPDATE SET
    "timestamp" = EXCLUDED."timestamp",
    branch = EXCLUDED.branch,
    jira = EXCLUDED.jira,
    module_scope = EXCLUDED.module_scope,
    summary_caption = EXCLUDED.summary_caption,
    reference_point = EXCLUDED.reference_point,
    status_snapshot = EXCLUDED.status_snapshot,
    keywords = EXCLUDED.keywords,
    atlas_frame_id = EXCLUDED.atlas_frame_id,
    feature_flags = EXCLUDED.feature_flags,
    permissions = EXCLUDED.permissions,
    module_attribution = EXCLUDED.module_attribution,
    run_id = EXCLUDED.run_id,
    plan_hash = EXCLUDED.plan_hash,
    spend = EXCLUDED.spend,
    user_id = EXCLUDED.user_id,
    superseded_by = EXCLUDED.superseded_by,
    merged_from = EXCLUDED.merged_from,
    frame_metadata = EXCLUDED.frame_metadata
`;
}

function encodeCursor(timestamp: string, frameId: string): string {
  return Buffer.from(JSON.stringify({ timestamp, frame_id: frameId })).toString("base64");
}

function decodeCursor(cursor: string): PaginationCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as PaginationCursor;
    return typeof parsed.timestamp === "string" && typeof parsed.frame_id === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function parseJson<T>(value: T | string): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

function rowToFrame(row: PostgresFrameRow): Frame {
  return FrameSchema.parse({
    id: row.id,
    timestamp: row.timestamp,
    branch: row.branch,
    jira: row.jira ?? undefined,
    module_scope: row.module_scope,
    summary_caption: row.summary_caption,
    reference_point: row.reference_point,
    status_snapshot: parseJson(row.status_snapshot),
    keywords: row.keywords ?? undefined,
    atlas_frame_id: row.atlas_frame_id ?? undefined,
    feature_flags: row.feature_flags ?? undefined,
    permissions: row.permissions ?? undefined,
    module_attribution: row.module_attribution ? parseJson(row.module_attribution) : undefined,
    runId: row.run_id ?? undefined,
    planHash: row.plan_hash ?? undefined,
    spend: row.spend ? parseJson(row.spend) : undefined,
    userId: row.user_id ?? undefined,
    superseded_by: row.superseded_by ?? undefined,
    merged_from: row.merged_from ?? undefined,
    ...parseDurableFrameMetadata(row.frame_metadata),
  });
}

function frameValues(frame: Frame): FrameValue[] {
  return [
    frame.id,
    frame.timestamp,
    frame.branch,
    frame.jira ?? null,
    frame.module_scope,
    frame.summary_caption,
    frame.reference_point,
    frame.status_snapshot,
    frame.keywords ?? null,
    frame.atlas_frame_id ?? null,
    frame.feature_flags ?? null,
    frame.permissions ?? null,
    frame.module_attribution ?? null,
    frame.runId ?? null,
    frame.planHash ?? null,
    frame.spend ?? null,
    frame.userId ?? null,
    frame.superseded_by ?? null,
    frame.merged_from ?? null,
    durableFrameMetadata(frame),
  ];
}

interface ParsedPostgresLocation {
  location: string;
  hasEmbeddedPassword: boolean;
}

function parsePostgresLocation(connectionString: string): ParsedPostgresLocation {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("LEX_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("LEX_DATABASE_URL must use the postgres:// or postgresql:// protocol");
  }

  const username = url.username ? `${url.username}@` : "";
  const port = url.port ? `:${url.port}` : "";
  return {
    location: `${url.protocol}//${username}${url.hostname}${port}${url.pathname || "/"}`,
    hasEmbeddedPassword: url.password.length > 0,
  };
}

function postgresIdentity(location: string): string {
  return `postgres-v1:${createHash("sha256").update(location).digest("hex").slice(0, 16)}`;
}

function compatibilityIdentity(location: string, schema: string): string {
  return postgresIdentity(
    `${location}|schema=${schema}|contract=compat-v${POSTGRES_COMPATIBILITY_FRAME_STORE_SCHEMA_VERSION}`
  );
}

/** PostgreSQL-backed implementation of the complete FrameStore contract. */
export class PostgresFrameStore implements FrameStore {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;
  private readonly metadata: FrameStoreMetadata;
  private readonly _accessMode: PostgresFrameStoreAccessMode;
  private readonly target: PostgresSchemaTargetV1;
  private readonly upsertSql: string;
  private initialization: Promise<void> | null = null;
  private isClosed = false;

  constructor(connectionStringOrPool?: string | Pool, options: PostgresFrameStoreOptions = {}) {
    this._accessMode = options.accessMode ?? "read-write";
    this.target = createPostgresCompatibilitySchemaTarget(options.schema ?? "public");
    this.upsertSql = upsertFrameSql(this.target);
    if (typeof connectionStringOrPool === "object") {
      this.pool = connectionStringOrPool;
      this.ownsPool = false;
      const location = "postgresql://injected-pool";
      this.metadata = {
        backend: "postgres",
        location,
        canonicalLocation: location,
        identity: compatibilityIdentity(location, this.target.schema),
        capabilities: { encryption: false, images: false },
      };
      return;
    }

    const connectionString = connectionStringOrPool ?? process.env.LEX_DATABASE_URL;
    if (!connectionString) {
      throw new Error("LEX_DATABASE_URL is required when LEX_STORE=postgres");
    }
    const { location, hasEmbeddedPassword } = parsePostgresLocation(connectionString);
    const configuredMax = Number.parseInt(process.env.LEX_POSTGRES_POOL_MAX ?? "10", 10);
    let poolConnectionString = connectionString;
    if (!hasEmbeddedPassword && process.env.LEX_POSTGRES_PASSWORD) {
      const url = new URL(connectionString);
      url.password = process.env.LEX_POSTGRES_PASSWORD;
      poolConnectionString = url.toString();
    }
    this.pool = new Pool({
      connectionString: poolConnectionString,
      max: Number.isInteger(configuredMax) && configuredMax > 0 ? configuredMax : 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      allowExitOnIdle: true,
      application_name: "lex-frame-store",
    });
    this.ownsPool = true;
    this.metadata = {
      backend: "postgres",
      location,
      canonicalLocation: location,
      identity: compatibilityIdentity(location, this.target.schema),
      capabilities: { encryption: false, images: false },
    };
  }

  getMetadata(): FrameStoreMetadata {
    return this.metadata;
  }

  /** Whether this store permits mutation and automatic schema migration. */
  get accessMode(): PostgresFrameStoreAccessMode {
    return this._accessMode;
  }

  async getHealth(): Promise<FrameStoreHealth> {
    const checkedAt = new Date().toISOString();
    try {
      await this.ensureReady();
      const result = await this.pool.query<{
        schema_version: number | null;
        server_version: string;
        database: string;
      }>(`
        SELECT
          (SELECT MAX(version) FROM ${this.target.relation("lex_frame_store_migrations")}) AS schema_version,
          current_setting('server_version') AS server_version,
          current_database() AS database
      `);
      const row = result.rows[0];
      return {
        healthy: true,
        schemaVersion: String(row?.schema_version ?? 0),
        checkedAt,
        serverVersion: row?.server_version,
        database: row?.database,
      };
    } catch {
      return {
        healthy: false,
        schemaVersion: "unknown",
        checkedAt,
        message: "PostgreSQL health check failed",
      };
    }
  }

  private assertOpen(): void {
    if (this.isClosed) throw new Error("PostgresFrameStore is closed");
  }

  private assertWritable(): void {
    if (this._accessMode === "read-only") {
      throw new Error("PostgresFrameStore is read-only");
    }
  }

  private async verifySchema(client: PoolClient): Promise<void> {
    const result = await client.query<{ version: number | null }>(
      `SELECT MAX(version) AS version FROM ${this.target.relation("lex_frame_store_migrations")}`
    );
    const currentVersion = result.rows[0]?.version ?? 0;
    if (currentVersion !== POSTGRES_COMPATIBILITY_FRAME_STORE_SCHEMA_VERSION) {
      throw new Error(
        `PostgreSQL compatibility FrameStore schema ${currentVersion} is not the required schema ${POSTGRES_COMPATIBILITY_FRAME_STORE_SCHEMA_VERSION}; run an explicit writable Lex command to migrate it`
      );
    }
  }

  private async ensureReady(): Promise<void> {
    this.assertOpen();
    if (!this.initialization) {
      this.initialization = (async () => {
        try {
          const client = await this.pool.connect();
          try {
            if (this._accessMode === "read-only") await this.verifySchema(client);
            else await migratePostgresCompatibilityFrameStore(client, this.target.schema);
          } finally {
            client.release();
          }
        } catch (error) {
          // A transient startup failure must not poison this store forever.
          this.initialization = null;
          throw error;
        }
      })();
    }
    await this.initialization;
  }

  async saveFrame(frame: Frame): Promise<void> {
    this.assertWritable();
    await this.ensureReady();
    const parsed = FrameSchema.parse(frame);
    await this.pool.query(this.upsertSql, frameValues(parsed));
  }

  async saveFrames(frames: Frame[]): Promise<SaveResult[]> {
    this.assertOpen();
    this.assertWritable();
    for (const frame of frames) {
      const parsed = FrameSchema.safeParse(frame);
      if (!parsed.success) {
        return frames.map((candidate, index) => ({
          id: candidate.id ?? `frame-${index}`,
          success: false,
          error:
            candidate === frame
              ? `Validation failed: ${parsed.error.message}`
              : "Transaction aborted due to validation failure in another frame",
        }));
      }
    }

    await this.ensureReady();
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      await client.query("BEGIN");
      for (const frame of frames) await client.query(this.upsertSql, frameValues(frame));
      await client.query("COMMIT");
      return frames.map((frame) => ({ id: frame.id, success: true }));
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => undefined);
      const message = error instanceof Error ? error.message : "Unknown error";
      return frames.map((frame) => ({
        id: frame.id,
        success: false,
        error: `Transaction failed: ${message}`,
      }));
    } finally {
      client?.release();
    }
  }

  async getFrameById(id: string): Promise<Frame | null> {
    await this.ensureReady();
    const result = await this.pool.query<PostgresFrameRow>(
      `SELECT ${FRAME_COLUMNS} FROM ${this.target.relation("frames")} WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? rowToFrame(result.rows[0]) : null;
  }

  async searchFrames(criteria: FrameSearchCriteria): Promise<Frame[]> {
    await this.ensureReady();
    const clauses: string[] = [];
    const values: unknown[] = [];
    const add = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };

    const textSearch = buildPostgresTextSearchQuery(criteria);
    if (textSearch) {
      clauses.push(
        `search_vector @@ (` +
          `to_tsquery('simple', ${add(textSearch.normalizedTsQuery)}) || ` +
          `plainto_tsquery('simple', ${add(textSearch.rawPlainQuery)}))`
      );
    }
    if (criteria.moduleScope?.length) {
      clauses.push(`module_scope && ${add(criteria.moduleScope)}::text[]`);
    }
    if (criteria.branch !== undefined) clauses.push(`branch = ${add(criteria.branch)}`);
    if (criteria.since) clauses.push(`"timestamp" >= ${add(criteria.since.toISOString())}`);
    if (criteria.until) clauses.push(`"timestamp" <= ${add(criteria.until.toISOString())}`);
    if (criteria.userId) clauses.push(`user_id = ${add(criteria.userId)}`);

    let sql = `SELECT ${FRAME_COLUMNS} FROM ${this.target.relation("frames")}`;
    if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
    sql += ` ORDER BY "timestamp" DESC, id DESC`;
    if (criteria.limit !== undefined) sql += ` LIMIT ${add(criteria.limit)}`;

    const result = await this.pool.query<PostgresFrameRow>(sql, values);
    return result.rows.map(rowToFrame);
  }

  async listFrames(options?: FrameListOptions): Promise<FrameListResult> {
    await this.ensureReady();
    const limit = options?.limit ?? 10;
    const clauses: string[] = [];
    const values: unknown[] = [];
    const add = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };

    if (options?.cursor) {
      const cursor = decodeCursor(options.cursor);
      if (cursor) {
        clauses.push(`("timestamp", id) < (${add(cursor.timestamp)}, ${add(cursor.frame_id)})`);
      }
    }
    if (options?.userId) clauses.push(`user_id = ${add(options.userId)}`);

    let sql = `SELECT ${FRAME_COLUMNS} FROM ${this.target.relation("frames")}`;
    if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
    sql += ` ORDER BY "timestamp" DESC, id DESC LIMIT ${add(limit + 1)}`;
    if (!options?.cursor && options?.offset !== undefined) {
      sql += ` OFFSET ${add(options.offset)}`;
    }

    const result = await this.pool.query<PostgresFrameRow>(sql, values);
    const hasMore = result.rows.length > limit;
    const frames = result.rows.slice(0, limit).map(rowToFrame);
    const lastFrame = frames[frames.length - 1];
    return {
      frames,
      page: {
        limit,
        hasMore,
        nextCursor: hasMore && lastFrame ? encodeCursor(lastFrame.timestamp, lastFrame.id) : null,
      },
      order: { by: "timestamp", direction: "desc" },
    };
  }

  async deleteFrame(id: string): Promise<boolean> {
    this.assertWritable();
    await this.ensureReady();
    const result = await this.pool.query(
      `DELETE FROM ${this.target.relation("frames")} WHERE id = $1`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deleteFramesBefore(date: Date): Promise<number> {
    this.assertWritable();
    await this.ensureReady();
    const result = await this.pool.query(
      `DELETE FROM ${this.target.relation("frames")} WHERE "timestamp" < $1`,
      [date.toISOString()]
    );
    return result.rowCount ?? 0;
  }

  async deleteFramesByBranch(branch: string): Promise<number> {
    this.assertWritable();
    await this.ensureReady();
    const result = await this.pool.query(
      `DELETE FROM ${this.target.relation("frames")} WHERE branch = $1`,
      [branch]
    );
    return result.rowCount ?? 0;
  }

  async deleteFramesByModule(moduleId: string): Promise<number> {
    this.assertWritable();
    await this.ensureReady();
    const result = await this.pool.query(
      `DELETE FROM ${this.target.relation("frames")} WHERE $1 = ANY(module_scope)`,
      [moduleId]
    );
    return result.rowCount ?? 0;
  }

  async getFrameCount(): Promise<number> {
    await this.ensureReady();
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM ${this.target.relation("frames")}`
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async getStats(detailed = false): Promise<StoreStats> {
    await this.ensureReady();
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const result = await this.pool.query<{
      total_frames: string;
      this_week: string;
      this_month: string;
      oldest_date: string | null;
      newest_date: string | null;
    }>(
      `SELECT
        COUNT(*) AS total_frames,
        COUNT(*) FILTER (WHERE "timestamp" >= $1) AS this_week,
        COUNT(*) FILTER (WHERE "timestamp" >= $2) AS this_month,
        MIN("timestamp") AS oldest_date,
        MAX("timestamp") AS newest_date
       FROM ${this.target.relation("frames")}`,
      [oneWeekAgo.toISOString(), oneMonthAgo.toISOString()]
    );
    const row = result.rows[0];
    const stats: StoreStats = {
      totalFrames: Number(row?.total_frames ?? 0),
      thisWeek: Number(row?.this_week ?? 0),
      thisMonth: Number(row?.this_month ?? 0),
      oldestDate: row?.oldest_date ?? null,
      newestDate: row?.newest_date ?? null,
    };

    if (detailed && stats.totalFrames > 0) {
      const distribution = await this.pool.query<{ module_id: string; count: string }>(`
        SELECT module_id, COUNT(*) AS count
        FROM ${this.target.relation("frames")}, unnest(module_scope) AS module_id
        GROUP BY module_id
        ORDER BY COUNT(*) DESC, module_id ASC
        LIMIT 20
      `);
      stats.moduleDistribution = Object.fromEntries(
        distribution.rows.map((entry) => [entry.module_id, Number(entry.count)])
      );
    }
    return stats;
  }

  async getTurnCostMetrics(since?: string): Promise<TurnCostMetrics> {
    await this.ensureReady();
    const values: unknown[] = [];
    const where = since ? `WHERE "timestamp" >= $1` : "";
    if (since) values.push(since);
    const result = await this.pool.query<{
      frame_count: string;
      estimated_tokens: string | null;
      prompts: string | null;
    }>(
      `SELECT
        COUNT(*) AS frame_count,
        COALESCE(SUM((spend ->> 'tokens_estimated')::numeric), 0) AS estimated_tokens,
        COALESCE(SUM((spend ->> 'prompts')::numeric), 0) AS prompts
       FROM ${this.target.relation("frames")} ${where}`,
      values
    );
    const row = result.rows[0];
    return {
      frameCount: Number(row?.frame_count ?? 0),
      estimatedTokens: Number(row?.estimated_tokens ?? 0),
      prompts: Number(row?.prompts ?? 0),
    };
  }

  async updateFrame(
    id: string,
    updates: Partial<Omit<Frame, "id" | "timestamp">>
  ): Promise<boolean> {
    this.assertWritable();
    await this.ensureReady();
    const {
      id: _discardedId,
      timestamp: _discardedTimestamp,
      ...safeUpdates
    } = updates as typeof updates & Record<string, unknown>;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<PostgresFrameRow>(
        `SELECT ${FRAME_COLUMNS} FROM ${this.target.relation("frames")} WHERE id = $1 FOR UPDATE`,
        [id]
      );
      const row = existing.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return false;
      }
      const next = FrameSchema.parse({
        ...rowToFrame(row),
        ...safeUpdates,
        id: row.id,
        timestamp: row.timestamp,
      });
      const result = await client.query(this.upsertSql, frameValues(next));
      await client.query("COMMIT");
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async purgeSuperseded(): Promise<number> {
    this.assertWritable();
    await this.ensureReady();
    const result = await this.pool.query(
      `DELETE FROM ${this.target.relation("frames")} WHERE superseded_by IS NOT NULL`
    );
    return result.rowCount ?? 0;
  }

  async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    if (this.ownsPool) await this.pool.end();
  }
}
