import { createHash } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { Frame, FrameSpendMetadata, FrameStatusSnapshot } from "../../frames/types.js";
import { Frame as FrameSchema } from "../../frames/types.js";
import type { AuthorizedScopeV1, CapabilityId } from "../../../shared/runtime-scope/index.js";
import { RUNTIME_SCOPE_CONTRACT_VERSION } from "../../../shared/runtime-scope/index.js";
import {
  createPostgresSchemaTarget,
  type PostgresSchemaTargetV1,
} from "../../../shared/runtime-scope/postgres-schema.js";
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
import { durableFrameMetadata, parseDurableFrameMetadata } from "../durable-frame-metadata.js";
import {
  migratePostgresFrameStore,
  planPostgresFrameStoreMigration,
  POSTGRES_FRAME_STORE_SCHEMA_VERSION,
  type PostgresFrameStoreMigrationPlan,
} from "./migrations.js";
import { buildPostgresTextSearchQuery } from "./search-query.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPE_PREDICATE = `
  tenant_id = $1::uuid
  AND workspace_id = $2::uuid
  AND current_setting('lex.principal_id', true) = $3
`;

interface PaginationCursor {
  readonly timestamp: string;
  readonly frame_id: string;
}

interface ScopedPostgresFrameRow extends QueryResultRow {
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
  superseded_by: string | null;
  merged_from: string[] | null;
  frame_metadata: Readonly<Record<string, unknown>> | string;
}

interface RuntimeBoundaryRow extends QueryResultRow {
  schema_version: number | null;
  role_name: string;
  role_is_superuser: boolean;
  role_can_create_roles: boolean;
  role_bypasses_rls: boolean;
  role_owns_protected_relation: boolean;
  role_can_mutate_protected_ledger: boolean;
  role_has_admin_option: boolean;
  role_can_set_unsafe_role: boolean;
  role_can_create_in_schema: boolean;
  rls_enabled: boolean;
  rls_forced: boolean;
}

type FrameValue = string | string[] | object | null;
type TransactionKind = "read" | "write";

const FRAME_STORE_PROTECTED_RELATIONS = Object.freeze([
  "frames",
  "lex_frame_store_migrations",
  "lex_frame_store_unowned_frames_v1",
  "lex_frame_store_recovery_operations",
  "lex_frame_store_recovery_assignments",
]);

const FRAME_COLUMNS = `
  id, "timestamp" AS timestamp, branch, jira, module_scope, summary_caption,
  reference_point, status_snapshot, keywords, atlas_frame_id, feature_flags,
  permissions, module_attribution, run_id, plan_hash, spend, superseded_by, merged_from,
  frame_metadata
`;

function upsertScopedFrameSql(target: PostgresSchemaTargetV1): string {
  return `
  INSERT INTO ${target.relation("frames")} AS target_frame (
    tenant_id, workspace_id, creator_principal_id, scope_version,
    id, "timestamp", branch, jira, module_scope, summary_caption,
    reference_point, status_snapshot, keywords, atlas_frame_id, feature_flags,
    permissions, module_attribution, run_id, plan_hash, spend, user_id,
    superseded_by, merged_from, frame_metadata
  ) VALUES (
    $1::uuid, $2::uuid, $3::uuid, $4,
    $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
    $18, $19, $20, NULL, $21, $22, $23
  )
  ON CONFLICT (tenant_id, workspace_id, id) DO UPDATE SET
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
    user_id = NULL,
    superseded_by = EXCLUDED.superseded_by,
    merged_from = EXCLUDED.merged_from,
    frame_metadata = EXCLUDED.frame_metadata
  WHERE target_frame.tenant_id = $1::uuid
    AND target_frame.workspace_id = $2::uuid
    AND current_setting('lex.principal_id', true) = $3::text
`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function immutablePostgresScope(scope: AuthorizedScopeV1): AuthorizedScopeV1 {
  if (
    !scope ||
    scope.schemaVersion !== RUNTIME_SCOPE_CONTRACT_VERSION ||
    !isNonEmptyString(scope.grantId) ||
    !UUID_PATTERN.test(scope.tenantId) ||
    !UUID_PATTERN.test(scope.workspaceId) ||
    !UUID_PATTERN.test(scope.principalId) ||
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
      "PostgreSQL FrameStore binding requires a canonical AuthorizedScope v1"
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
    const value = JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as PaginationCursor;
    return typeof value.timestamp === "string" && typeof value.frame_id === "string" ? value : null;
  } catch {
    return null;
  }
}

function parseJson<T>(value: T | string): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

function rowToPublicFrame(row: ScopedPostgresFrameRow): Frame {
  return {
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
    superseded_by: row.superseded_by ?? undefined,
    merged_from: row.merged_from ?? undefined,
    ...parseDurableFrameMetadata(row.frame_metadata),
  };
}

function stripCallerOwnership(frame: ScopedFrameInput): Frame {
  const copy = structuredClone(frame) as Frame & Record<string, unknown>;
  delete copy.userId;
  delete copy.tenantId;
  delete copy.workspaceId;
  delete copy.principalId;
  delete copy.creatorPrincipalId;
  return copy;
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
    frame.superseded_by ?? null,
    frame.merged_from ?? null,
    durableFrameMetadata(frame),
  ];
}

function scopedFrameValues(scope: AuthorizedScopeV1, frame: Frame): FrameValue[] {
  return [
    scope.tenantId,
    scope.workspaceId,
    scope.principalId,
    scope.scopeVersion,
    ...frameValues(frame),
  ];
}

function scopeValues(scope: AuthorizedScopeV1): string[] {
  return [scope.tenantId, scope.workspaceId, scope.principalId];
}

interface ParsedPostgresLocation {
  readonly location: string;
  readonly connectionString: string;
}

function parsePostgresLocation(connectionString: string): ParsedPostgresLocation {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("PostgreSQL connection must be a valid URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("PostgreSQL connection must use postgres:// or postgresql://");
  }
  const secretFree = new URL(url);
  secretFree.password = "";
  const username = secretFree.username ? `${secretFree.username}@` : "";
  const port = secretFree.port ? `:${secretFree.port}` : "";
  return {
    location: `${secretFree.protocol}//${username}${secretFree.hostname}${port}${secretFree.pathname || "/"}`,
    connectionString: url.toString(),
  };
}

function metadataFor(location: string, schema: string): FrameStoreMetadata {
  const canonicalLocation = `${location}#schema=${schema}`;
  return {
    backend: "postgres",
    location: canonicalLocation,
    canonicalLocation,
    identity: `postgres-scoped-v3:${createHash("sha256").update(canonicalLocation).digest("hex").slice(0, 16)}`,
    capabilities: { encryption: false, images: false },
  };
}

function assertCapability(scope: AuthorizedScopeV1, capability: FrameStoreCapability): void {
  if (!scope.capabilities.includes(capability as CapabilityId)) {
    throw new ScopedFrameStoreError(
      SCOPED_FRAME_STORE_ERROR_CODES.CAPABILITY_MISSING,
      `FrameStore operation requires ${capability}`,
      capability
    );
  }
}

/**
 * Owns the connection checkout/cleanup invariant. Custom settings are cleared
 * both before and after every transaction so even a contaminated shared pool
 * cannot leak a previous request's scope.
 */
class ScopedTransactionRunner {
  private initialization: Promise<void> | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly enforceRuntimeRole: boolean,
    private readonly now: () => Date,
    private readonly target: PostgresSchemaTargetV1
  ) {}

  invalidateSchemaCheck(): void {
    this.initialization = null;
  }

  async ensureReady(): Promise<void> {
    if (!this.initialization) {
      this.initialization = (async () => {
        const client = await this.pool.connect();
        try {
          await this.assertRuntimeBoundary(client);
        } finally {
          client.release();
        }
      })().catch((error) => {
        this.initialization = null;
        throw error;
      });
    }
    await this.initialization;
  }

  async run<T>(
    scope: AuthorizedScopeV1,
    kind: TransactionKind,
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    await this.ensureReady();
    const client = await this.pool.connect();
    let transactionOpen = false;
    let cleanupFailure: Error | undefined;
    try {
      this.assertActive(scope);
      await this.assertRuntimeBoundary(client);
      await this.clearScope(client);
      await client.query("BEGIN");
      transactionOpen = true;
      if (kind === "read") await client.query("SET TRANSACTION READ ONLY");
      await client.query(
        `SELECT
          set_config('lex.tenant_id', $1, true),
          set_config('lex.workspace_id', $2, true),
          set_config('lex.principal_id', $3, true)`,
        scopeValues(scope)
      );
      const result = await operation(client);
      await client.query("COMMIT");
      transactionOpen = false;
      return result;
    } catch (error) {
      if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
      transactionOpen = false;
      throw error;
    } finally {
      try {
        await this.clearScope(client);
      } catch (error) {
        cleanupFailure = error instanceof Error ? error : new Error(String(error));
      }
      client.release(cleanupFailure);
    }
  }

  assertActive(scope: AuthorizedScopeV1): void {
    if (scope.expiresAt !== undefined && Date.parse(scope.expiresAt) <= this.now().getTime()) {
      throw new ScopedFrameStoreError(
        SCOPED_FRAME_STORE_ERROR_CODES.SCOPE_EXPIRED,
        "Authorized FrameStore scope has expired"
      );
    }
  }

  currentTime(): Date {
    return this.now();
  }

  private async clearScope(client: PoolClient): Promise<void> {
    await client.query("RESET lex.tenant_id; RESET lex.workspace_id; RESET lex.principal_id");
  }

  private async assertRuntimeBoundary(client: PoolClient): Promise<void> {
    const result = await client.query<RuntimeBoundaryRow>(
      `SELECT
        (SELECT MAX(version) FROM ${this.target.relation("lex_frame_store_migrations")})
          AS schema_version,
        CURRENT_USER AS role_name,
        role.rolsuper AS role_is_superuser,
        role.rolcreaterole AS role_can_create_roles,
        role.rolbypassrls AS role_bypasses_rls,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS current_protected_relation
          JOIN pg_catalog.pg_namespace AS current_protected_namespace
            ON current_protected_namespace.oid = current_protected_relation.relnamespace
          WHERE current_protected_namespace.nspname = $1
            AND current_protected_relation.relname = ANY($2::text[])
            AND current_protected_relation.relowner = role.oid
        ) AS role_owns_protected_relation,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS current_protected_relation
          JOIN pg_catalog.pg_namespace AS current_protected_namespace
            ON current_protected_namespace.oid = current_protected_relation.relnamespace
          WHERE current_protected_namespace.nspname = $1
            AND current_protected_relation.relname = ANY($2::text[])
            AND current_protected_relation.relname <> 'frames'
            AND pg_catalog.has_table_privilege(
              CURRENT_USER,
              current_protected_relation.oid,
              'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
            )
        ) AS role_can_mutate_protected_ledger,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_roles AS administered_role
          WHERE administered_role.oid <> role.oid
            AND CASE
              WHEN current_setting('server_version_num')::integer >= 160000
                THEN pg_catalog.pg_has_role(
                  CURRENT_USER,
                  administered_role.oid,
                  'MEMBER WITH ADMIN OPTION'
                )
              ELSE FALSE
            END
        ) AS role_has_admin_option,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_roles AS reachable_role
          WHERE reachable_role.oid <> role.oid
            AND CASE
              WHEN current_setting('server_version_num')::integer >= 160000
                THEN pg_catalog.pg_has_role(CURRENT_USER, reachable_role.oid, 'SET')
                  OR pg_catalog.pg_has_role(CURRENT_USER, reachable_role.oid, 'USAGE')
              ELSE pg_catalog.pg_has_role(CURRENT_USER, reachable_role.oid, 'MEMBER')
            END
            AND (
              reachable_role.rolsuper
              OR reachable_role.rolcreaterole
              OR reachable_role.rolbypassrls
              OR reachable_role.oid = frame_namespace.nspowner
              OR pg_catalog.has_schema_privilege(reachable_role.oid, $1, 'CREATE')
              OR EXISTS (
                SELECT 1
                FROM pg_catalog.pg_class AS protected_relation
                JOIN pg_catalog.pg_namespace AS protected_namespace
                  ON protected_namespace.oid = protected_relation.relnamespace
                WHERE protected_namespace.nspname = $1
                  AND protected_relation.relname = ANY($2::text[])
                  AND (
                    protected_relation.relowner = reachable_role.oid
                    OR pg_catalog.has_table_privilege(
                      reachable_role.oid,
                      protected_relation.oid,
                      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
                    )
                  )
              )
            )
        ) AS role_can_set_unsafe_role,
        pg_catalog.has_schema_privilege(CURRENT_USER, $1, 'CREATE')
          AS role_can_create_in_schema,
        frames.relrowsecurity AS rls_enabled,
        frames.relforcerowsecurity AS rls_forced
      FROM pg_catalog.pg_roles AS role
      CROSS JOIN pg_catalog.pg_class AS frames
      JOIN pg_catalog.pg_namespace AS frame_namespace ON frame_namespace.oid = frames.relnamespace
      WHERE role.rolname = CURRENT_USER
        AND frame_namespace.nspname = $1
        AND frames.relname = 'frames'`,
      [this.target.schema, FRAME_STORE_PROTECTED_RELATIONS]
    );
    const boundary = result.rows[0];
    if (boundary?.schema_version !== POSTGRES_FRAME_STORE_SCHEMA_VERSION) {
      throw new Error(
        `PostgreSQL FrameStore schema ${boundary?.schema_version ?? 0} is not the required schema ${POSTGRES_FRAME_STORE_SCHEMA_VERSION}`
      );
    }
    if (!boundary.rls_enabled || !boundary.rls_forced) {
      throw new Error("PostgreSQL FrameStore requires enabled and forced row-level security");
    }
    if (
      this.enforceRuntimeRole &&
      (boundary.role_is_superuser ||
        boundary.role_can_create_roles ||
        boundary.role_bypasses_rls ||
        boundary.role_owns_protected_relation ||
        boundary.role_can_mutate_protected_ledger ||
        boundary.role_has_admin_option ||
        boundary.role_can_set_unsafe_role ||
        boundary.role_can_create_in_schema)
    ) {
      throw new Error(
        "PostgreSQL FrameStore runtime role must be non-owner, non-superuser, must not CREATEROLE or BYPASSRLS, must not own or mutate protected ledgers, must not hold ADMIN OPTION, must not inherit from or SET ROLE to an unsafe role, and must not have effective schema CREATE privilege"
      );
    }
  }
}

interface BackendResources {
  readonly pool: Pool;
  readonly ownsPool: boolean;
  readonly metadata: FrameStoreMetadata;
}

function createResources(
  connection: string | Pool,
  applicationName: string,
  schema: string
): BackendResources {
  if (typeof connection === "object") {
    return {
      pool: connection,
      ownsPool: false,
      metadata: metadataFor("postgresql://injected-pool", schema),
    };
  }
  const parsed = parsePostgresLocation(connection);
  return {
    pool: new Pool({
      connectionString: parsed.connectionString,
      application_name: applicationName,
      allowExitOnIdle: true,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    }),
    ownsPool: true,
    metadata: metadataFor(parsed.location, schema),
  };
}

export interface PostgresScopedFrameStoreOptions {
  /** Explicit canonical schema. Ambient search_path is never authority. */
  readonly schema: string;
  readonly accessMode?: "read-only" | "read-write";
  readonly now?: () => Date;
}

class BoundPostgresFrameStore implements ScopedFrameStore {
  private closed = false;

  constructor(
    readonly authorizedScope: AuthorizedScopeV1,
    private readonly runner: ScopedTransactionRunner,
    private readonly metadata: FrameStoreMetadata,
    private readonly accessMode: "read-only" | "read-write",
    private readonly backendIsClosed: () => boolean,
    private readonly target: PostgresSchemaTargetV1
  ) {
    this.upsertSql = upsertScopedFrameSql(target);
  }

  private readonly upsertSql: string;

  getMetadata(): FrameStoreMetadata {
    this.assertActive();
    return this.metadata;
  }

  async getHealth(): Promise<FrameStoreHealth> {
    this.assertActive();
    const checkedAt = this.runner.currentTime().toISOString();
    try {
      await this.runner.ensureReady();
      return {
        healthy: true,
        schemaVersion: String(POSTGRES_FRAME_STORE_SCHEMA_VERSION),
        checkedAt,
      };
    } catch {
      return {
        healthy: false,
        schemaVersion: "unknown",
        checkedAt,
        message: "PostgreSQL scoped FrameStore health check failed",
      };
    }
  }

  async saveFrame(input: ScopedFrameInput): Promise<void> {
    const frame = this.parseWrite(input);
    await this.write(FRAME_STORE_CAPABILITIES.WRITE, (client) =>
      client.query(this.upsertSql, scopedFrameValues(this.authorizedScope, frame))
    );
  }

  async saveFrames(inputs: readonly ScopedFrameInput[]): Promise<SaveResult[]> {
    this.assertOperation(FRAME_STORE_CAPABILITIES.WRITE, "write");
    const parsed = inputs.map((input) => FrameSchema.safeParse(stripCallerOwnership(input)));
    const invalidIndex = parsed.findIndex((result) => !result.success);
    if (invalidIndex !== -1) {
      const invalid = parsed[invalidIndex];
      return inputs.map((input, index) => ({
        id: input.id ?? `frame-${index}`,
        success: false,
        error:
          index === invalidIndex && !invalid.success
            ? `Validation failed: ${invalid.error.message}`
            : "Transaction aborted due to validation failure in another frame",
      }));
    }
    const frames = parsed.map((result) => {
      if (!result.success) throw new Error("Unreachable scoped Frame validation state");
      return result.data;
    });
    try {
      await this.runner.run(this.authorizedScope, "write", async (client) => {
        for (const frame of frames) {
          await client.query(this.upsertSql, scopedFrameValues(this.authorizedScope, frame));
        }
      });
      return frames.map(({ id }) => ({ id, success: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return frames.map(({ id }) => ({
        id,
        success: false,
        error: `Transaction failed: ${message}`,
      }));
    }
  }

  async getFrameById(id: string): Promise<Frame | null> {
    return this.read(async (client) => {
      const result = await client.query<ScopedPostgresFrameRow>(
        `SELECT ${FRAME_COLUMNS} FROM ${this.target.relation("frames")} WHERE ${SCOPE_PREDICATE} AND id = $4`,
        [...scopeValues(this.authorizedScope), id]
      );
      return result.rows[0] ? rowToPublicFrame(result.rows[0]) : null;
    });
  }

  async searchFrames(input: ScopedFrameSearchCriteria): Promise<Frame[]> {
    const { userId: _callerOwnership, ...criteria } = input as ScopedFrameSearchCriteria & {
      userId?: unknown;
    };
    return this.read(async (client) => {
      const clauses = [SCOPE_PREDICATE];
      const values: unknown[] = scopeValues(this.authorizedScope);
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
      let sql = `SELECT ${FRAME_COLUMNS} FROM ${this.target.relation("frames")} WHERE ${clauses.join(" AND ")}`;
      sql += ` ORDER BY "timestamp" DESC, id DESC`;
      if (criteria.limit !== undefined) sql += ` LIMIT ${add(criteria.limit)}`;
      const result = await client.query<ScopedPostgresFrameRow>(sql, values);
      return result.rows.map(rowToPublicFrame);
    });
  }

  async listFrames(input?: ScopedFrameListOptions): Promise<FrameListResult> {
    const { userId: _callerOwnership, ...options } = (input ?? {}) as ScopedFrameListOptions & {
      userId?: unknown;
    };
    return this.read(async (client) => {
      const limit = options.limit ?? 10;
      const clauses = [SCOPE_PREDICATE];
      const values: unknown[] = scopeValues(this.authorizedScope);
      const add = (value: unknown): string => {
        values.push(value);
        return `$${values.length}`;
      };
      if (options.cursor) {
        const cursor = decodeCursor(options.cursor);
        if (cursor) {
          clauses.push(`("timestamp", id) < (${add(cursor.timestamp)}, ${add(cursor.frame_id)})`);
        }
      }
      let sql = `SELECT ${FRAME_COLUMNS} FROM ${this.target.relation("frames")} WHERE ${clauses.join(" AND ")}`;
      sql += ` ORDER BY "timestamp" DESC, id DESC LIMIT ${add(limit + 1)}`;
      if (!options.cursor && options.offset !== undefined) sql += ` OFFSET ${add(options.offset)}`;
      const result = await client.query<ScopedPostgresFrameRow>(sql, values);
      const hasMore = result.rows.length > limit;
      const frames = result.rows.slice(0, limit).map(rowToPublicFrame);
      const last = frames.at(-1);
      return {
        frames,
        page: {
          limit,
          hasMore,
          nextCursor: hasMore && last ? encodeCursor(last.timestamp, last.id) : null,
        },
        order: { by: "timestamp", direction: "desc" },
      };
    });
  }

  async deleteFrame(id: string): Promise<boolean> {
    return this.write(FRAME_STORE_CAPABILITIES.DELETE, async (client) => {
      const result = await client.query(
        `DELETE FROM ${this.target.relation("frames")} WHERE ${SCOPE_PREDICATE} AND id = $4`,
        [...scopeValues(this.authorizedScope), id]
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async deleteFramesBefore(date: Date): Promise<number> {
    return this.deleteWhere(`"timestamp" < $4`, date.toISOString());
  }

  async deleteFramesByBranch(branch: string): Promise<number> {
    return this.deleteWhere("branch = $4", branch);
  }

  async deleteFramesByModule(moduleId: string): Promise<number> {
    return this.deleteWhere("$4 = ANY(module_scope)", moduleId);
  }

  async getFrameCount(): Promise<number> {
    return this.read(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM ${this.target.relation("frames")} WHERE ${SCOPE_PREDICATE}`,
        scopeValues(this.authorizedScope)
      );
      return Number(result.rows[0]?.count ?? 0);
    });
  }

  async getStats(detailed = false): Promise<StoreStats> {
    return this.read(async (client) => {
      const now = this.runner.currentTime();
      const oneWeekAgo = new Date(now);
      oneWeekAgo.setUTCDate(oneWeekAgo.getUTCDate() - 7);
      const oneMonthAgo = new Date(now);
      oneMonthAgo.setUTCMonth(oneMonthAgo.getUTCMonth() - 1);
      const values = [
        ...scopeValues(this.authorizedScope),
        oneWeekAgo.toISOString(),
        oneMonthAgo.toISOString(),
      ];
      const result = await client.query<{
        total_frames: string;
        this_week: string;
        this_month: string;
        oldest_date: string | null;
        newest_date: string | null;
      }>(
        `SELECT
          COUNT(*) AS total_frames,
          COUNT(*) FILTER (WHERE "timestamp" >= $4) AS this_week,
          COUNT(*) FILTER (WHERE "timestamp" >= $5) AS this_month,
          MIN("timestamp") AS oldest_date,
          MAX("timestamp") AS newest_date
        FROM ${this.target.relation("frames")} WHERE ${SCOPE_PREDICATE}`,
        values
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
        const distribution = await client.query<{ module_id: string; count: string }>(
          `SELECT module_id, COUNT(*) AS count
           FROM ${this.target.relation("frames")}, unnest(module_scope) AS module_id
           WHERE ${SCOPE_PREDICATE}
           GROUP BY module_id
           ORDER BY COUNT(*) DESC, module_id ASC
           LIMIT 20`,
          scopeValues(this.authorizedScope)
        );
        stats.moduleDistribution = Object.fromEntries(
          distribution.rows.map(({ module_id, count }) => [module_id, Number(count)])
        );
      }
      return stats;
    });
  }

  async getTurnCostMetrics(since?: string): Promise<TurnCostMetrics> {
    return this.read(async (client) => {
      const values: unknown[] = scopeValues(this.authorizedScope);
      const sinceClause = since ? ` AND "timestamp" >= $4` : "";
      if (since) values.push(since);
      const result = await client.query<{
        frame_count: string;
        estimated_tokens: string | null;
        prompts: string | null;
      }>(
        `SELECT
          COUNT(*) AS frame_count,
          COALESCE(SUM((spend ->> 'tokens_estimated')::numeric), 0) AS estimated_tokens,
          COALESCE(SUM((spend ->> 'prompts')::numeric), 0) AS prompts
         FROM ${this.target.relation("frames")} WHERE ${SCOPE_PREDICATE}${sinceClause}`,
        values
      );
      const row = result.rows[0];
      return {
        frameCount: Number(row?.frame_count ?? 0),
        estimatedTokens: Number(row?.estimated_tokens ?? 0),
        prompts: Number(row?.prompts ?? 0),
      };
    });
  }

  async updateFrame(id: string, input: ScopedFrameUpdate): Promise<boolean> {
    const {
      id: _discardedId,
      timestamp: _discardedTimestamp,
      userId: _discardedUserId,
      tenantId: _discardedTenantId,
      workspaceId: _discardedWorkspaceId,
      principalId: _discardedPrincipalId,
      creatorPrincipalId: _discardedCreatorPrincipalId,
      ...updates
    } = input as ScopedFrameUpdate & Record<string, unknown>;
    return this.write(FRAME_STORE_CAPABILITIES.WRITE, async (client) => {
      const existing = await client.query<ScopedPostgresFrameRow>(
        `SELECT ${FRAME_COLUMNS} FROM ${this.target.relation("frames")} WHERE ${SCOPE_PREDICATE} AND id = $4 FOR UPDATE`,
        [...scopeValues(this.authorizedScope), id]
      );
      const row = existing.rows[0];
      if (!row) return false;
      const next = FrameSchema.parse({
        ...rowToPublicFrame(row),
        ...updates,
        id: row.id,
        timestamp: row.timestamp,
      });
      const result = await client.query(
        this.upsertSql,
        scopedFrameValues(this.authorizedScope, next)
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async purgeSuperseded(): Promise<number> {
    return this.write(FRAME_STORE_CAPABILITIES.DELETE, async (client) => {
      const result = await client.query(
        `DELETE FROM ${this.target.relation("frames")} WHERE ${SCOPE_PREDICATE} AND superseded_by IS NOT NULL`,
        scopeValues(this.authorizedScope)
      );
      return result.rowCount ?? 0;
    });
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private assertActive(): void {
    if (this.closed || this.backendIsClosed()) {
      throw new ScopedFrameStoreError(
        SCOPED_FRAME_STORE_ERROR_CODES.STORE_CLOSED,
        "Scope-bound PostgreSQL FrameStore is closed"
      );
    }
    this.runner.assertActive(this.authorizedScope);
  }

  private assertOperation(capability: FrameStoreCapability, kind: TransactionKind): void {
    this.assertActive();
    assertCapability(this.authorizedScope, capability);
    if (kind === "write" && this.accessMode === "read-only") {
      throw new Error("PostgreSQL scoped FrameStore is read-only");
    }
  }

  private parseWrite(input: ScopedFrameInput): Frame {
    this.assertOperation(FRAME_STORE_CAPABILITIES.WRITE, "write");
    return FrameSchema.parse(stripCallerOwnership(input));
  }

  private async read<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    this.assertOperation(FRAME_STORE_CAPABILITIES.READ, "read");
    return this.runner.run(this.authorizedScope, "read", operation);
  }

  private async write<T>(
    capability: FrameStoreCapability,
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    this.assertOperation(capability, "write");
    return this.runner.run(this.authorizedScope, "write", operation);
  }

  private async deleteWhere(clause: string, value: unknown): Promise<number> {
    return this.write(FRAME_STORE_CAPABILITIES.DELETE, async (client) => {
      const result = await client.query(
        `DELETE FROM ${this.target.relation("frames")} WHERE ${SCOPE_PREDICATE} AND ${clause}`,
        [...scopeValues(this.authorizedScope), value]
      );
      return result.rowCount ?? 0;
    });
  }
}

/** Runtime-only binder. It cannot migrate schema or expose administrative queries. */
export class PostgresScopedFrameStoreBackend implements ScopedFrameStoreBinder {
  private readonly resources: BackendResources;
  private readonly runner: ScopedTransactionRunner;
  private readonly accessMode: "read-only" | "read-write";
  private readonly now: () => Date;
  private closed = false;

  constructor(connection: string | Pool, options: PostgresScopedFrameStoreOptions) {
    const target = createPostgresSchemaTarget(options.schema);
    this.resources = createResources(connection, "lex-scoped-frame-store-runtime", target.schema);
    this.accessMode = options.accessMode ?? "read-write";
    this.now = options.now ?? (() => new Date());
    this.runner = new ScopedTransactionRunner(this.resources.pool, true, this.now, target);
    this.target = target;
  }

  private readonly target: PostgresSchemaTargetV1;

  bind(authorizedScope: AuthorizedScopeV1): ScopedFrameStore {
    if (this.closed) {
      throw new ScopedFrameStoreError(
        SCOPED_FRAME_STORE_ERROR_CODES.STORE_CLOSED,
        "Scope-bound PostgreSQL FrameStore backend is closed"
      );
    }
    const scope = immutablePostgresScope(authorizedScope);
    this.runner.assertActive(scope);
    return new BoundPostgresFrameStore(
      scope,
      this.runner,
      this.resources.metadata,
      this.accessMode,
      () => this.closed,
      this.target
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.resources.ownsPool) await this.resources.pool.end();
  }
}

class BoundPostgresFrameStoreAdmin implements FrameStoreAdmin {
  private closed = false;

  constructor(
    readonly authorizedScope: AuthorizedScopeV1,
    private readonly runner: ScopedTransactionRunner,
    private readonly metadata: FrameStoreMetadata,
    private readonly backendIsClosed: () => boolean,
    private readonly target: PostgresSchemaTargetV1
  ) {}

  getMetadata(): FrameStoreMetadata {
    this.assertActive();
    assertCapability(this.authorizedScope, FRAME_STORE_CAPABILITIES.ADMIN);
    return this.metadata;
  }

  async getHealth(): Promise<FrameStoreHealth> {
    this.assertActive();
    assertCapability(this.authorizedScope, FRAME_STORE_CAPABILITIES.ADMIN);
    const checkedAt = this.runner.currentTime().toISOString();
    try {
      await this.runner.ensureReady();
      return {
        healthy: true,
        schemaVersion: String(POSTGRES_FRAME_STORE_SCHEMA_VERSION),
        checkedAt,
      };
    } catch {
      return {
        healthy: false,
        schemaVersion: "unknown",
        checkedAt,
        message: "PostgreSQL FrameStore administrative health check failed",
      };
    }
  }

  async getFrameOwnership(id: string): Promise<FrameOwnershipV1 | null> {
    this.assertActive();
    assertCapability(this.authorizedScope, FRAME_STORE_CAPABILITIES.ADMIN);
    return this.runner.run(this.authorizedScope, "read", async (client) => {
      const result = await client.query<{
        tenant_id: string;
        workspace_id: string;
        creator_principal_id: string;
        scope_version: string;
      }>(
        `SELECT tenant_id::text, workspace_id::text, creator_principal_id::text, scope_version
         FROM ${this.target.relation("frames")} WHERE ${SCOPE_PREDICATE} AND id = $4`,
        [...scopeValues(this.authorizedScope), id]
      );
      const row = result.rows[0];
      return row
        ? Object.freeze({
            schemaVersion: FRAME_STORE_SCOPE_CONTRACT_VERSION,
            tenantId: row.tenant_id as FrameOwnershipV1["tenantId"],
            workspaceId: row.workspace_id as FrameOwnershipV1["workspaceId"],
            creatorPrincipalId: row.creator_principal_id as FrameOwnershipV1["creatorPrincipalId"],
            scopeVersion: row.scope_version as FrameOwnershipV1["scopeVersion"],
          })
        : null;
    });
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private assertActive(): void {
    if (this.closed || this.backendIsClosed()) {
      throw new ScopedFrameStoreError(
        SCOPED_FRAME_STORE_ERROR_CODES.STORE_CLOSED,
        "PostgreSQL FrameStore administrative view is closed"
      );
    }
    this.runner.assertActive(this.authorizedScope);
  }
}

/**
 * Explicit privileged boundary for migration, repair planning, and ownership
 * inspection. Never pass this object or its pool to normal CLI/MCP dispatch.
 */
export class PostgresFrameStoreAdministration implements FrameStoreAdminBinder {
  private readonly resources: BackendResources;
  private readonly runner: ScopedTransactionRunner;
  private readonly now: () => Date;
  private closed = false;

  constructor(
    connection: string | Pool,
    options: Pick<PostgresScopedFrameStoreOptions, "now" | "schema">
  ) {
    const target = createPostgresSchemaTarget(options.schema);
    this.resources = createResources(connection, "lex-scoped-frame-store-admin", target.schema);
    this.now = options.now ?? (() => new Date());
    this.runner = new ScopedTransactionRunner(this.resources.pool, false, this.now, target);
    this.target = target;
  }

  private readonly target: PostgresSchemaTargetV1;

  async planMigration(): Promise<PostgresFrameStoreMigrationPlan> {
    this.assertOpen();
    const client = await this.resources.pool.connect();
    try {
      return await planPostgresFrameStoreMigration(client, this.target.schema);
    } finally {
      client.release();
    }
  }

  async migrate(): Promise<void> {
    this.assertOpen();
    const client = await this.resources.pool.connect();
    try {
      await migratePostgresFrameStore(client, this.target.schema);
      this.runner.invalidateSchemaCheck();
    } finally {
      client.release();
    }
  }

  bindAdmin(authorizedScope: AuthorizedScopeV1): FrameStoreAdmin {
    this.assertOpen();
    const scope = immutablePostgresScope(authorizedScope);
    this.runner.assertActive(scope);
    assertCapability(scope, FRAME_STORE_CAPABILITIES.ADMIN);
    return new BoundPostgresFrameStoreAdmin(
      scope,
      this.runner,
      this.resources.metadata,
      () => this.closed,
      this.target
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.resources.ownsPool) await this.resources.pool.end();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new ScopedFrameStoreError(
        SCOPED_FRAME_STORE_ERROR_CODES.STORE_CLOSED,
        "PostgreSQL FrameStore administration is closed"
      );
    }
  }
}
