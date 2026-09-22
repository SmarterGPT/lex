import Database from "better-sqlite3-multiple-ciphers";

import type { Frame, FrameSpendMetadata, FrameStatusSnapshot } from "../../frames/types.js";
import { Frame as FrameSchema } from "../../frames/types.js";
import type { FrameRow } from "../db.js";
import { openDatabaseForMaintenance } from "../db.js";
import { normalizeFTS5Query } from "../fts5-utils.js";
import { durableFrameMetadata, parseDurableFrameMetadata } from "../durable-frame-metadata.js";
import type {
  FrameListResult,
  FrameStoreHealth,
  FrameStoreMetadata,
  SaveResult,
  StoreStats,
  TurnCostMetrics,
} from "../frame-store.js";
import {
  FRAME_STORE_CAPABILITIES,
  FRAME_STORE_SCOPE_CONTRACT_VERSION,
  SCOPED_FRAME_STORE_ERROR_CODES,
  ScopedFrameStoreError,
  type FrameOwnershipV1,
  type FrameStoreAdmin,
  type FrameStoreAdminBinder,
  type FrameStoreCapability,
  type ScopedFrameInput,
  type ScopedFrameListOptions,
  type ScopedFrameSearchCriteria,
  type ScopedFrameStore,
  type ScopedFrameStoreBinder,
  type ScopedFrameUpdate,
} from "../scoped-frame-store.js";
import type { AuthorizedScopeV1, CapabilityId } from "../../../shared/runtime-scope/index.js";
import { RUNTIME_SCOPE_CONTRACT_VERSION } from "../../../shared/runtime-scope/index.js";
import {
  canonicalizeStorePath,
  createStoreIdentity,
} from "../../../shared/config/store-identity.js";
import {
  inspectScopedSqliteSchema,
  isCanonicalPersistedScopeId,
  requireHealthyScopedSqliteSchema,
  SCOPED_SQLITE_ERROR_CODES,
  SCOPED_SQLITE_SCHEMA_VERSION,
  ScopedSqliteError,
  type SqliteStoreScopeBindingV1,
} from "./scoped-schema.js";

interface PaginationCursor {
  readonly timestamp: string;
  readonly frame_id: string;
}

export interface SqliteScopedFrameStoreOptions {
  /** Defaults to read-write. Read-only views reject every mutation before SQL dispatch. */
  readonly accessMode?: "read-only" | "read-write";
  /** Deterministic expiry and statistics seam. */
  readonly now?: () => Date;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function immutableScope(scope: AuthorizedScopeV1): AuthorizedScopeV1 {
  if (
    !scope ||
    scope.schemaVersion !== RUNTIME_SCOPE_CONTRACT_VERSION ||
    !isNonEmptyString(scope.grantId) ||
    !isCanonicalPersistedScopeId(scope.tenantId) ||
    !isCanonicalPersistedScopeId(scope.workspaceId) ||
    !isCanonicalPersistedScopeId(scope.principalId) ||
    !Array.isArray(scope.capabilities) ||
    !scope.capabilities.every(isNonEmptyString) ||
    !isNonEmptyString(scope.authorityVersion) ||
    !isNonEmptyString(scope.scopeVersion) ||
    !isNonEmptyString(scope.authorityDigest) ||
    !isNonEmptyString(scope.verifiedAt) ||
    Number.isNaN(Date.parse(scope.verifiedAt)) ||
    (scope.expiresAt !== undefined &&
      (!isNonEmptyString(scope.expiresAt) || Number.isNaN(Date.parse(scope.expiresAt))))
  ) {
    throw new ScopedFrameStoreError(
      SCOPED_FRAME_STORE_ERROR_CODES.INVALID_SCOPE,
      "FrameStore binding requires a valid AuthorizedScope v1"
    );
  }
  return Object.freeze({
    schemaVersion: RUNTIME_SCOPE_CONTRACT_VERSION,
    grantId: scope.grantId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    principalId: scope.principalId,
    capabilities: Object.freeze([...scope.capabilities] as CapabilityId[]),
    authorityVersion: scope.authorityVersion,
    scopeVersion: scope.scopeVersion,
    authorityDigest: scope.authorityDigest,
    verifiedAt: scope.verifiedAt,
    ...(scope.expiresAt === undefined ? {} : { expiresAt: scope.expiresAt }),
  });
}

function encodeCursor(timestamp: string, frameId: string): string {
  return Buffer.from(JSON.stringify({ timestamp, frame_id: frameId })).toString("base64");
}

function decodeCursor(cursor: string): PaginationCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as PaginationCursor;
    return isNonEmptyString(parsed.timestamp) && isNonEmptyString(parsed.frame_id) ? parsed : null;
  } catch {
    return null;
  }
}

function stripLegacyOwnership(frame: Frame): Frame {
  const copy = structuredClone(frame);
  delete copy.userId;
  return copy;
}

function parseScopedInput(frame: ScopedFrameInput): ReturnType<typeof FrameSchema.safeParse> {
  return FrameSchema.safeParse(stripLegacyOwnership(frame as Frame));
}

function rowToFrame(row: FrameRow): Frame {
  return FrameSchema.parse({
    id: row.id,
    timestamp: row.timestamp,
    branch: row.branch,
    jira: row.jira || undefined,
    module_scope: JSON.parse(row.module_scope) as string[],
    summary_caption: row.summary_caption,
    reference_point: row.reference_point,
    status_snapshot: JSON.parse(row.status_snapshot) as FrameStatusSnapshot,
    keywords: row.keywords ? (JSON.parse(row.keywords) as string[]) : undefined,
    atlas_frame_id: row.atlas_frame_id || undefined,
    feature_flags: row.feature_flags ? (JSON.parse(row.feature_flags) as string[]) : undefined,
    permissions: row.permissions ? (JSON.parse(row.permissions) as string[]) : undefined,
    module_attribution: row.module_attribution
      ? (JSON.parse(row.module_attribution) as Frame["module_attribution"])
      : undefined,
    runId: row.run_id || undefined,
    planHash: row.plan_hash || undefined,
    spend: row.spend ? (JSON.parse(row.spend) as FrameSpendMetadata) : undefined,
    superseded_by: row.superseded_by || undefined,
    merged_from: row.merged_from ? (JSON.parse(row.merged_from) as string[]) : undefined,
    ...parseDurableFrameMetadata(row.frame_metadata),
  });
}

const FRAME_INSERT_COLUMNS = Object.freeze([
  "id",
  "timestamp",
  "branch",
  "jira",
  "module_scope",
  "summary_caption",
  "reference_point",
  "status_snapshot",
  "keywords",
  "atlas_frame_id",
  "feature_flags",
  "permissions",
  "module_attribution",
  "run_id",
  "plan_hash",
  "spend",
  "user_id",
  "superseded_by",
  "merged_from",
  "frame_metadata",
  "ownership_schema_version",
  "tenant_id",
  "workspace_id",
  "creator_principal_id",
  "scope_version",
]);

function frameValues(frame: Frame, scope: AuthorizedScopeV1): unknown[] {
  return [
    frame.id,
    frame.timestamp,
    frame.branch,
    frame.jira ?? null,
    JSON.stringify(frame.module_scope),
    frame.summary_caption,
    frame.reference_point,
    JSON.stringify(frame.status_snapshot),
    frame.keywords ? JSON.stringify(frame.keywords) : null,
    frame.atlas_frame_id ?? null,
    frame.feature_flags ? JSON.stringify(frame.feature_flags) : null,
    frame.permissions ? JSON.stringify(frame.permissions) : null,
    frame.module_attribution ? JSON.stringify(frame.module_attribution) : null,
    frame.runId ?? null,
    frame.planHash ?? null,
    frame.spend ? JSON.stringify(frame.spend) : null,
    null,
    frame.superseded_by ?? null,
    frame.merged_from ? JSON.stringify(frame.merged_from) : null,
    JSON.stringify(durableFrameMetadata(frame)),
    FRAME_STORE_SCOPE_CONTRACT_VERSION,
    scope.tenantId,
    scope.workspaceId,
    scope.principalId,
    scope.scopeVersion,
  ];
}

const FRAME_UPSERT_SQL = `
  INSERT INTO frames (${FRAME_INSERT_COLUMNS.join(", ")})
  VALUES (${FRAME_INSERT_COLUMNS.map(() => "?").join(", ")})
  ON CONFLICT(id) DO UPDATE SET
    timestamp = excluded.timestamp,
    branch = excluded.branch,
    jira = excluded.jira,
    module_scope = excluded.module_scope,
    summary_caption = excluded.summary_caption,
    reference_point = excluded.reference_point,
    status_snapshot = excluded.status_snapshot,
    keywords = excluded.keywords,
    atlas_frame_id = excluded.atlas_frame_id,
    feature_flags = excluded.feature_flags,
    permissions = excluded.permissions,
    module_attribution = excluded.module_attribution,
    run_id = excluded.run_id,
    plan_hash = excluded.plan_hash,
    spend = excluded.spend,
    superseded_by = excluded.superseded_by,
    merged_from = excluded.merged_from,
    frame_metadata = excluded.frame_metadata
`;

abstract class SqliteBoundView {
  private closed = false;

  protected constructor(
    readonly authorizedScope: AuthorizedScopeV1,
    protected readonly db: Database.Database,
    protected readonly binding: SqliteStoreScopeBindingV1,
    protected readonly accessMode: "read-only" | "read-write",
    private readonly backendIsClosed: () => boolean,
    protected readonly now: () => Date,
    private readonly databasePath: string
  ) {}

  protected assertActive(): void {
    if (this.closed || this.backendIsClosed()) {
      throw new ScopedFrameStoreError(
        SCOPED_FRAME_STORE_ERROR_CODES.STORE_CLOSED,
        "Scope-bound SQLite FrameStore is closed"
      );
    }
    if (
      this.authorizedScope.expiresAt !== undefined &&
      Date.parse(this.authorizedScope.expiresAt) <= this.now().getTime()
    ) {
      throw new ScopedFrameStoreError(
        SCOPED_FRAME_STORE_ERROR_CODES.SCOPE_EXPIRED,
        "Authorized FrameStore scope has expired"
      );
    }
  }

  protected assertCapability(capability: FrameStoreCapability): void {
    this.assertActive();
    if (!this.authorizedScope.capabilities.includes(capability as CapabilityId)) {
      throw new ScopedFrameStoreError(
        SCOPED_FRAME_STORE_ERROR_CODES.CAPABILITY_MISSING,
        `FrameStore operation requires ${capability}`,
        capability
      );
    }
  }

  protected assertWritable(): void {
    if (this.accessMode !== "read-write") {
      throw new ScopedSqliteError(
        SCOPED_SQLITE_ERROR_CODES.READ_ONLY,
        "This scoped SQLite FrameStore was opened read-only."
      );
    }
  }

  protected scopeParameters(): readonly [string, string] {
    return [this.authorizedScope.tenantId, this.authorizedScope.workspaceId];
  }

  protected metadata(): FrameStoreMetadata {
    this.assertActive();
    const canonicalLocation = canonicalizeStorePath(this.databasePath);
    return {
      backend: "sqlite",
      location: this.databasePath,
      canonicalLocation,
      identity: createStoreIdentity(canonicalLocation).replace("sqlite-v1:", "sqlite-scoped-v1:"),
      capabilities: { encryption: true, images: false },
    };
  }

  protected health(): FrameStoreHealth {
    this.assertActive();
    try {
      const inspection = inspectScopedSqliteSchema(this.db, { integrityCheck: true });
      return {
        healthy: inspection.healthy,
        schemaVersion: String(SCOPED_SQLITE_SCHEMA_VERSION),
        checkedAt: this.now().toISOString(),
        ...(inspection.healthy
          ? {}
          : { message: `Scoped SQLite validation failed: ${inspection.issues.join(", ")}` }),
      };
    } catch {
      return {
        healthy: false,
        schemaVersion: String(SCOPED_SQLITE_SCHEMA_VERSION),
        checkedAt: this.now().toISOString(),
        message: "Scoped SQLite health check failed",
      };
    }
  }

  protected closeView(): void {
    this.closed = true;
  }
}

class ScopedSqliteFrameStore extends SqliteBoundView implements ScopedFrameStore {
  constructor(
    authorizedScope: AuthorizedScopeV1,
    db: Database.Database,
    binding: SqliteStoreScopeBindingV1,
    accessMode: "read-only" | "read-write",
    backendIsClosed: () => boolean,
    now: () => Date,
    databasePath: string
  ) {
    super(authorizedScope, db, binding, accessMode, backendIsClosed, now, databasePath);
  }

  getMetadata(): FrameStoreMetadata {
    return this.metadata();
  }

  async getHealth(): Promise<FrameStoreHealth> {
    return this.health();
  }

  async saveFrame(frame: ScopedFrameInput): Promise<void> {
    this.assertCapability(FRAME_STORE_CAPABILITIES.WRITE);
    this.assertWritable();
    const parsed = parseScopedInput(frame);
    if (!parsed.success) throw parsed.error;
    this.db.prepare(FRAME_UPSERT_SQL).run(...frameValues(parsed.data, this.authorizedScope));
  }

  async saveFrames(frames: readonly ScopedFrameInput[]): Promise<SaveResult[]> {
    this.assertCapability(FRAME_STORE_CAPABILITIES.WRITE);
    this.assertWritable();
    const parsed = frames.map(parseScopedInput);
    const invalidIndex = parsed.findIndex((result) => !result.success);
    if (invalidIndex !== -1) {
      const invalid = parsed[invalidIndex];
      return frames.map((frame, index) => ({
        id: frame.id ?? `frame-${index}`,
        success: false,
        error:
          index === invalidIndex && !invalid.success
            ? `Validation failed: ${invalid.error.message}`
            : "Transaction aborted due to validation failure in another frame",
      }));
    }
    const valid = parsed.map((result) => {
      if (!result.success) throw new Error("Unreachable scoped Frame validation state");
      return result.data;
    });
    const statement = this.db.prepare(FRAME_UPSERT_SQL);
    const saveAll = this.db.transaction(() => {
      for (const frame of valid) {
        statement.run(...frameValues(frame, this.authorizedScope));
      }
    });
    try {
      saveAll.immediate();
      return valid.map((frame) => ({ id: frame.id, success: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return valid.map((frame) => ({
        id: frame.id,
        success: false,
        error: `Transaction failed: ${message}`,
      }));
    }
  }

  async getFrameById(id: string): Promise<Frame | null> {
    this.assertCapability(FRAME_STORE_CAPABILITIES.READ);
    const row = this.db
      .prepare("SELECT * FROM frames WHERE id = ? AND tenant_id = ? AND workspace_id = ?")
      .get(id, ...this.scopeParameters()) as FrameRow | undefined;
    return row ? rowToFrame(row) : null;
  }

  async searchFrames(criteria: ScopedFrameSearchCriteria): Promise<Frame[]> {
    this.assertCapability(FRAME_STORE_CAPABILITIES.READ);
    const { userId: _discarded, ...safeCriteria } = criteria as ScopedFrameSearchCriteria & {
      userId?: unknown;
    };
    const where = ["f.tenant_id = ?", "f.workspace_id = ?"];
    const parameters: Array<string | number> = [...this.scopeParameters()];
    let query = "SELECT f.* FROM frames f";
    if (safeCriteria.query) {
      const normalized = normalizeFTS5Query(
        safeCriteria.query,
        safeCriteria.exact,
        safeCriteria.mode
      );
      if (normalized) {
        query += " JOIN frames_fts fts ON f.rowid = fts.rowid";
        where.unshift("frames_fts MATCH ?");
        parameters.unshift(normalized);
      }
    }
    if (safeCriteria.since) {
      where.push("f.timestamp >= ?");
      parameters.push(safeCriteria.since.toISOString());
    }
    if (safeCriteria.until) {
      where.push("f.timestamp <= ?");
      parameters.push(safeCriteria.until.toISOString());
    }
    if (safeCriteria.branch !== undefined) {
      where.push("f.branch = ?");
      parameters.push(safeCriteria.branch);
    }
    if (safeCriteria.moduleScope?.length) {
      where.push(
        `EXISTS (SELECT 1 FROM json_each(f.module_scope) AS module
          WHERE module.value IN (${safeCriteria.moduleScope.map(() => "?").join(", ")}))`
      );
      parameters.push(...safeCriteria.moduleScope);
    }
    query += ` WHERE ${where.join(" AND ")} ORDER BY f.timestamp DESC, f.id DESC`;
    if (safeCriteria.limit !== undefined) {
      query += " LIMIT ?";
      parameters.push(safeCriteria.limit);
    }
    try {
      const rows = this.db.prepare(query).all(...parameters) as FrameRow[];
      return rows.map(rowToFrame);
    } catch (error) {
      const sqliteError = error as { code?: string; message?: string };
      if (
        sqliteError.code === "SQLITE_ERROR" &&
        (sqliteError.message?.includes("fts5: syntax error") ||
          sqliteError.message?.includes("no such column") ||
          sqliteError.message?.includes("unknown special query"))
      ) {
        return [];
      }
      throw error;
    }
  }

  async listFrames(options: ScopedFrameListOptions = {}): Promise<FrameListResult> {
    this.assertCapability(FRAME_STORE_CAPABILITIES.READ);
    const { userId: _discarded, ...safeOptions } = options as ScopedFrameListOptions & {
      userId?: unknown;
    };
    const limit = safeOptions.limit ?? 10;
    const where = ["tenant_id = ?", "workspace_id = ?"];
    const parameters: Array<string | number> = [...this.scopeParameters()];
    if (safeOptions.cursor) {
      const cursor = decodeCursor(safeOptions.cursor);
      if (cursor) {
        where.push("(timestamp, id) < (?, ?)");
        parameters.push(cursor.timestamp, cursor.frame_id);
      }
    }
    let query = `SELECT * FROM frames WHERE ${where.join(" AND ")}
      ORDER BY timestamp DESC, id DESC LIMIT ?`;
    parameters.push(limit + 1);
    if (!safeOptions.cursor && safeOptions.offset !== undefined) {
      query += " OFFSET ?";
      parameters.push(safeOptions.offset);
    }
    const rows = this.db.prepare(query).all(...parameters) as FrameRow[];
    const hasMore = rows.length > limit;
    const frames = rows.slice(0, limit).map(rowToFrame);
    const lastFrame = frames.at(-1);
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
    this.assertCapability(FRAME_STORE_CAPABILITIES.DELETE);
    this.assertWritable();
    return (
      this.db
        .prepare("DELETE FROM frames WHERE id = ? AND tenant_id = ? AND workspace_id = ?")
        .run(id, ...this.scopeParameters()).changes > 0
    );
  }

  async deleteFramesBefore(date: Date): Promise<number> {
    return this.deleteWhere("timestamp < ?", [date.toISOString()]);
  }

  async deleteFramesByBranch(branch: string): Promise<number> {
    return this.deleteWhere("branch = ?", [branch]);
  }

  async deleteFramesByModule(moduleId: string): Promise<number> {
    return this.deleteWhere("EXISTS (SELECT 1 FROM json_each(module_scope) WHERE value = ?)", [
      moduleId,
    ]);
  }

  async getFrameCount(): Promise<number> {
    this.assertCapability(FRAME_STORE_CAPABILITIES.READ);
    return (
      this.db
        .prepare("SELECT COUNT(*) AS count FROM frames WHERE tenant_id = ? AND workspace_id = ?")
        .get(...this.scopeParameters()) as { count: number }
    ).count;
  }

  async getStats(detailed = false): Promise<StoreStats> {
    this.assertCapability(FRAME_STORE_CAPABILITIES.READ);
    const [tenantId, workspaceId] = this.scopeParameters();
    const now = this.now();
    const oneWeekAgo = new Date(now);
    oneWeekAgo.setUTCDate(oneWeekAgo.getUTCDate() - 7);
    const oneMonthAgo = new Date(now);
    oneMonthAgo.setUTCMonth(oneMonthAgo.getUTCMonth() - 1);
    const aggregate = this.db
      .prepare(
        `SELECT COUNT(*) AS totalFrames,
                SUM(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END) AS thisWeek,
                SUM(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END) AS thisMonth,
                MIN(timestamp) AS oldestDate, MAX(timestamp) AS newestDate
           FROM frames WHERE tenant_id = ? AND workspace_id = ?`
      )
      .get(oneWeekAgo.toISOString(), oneMonthAgo.toISOString(), tenantId, workspaceId) as {
      totalFrames: number;
      thisWeek: number | null;
      thisMonth: number | null;
      oldestDate: string | null;
      newestDate: string | null;
    };
    const result: StoreStats = {
      totalFrames: aggregate.totalFrames,
      thisWeek: aggregate.thisWeek ?? 0,
      thisMonth: aggregate.thisMonth ?? 0,
      oldestDate: aggregate.oldestDate,
      newestDate: aggregate.newestDate,
    };
    if (detailed && aggregate.totalFrames > 0) {
      const distribution: Record<string, number> = {};
      const rows = this.db
        .prepare("SELECT module_scope FROM frames WHERE tenant_id = ? AND workspace_id = ?")
        .all(tenantId, workspaceId) as Array<{ module_scope: string }>;
      for (const row of rows) {
        try {
          for (const moduleId of JSON.parse(row.module_scope) as string[]) {
            distribution[moduleId] = (distribution[moduleId] ?? 0) + 1;
          }
        } catch {
          // Structurally valid legacy content remains preserved; malformed JSON is not counted.
        }
      }
      result.moduleDistribution = Object.fromEntries(
        Object.entries(distribution)
          .sort((left, right) => right[1] - left[1])
          .slice(0, 20)
      );
    }
    return result;
  }

  async getTurnCostMetrics(since?: string): Promise<TurnCostMetrics> {
    this.assertCapability(FRAME_STORE_CAPABILITIES.READ);
    const where = ["tenant_id = ?", "workspace_id = ?"];
    const parameters: string[] = [...this.scopeParameters()];
    if (since) {
      where.push("timestamp >= ?");
      parameters.push(since);
    }
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS frameCount,
                SUM(CASE WHEN spend IS NOT NULL THEN json_extract(spend, '$.tokens_estimated') ELSE 0 END) AS estimatedTokens,
                SUM(CASE WHEN spend IS NOT NULL THEN json_extract(spend, '$.prompts') ELSE 0 END) AS prompts
           FROM frames WHERE ${where.join(" AND ")}`
      )
      .get(...parameters) as {
      frameCount: number;
      estimatedTokens: number | null;
      prompts: number | null;
    };
    return {
      frameCount: row.frameCount,
      estimatedTokens: row.estimatedTokens ?? 0,
      prompts: row.prompts ?? 0,
    };
  }

  async updateFrame(id: string, updates: ScopedFrameUpdate): Promise<boolean> {
    this.assertCapability(FRAME_STORE_CAPABILITIES.WRITE);
    this.assertWritable();
    const {
      id: _discardedId,
      timestamp: _discardedTimestamp,
      userId: _discardedUserId,
      tenantId: _discardedTenantId,
      workspaceId: _discardedWorkspaceId,
      principalId: _discardedPrincipalId,
      creatorPrincipalId: _discardedCreatorPrincipalId,
      ...safeUpdates
    } = updates as ScopedFrameUpdate & Record<string, unknown>;
    const update = this.db.transaction(() => {
      const row = this.db
        .prepare("SELECT * FROM frames WHERE id = ? AND tenant_id = ? AND workspace_id = ?")
        .get(id, ...this.scopeParameters()) as FrameRow | undefined;
      if (!row) return false;
      const next = FrameSchema.parse({
        ...rowToFrame(row),
        ...safeUpdates,
        id: row.id,
        timestamp: row.timestamp,
      });
      this.db.prepare(FRAME_UPSERT_SQL).run(...frameValues(next, this.authorizedScope));
      return true;
    });
    return update.immediate();
  }

  async purgeSuperseded(): Promise<number> {
    return this.deleteWhere("superseded_by IS NOT NULL", []);
  }

  async close(): Promise<void> {
    this.closeView();
  }

  private deleteWhere(predicate: string, predicateParameters: readonly unknown[]): number {
    this.assertCapability(FRAME_STORE_CAPABILITIES.DELETE);
    this.assertWritable();
    return this.db
      .prepare(`DELETE FROM frames WHERE tenant_id = ? AND workspace_id = ? AND (${predicate})`)
      .run(...this.scopeParameters(), ...predicateParameters).changes;
  }
}

class SqliteFrameStoreAdminView extends SqliteBoundView implements FrameStoreAdmin {
  constructor(
    authorizedScope: AuthorizedScopeV1,
    db: Database.Database,
    binding: SqliteStoreScopeBindingV1,
    accessMode: "read-only" | "read-write",
    backendIsClosed: () => boolean,
    now: () => Date,
    databasePath: string
  ) {
    super(authorizedScope, db, binding, accessMode, backendIsClosed, now, databasePath);
  }

  getMetadata(): FrameStoreMetadata {
    this.assertCapability(FRAME_STORE_CAPABILITIES.ADMIN);
    return this.metadata();
  }

  async getHealth(): Promise<FrameStoreHealth> {
    this.assertCapability(FRAME_STORE_CAPABILITIES.ADMIN);
    return this.health();
  }

  async getFrameOwnership(id: string): Promise<FrameOwnershipV1 | null> {
    this.assertCapability(FRAME_STORE_CAPABILITIES.ADMIN);
    const row = this.db
      .prepare(
        `SELECT ownership_schema_version, tenant_id, workspace_id,
                creator_principal_id, scope_version
           FROM frames WHERE id = ? AND tenant_id = ? AND workspace_id = ?`
      )
      .get(id, ...this.scopeParameters()) as
      | {
          ownership_schema_version: number;
          tenant_id: string;
          workspace_id: string;
          creator_principal_id: string;
          scope_version: string;
        }
      | undefined;
    return row
      ? Object.freeze({
          schemaVersion: row.ownership_schema_version as typeof FRAME_STORE_SCOPE_CONTRACT_VERSION,
          tenantId: row.tenant_id as FrameOwnershipV1["tenantId"],
          workspaceId: row.workspace_id as FrameOwnershipV1["workspaceId"],
          creatorPrincipalId: row.creator_principal_id as FrameOwnershipV1["creatorPrincipalId"],
          scopeVersion: row.scope_version as FrameOwnershipV1["scopeVersion"],
        })
      : null;
  }

  async close(): Promise<void> {
    this.closeView();
  }
}

/** Physical v15 backend. A file can bind views for exactly its persisted workspace. */
export class SqliteScopedFrameStoreBackend
  implements ScopedFrameStoreBinder, FrameStoreAdminBinder
{
  private readonly db: Database.Database;
  private readonly binding: SqliteStoreScopeBindingV1;
  private readonly accessMode: "read-only" | "read-write";
  private readonly now: () => Date;
  private readonly databasePath: string;
  private readonly ownsConnection: boolean;
  private closed = false;

  constructor(dbOrPath: Database.Database | string, options: SqliteScopedFrameStoreOptions = {}) {
    this.accessMode = options.accessMode ?? "read-write";
    this.now = options.now ?? (() => new Date());
    if (typeof dbOrPath === "string") {
      this.db = openDatabaseForMaintenance(dbOrPath);
      this.databasePath = dbOrPath;
      this.ownsConnection = true;
    } else {
      this.db = dbOrPath;
      this.databasePath = dbOrPath.name;
      this.ownsConnection = false;
      const connectionMode = dbOrPath.readonly ? "read-only" : "read-write";
      if (this.accessMode === "read-write" && connectionMode === "read-only") {
        throw new ScopedSqliteError(
          SCOPED_SQLITE_ERROR_CODES.READ_ONLY,
          "A read-only SQLite connection cannot back a read-write scoped store."
        );
      }
    }
    try {
      this.binding = requireHealthyScopedSqliteSchema(this.db);
      if (this.accessMode === "read-only" && !this.db.readonly) this.db.pragma("query_only = ON");
    } catch (error) {
      if (this.ownsConnection) this.db.close();
      throw error;
    }
  }

  bind(authorizedScope: AuthorizedScopeV1): ScopedFrameStore {
    const scope = this.bindScope(authorizedScope);
    return new ScopedSqliteFrameStore(
      scope,
      this.db,
      this.binding,
      this.accessMode,
      () => this.closed,
      this.now,
      this.databasePath
    );
  }

  bindAdmin(authorizedScope: AuthorizedScopeV1): FrameStoreAdmin {
    const scope = this.bindScope(authorizedScope);
    if (!scope.capabilities.includes(FRAME_STORE_CAPABILITIES.ADMIN)) {
      throw new ScopedFrameStoreError(
        SCOPED_FRAME_STORE_ERROR_CODES.CAPABILITY_MISSING,
        `FrameStore operation requires ${FRAME_STORE_CAPABILITIES.ADMIN}`,
        FRAME_STORE_CAPABILITIES.ADMIN
      );
    }
    return new SqliteFrameStoreAdminView(
      scope,
      this.db,
      this.binding,
      this.accessMode,
      () => this.closed,
      this.now,
      this.databasePath
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.ownsConnection) this.db.close();
  }

  private bindScope(authorizedScope: AuthorizedScopeV1): AuthorizedScopeV1 {
    if (this.closed) {
      throw new ScopedFrameStoreError(
        SCOPED_FRAME_STORE_ERROR_CODES.STORE_CLOSED,
        "Scope-bound SQLite FrameStore backend is closed"
      );
    }
    const scope = immutableScope(authorizedScope);
    if (
      scope.tenantId !== this.binding.tenantId ||
      scope.workspaceId !== this.binding.workspaceId
    ) {
      throw new ScopedSqliteError(
        SCOPED_SQLITE_ERROR_CODES.SCOPE_MISMATCH,
        "The authorized tenant/workspace does not match this SQLite store's immutable binding."
      );
    }
    if (scope.expiresAt !== undefined && Date.parse(scope.expiresAt) <= this.now().getTime()) {
      throw new ScopedFrameStoreError(
        SCOPED_FRAME_STORE_ERROR_CODES.SCOPE_EXPIRED,
        "Authorized FrameStore scope has expired"
      );
    }
    return scope;
  }
}
