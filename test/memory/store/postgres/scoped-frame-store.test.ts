import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Pool, PoolClient, QueryResult } from "pg";
import type { Frame } from "@app/memory/frames/types.js";
import {
  FRAME_STORE_CAPABILITIES,
  POSTGRES_FRAME_STORE_SCHEMA_VERSION,
  PostgresFrameStoreAdministration,
  PostgresScopedFrameStoreBackend,
  SCOPED_FRAME_STORE_ERROR_CODES,
  ScopedFrameStoreError,
  migratePostgresFrameStore,
  planPostgresFrameStoreMigration,
  type ScopedFrameInput,
} from "@app/memory/store/index.js";
import {
  RUNTIME_SCOPE_CONTRACT_VERSION,
  type AuthorityGrantId,
  type AuthorityVersion,
  type AuthorizedScopeV1,
  type CapabilityId,
  type ContentDigest,
  type PrincipalId,
  type ScopeVersion,
  type TenantId,
  type WorkspaceId,
} from "@app/shared/runtime-scope/index.js";

interface RecordedQuery {
  readonly sql: string;
  readonly values: readonly unknown[];
}

const IDS = {
  tenantA: "01900000-0000-7000-8000-000000000001",
  tenantB: "01900000-0000-7000-8000-000000000002",
  workspaceA: "01900000-0000-7000-8000-000000000101",
  workspaceB: "01900000-0000-7000-8000-000000000102",
  principalA: "01900000-0000-7000-8000-000000000201",
  principalB: "01900000-0000-7000-8000-000000000202",
} as const;
const SCHEMA = "lex_test";

function scope(
  tenantId = IDS.tenantA,
  workspaceId = IDS.workspaceA,
  principalId = IDS.principalA,
  capabilities: readonly CapabilityId[] = [
    FRAME_STORE_CAPABILITIES.READ,
    FRAME_STORE_CAPABILITIES.WRITE,
    FRAME_STORE_CAPABILITIES.DELETE,
  ],
  overrides: Partial<AuthorizedScopeV1> = {}
): AuthorizedScopeV1 {
  return {
    schemaVersion: RUNTIME_SCOPE_CONTRACT_VERSION,
    grantId: "01900000-0000-7000-8000-000000000301" as AuthorityGrantId,
    tenantId: tenantId as TenantId,
    workspaceId: workspaceId as WorkspaceId,
    principalId: principalId as PrincipalId,
    capabilities,
    authorityVersion: "authority-v1" as AuthorityVersion,
    scopeVersion: "scope-v1" as ScopeVersion,
    authorityDigest: "sha256:scope" as ContentDigest,
    verifiedAt: "2026-07-18T01:00:00.000Z",
    ...overrides,
  };
}

function frame(id: string, overrides: Partial<Frame> = {}): ScopedFrameInput {
  return {
    id,
    timestamp: "2026-07-18T01:30:00.000Z",
    branch: "agent/761-postgres-rls",
    module_scope: ["memory/store/postgres"],
    summary_caption: `Scoped PostgreSQL Frame ${id}`,
    reference_point: "transaction-bound RLS",
    status_snapshot: { next_action: "verify pool isolation" },
    ...overrides,
  };
}

class FakePool {
  readonly queries: RecordedQuery[] = [];
  readonly releases: Array<Error | boolean | undefined> = [];
  failWhen?: RegExp;
  runtimeBoundary = {
    schema_version: POSTGRES_FRAME_STORE_SCHEMA_VERSION,
    role_name: "lex_runtime",
    role_is_superuser: false,
    role_can_create_roles: false,
    role_bypasses_rls: false,
    role_owns_protected_relation: false,
    role_can_mutate_protected_ledger: false,
    role_has_admin_option: false,
    role_can_set_unsafe_role: false,
    role_can_create_in_schema: false,
    rls_enabled: true,
    rls_forced: true,
  };

  readonly client = {
    query: async (sql: string, values: readonly unknown[] = []) => this.query(sql, values),
    release: (error?: Error | boolean) => this.releases.push(error),
  } as unknown as PoolClient;

  async connect(): Promise<PoolClient> {
    return this.client;
  }

  async query(sql: string, values: readonly unknown[] = []): Promise<QueryResult> {
    const normalized = sql.replace(/\s+/g, " ").trim();
    this.queries.push({ sql: normalized, values: [...values] });
    if (this.failWhen?.test(normalized)) throw new Error("injected PostgreSQL failure");
    if (normalized.includes("pg_roles AS role")) return result([this.runtimeBoundary]);
    if (normalized.startsWith("SELECT id,") && normalized.includes("AND id = $4")) {
      return result([
        {
          id: String(values[3]),
          timestamp: "2026-07-18T01:30:00.000Z",
          branch: "agent/761-postgres-rls",
          jira: null,
          module_scope: ["memory/store/postgres"],
          summary_caption: `Scoped PostgreSQL Frame ${String(values[3])}`,
          reference_point: "transaction-bound RLS",
          status_snapshot: { next_action: "verify pool isolation" },
          keywords: null,
          atlas_frame_id: null,
          feature_flags: null,
          permissions: null,
          module_attribution: null,
          run_id: null,
          plan_hash: null,
          spend: null,
          superseded_by: null,
          merged_from: null,
          frame_metadata: { schemaVersion: 1 },
        },
      ]);
    }
    if (/SELECT COUNT\(\*\) AS count FROM .*frames/.test(normalized))
      return result([{ count: "0" }]);
    if (/COUNT\(\*\) AS total_frames/.test(normalized)) {
      return result([
        {
          total_frames: "1",
          this_week: "1",
          this_month: "1",
          oldest_date: null,
          newest_date: null,
        },
      ]);
    }
    if (/SELECT module_id, COUNT\(\*\) AS count/.test(normalized)) {
      return result([{ module_id: "memory/store/postgres", count: "1" }]);
    }
    if (/COUNT\(\*\) AS frame_count/.test(normalized)) {
      return result([{ frame_count: "0", estimated_tokens: "0", prompts: "0" }]);
    }
    if (/^(?:DELETE|UPDATE)(?: FROM)? .*\."frames"/.test(normalized)) {
      return result([], 1);
    }
    if (normalized.startsWith(`INSERT INTO "${SCHEMA}"."frames"`)) return result([], 1);
    return result([]);
  }
}

function result(rows: readonly Record<string, unknown>[], rowCount = rows.length): QueryResult {
  return {
    command: "SELECT",
    rowCount,
    oid: 0,
    fields: [],
    rows: [...rows],
  } as QueryResult;
}

function dataQueries(pool: FakePool): RecordedQuery[] {
  return pool.queries.filter(({ sql }) => sql.includes(`"${SCHEMA}"."frames"`));
}

function assertExplicitScope(query: RecordedQuery): void {
  if (query.sql.startsWith(`INSERT INTO "${SCHEMA}"."frames"`)) {
    assert.match(query.sql, /tenant_id, workspace_id, creator_principal_id, scope_version/);
    assert.match(query.sql, /ON CONFLICT \(tenant_id, workspace_id, id\)/);
    assert.match(query.sql, /current_setting\('lex\.principal_id', true\) = \$3/);
  } else {
    assert.match(query.sql, /tenant_id = \$1::uuid/);
    assert.match(query.sql, /workspace_id = \$2::uuid/);
    assert.match(query.sql, /current_setting\('lex\.principal_id', true\) = \$3/);
  }
  assert.deepEqual(query.values.slice(0, 3), [IDS.tenantA, IDS.workspaceA, IDS.principalA]);
}

describe("PostgresScopedFrameStoreBackend", () => {
  test("conjoins parameterized branch relevance with scope and all other search filters", async () => {
    const pool = new FakePool();
    const backend = new PostgresScopedFrameStoreBackend(pool as unknown as Pool, {
      schema: SCHEMA,
    });
    const store = backend.bind(scope());
    const branch = "feature/recovery_%";
    await store.searchFrames({
      query: "retrieval",
      exact: true,
      branch,
      moduleScope: ["target/search"],
      since: new Date("2026-01-01T00:00:00.000Z"),
      until: new Date("2026-02-01T00:00:00.000Z"),
      limit: 2,
      userId: "caller-controlled",
    } as never);
    const search = dataQueries(pool).find(({ sql }) => sql.includes("search_vector @@"));
    assert.ok(search);
    assertExplicitScope(search);
    assert.match(
      search.sql,
      /AND module_scope && \$6::text\[\] AND branch = \$7 AND "timestamp" >= \$8 AND "timestamp" <= \$9 ORDER BY "timestamp" DESC, id DESC LIMIT \$10$/
    );
    assert.deepEqual(search.values, [
      IDS.tenantA,
      IDS.workspaceA,
      IDS.principalA,
      "retrieval",
      "retrieval",
      ["target/search"],
      branch,
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
      2,
    ]);
    assert.equal(search.sql.includes(branch), false);
    assert.equal(search.values.includes("caller-controlled"), false);
    await backend.close();
  });

  test("requires one explicit validated canonical schema", () => {
    const pool = new FakePool();
    for (const schema of ["", "Public", "pg_catalog", "tenant-name"]) {
      assert.throws(
        () => new PostgresScopedFrameStoreBackend(pool as unknown as Pool, { schema }),
        /PostgreSQL schema/
      );
    }
  });

  test("covers every normal operation with transaction-local scope and explicit predicates", async () => {
    const pool = new FakePool();
    const backend = new PostgresScopedFrameStoreBackend(pool as unknown as Pool, {
      schema: SCHEMA,
    });
    const store = backend.bind(scope());

    await store.saveFrame(frame("one"));
    assert.equal((await store.saveFrames([frame("two"), frame("three")])).length, 2);
    assert.equal((await store.getFrameById("one"))?.id, "one");
    assert.deepEqual(await store.searchFrames({ query: "scope" }), []);
    assert.deepEqual((await store.listFrames({ limit: 2 })).frames, []);
    assert.equal(await store.updateFrame("one", { jira: "LEX-761" }), true);
    assert.ok(
      pool.queries.some(
        ({ sql }) => sql.startsWith("SELECT id,") && sql.includes("AND id = $4 FOR UPDATE")
      ),
      "validated partial updates must lock the current row before a full upsert"
    );
    assert.equal(await store.deleteFrame("one"), true);
    assert.equal(await store.deleteFramesBefore(new Date("2026-07-18T00:00:00.000Z")), 1);
    assert.equal(await store.deleteFramesByBranch("agent/761-postgres-rls"), 1);
    assert.equal(await store.deleteFramesByModule("memory/store/postgres"), 1);
    assert.equal(await store.getFrameCount(), 0);
    assert.deepEqual(await store.getStats(true), {
      totalFrames: 1,
      thisWeek: 1,
      thisMonth: 1,
      oldestDate: null,
      newestDate: null,
      moduleDistribution: { "memory/store/postgres": 1 },
    });
    assert.deepEqual(await store.getTurnCostMetrics("2026-07-18T00:00:00.000Z"), {
      frameCount: 0,
      estimatedTokens: 0,
      prompts: 0,
    });
    assert.equal(await store.purgeSuperseded(), 1);

    const scopedQueries = dataQueries(pool);
    assert.ok(scopedQueries.length >= 16);
    for (const query of scopedQueries) assertExplicitScope(query);
    const search = scopedQueries.find(({ sql }) => sql.includes("search_vector @@"));
    assert.ok(search);
    assert.match(
      search.sql,
      /search_vector @@ \(to_tsquery\('simple', \$4\) \|\| plainto_tsquery\('simple', \$5\)\)/
    );
    assert.deepEqual(search.values.slice(3), ["scope:*", "scope"]);
    assert.equal(search.sql.includes("scope:*"), false);
    const settings = pool.queries.filter(({ sql }) => sql.includes("set_config('lex.tenant_id'"));
    assert.equal(settings.length, 14);
    assert.ok(
      settings.every(
        ({ values }) => values.join("/") === [IDS.tenantA, IDS.workspaceA, IDS.principalA].join("/")
      )
    );
    assert.equal(pool.queries.filter(({ sql }) => sql === "BEGIN").length, 14);
    assert.equal(pool.queries.filter(({ sql }) => sql === "COMMIT").length, 14);
    assert.equal(
      pool.queries.filter(({ sql }) => sql.startsWith("RESET lex.tenant_id")).length,
      28
    );
    assert.ok(pool.queries.some(({ sql }) => sql === "SET TRANSACTION READ ONLY"));
    assert.match(
      pool.queries.find(({ sql }) => sql.includes("role_is_superuser"))?.sql ?? "",
      /FROM pg_catalog\.pg_roles AS role CROSS JOIN pg_catalog\.pg_class AS frames JOIN pg_catalog\.pg_namespace/
    );
    const runtimeBoundarySql =
      pool.queries.find(({ sql }) => sql.includes("role_is_superuser"))?.sql ?? "";
    assert.match(runtimeBoundarySql, /current_setting\('server_version_num'\)::integer >= 160000/);
    assert.equal(runtimeBoundarySql.match(/'SET'/g)?.length, 1);
    assert.equal(runtimeBoundarySql.match(/'USAGE'/g)?.length, 1);
    assert.equal(runtimeBoundarySql.match(/'MEMBER'/g)?.length, 1);
    assert.equal(runtimeBoundarySql.match(/'MEMBER WITH ADMIN OPTION'/g)?.length, 1);
    assert.match(runtimeBoundarySql, /administered_role\.oid/);
    assert.match(runtimeBoundarySql, /reachable_role\.rolsuper/);
    assert.match(runtimeBoundarySql, /reachable_role\.rolcreaterole/);
    assert.match(runtimeBoundarySql, /reachable_role\.rolbypassrls/);
    assert.match(runtimeBoundarySql, /current_protected_relation\.relname <> 'frames'/);
    assert.match(runtimeBoundarySql, /protected_relation\.relname = ANY\(\$2::text\[\]\)/);
    assert.deepEqual(pool.queries.find(({ sql }) => sql.includes("role_is_superuser"))?.values, [
      SCHEMA,
      [
        "frames",
        "lex_frame_store_migrations",
        "lex_frame_store_unowned_frames_v1",
        "lex_frame_store_recovery_operations",
        "lex_frame_store_recovery_assignments",
      ],
    ]);
    assert.equal(pool.releases.filter((value) => value !== undefined).length, 0);

    await backend.close();
  });

  test("alternates scopes through one pooled client without carrying settings", async () => {
    const pool = new FakePool();
    const backend = new PostgresScopedFrameStoreBackend(pool as unknown as Pool, {
      schema: SCHEMA,
    });
    const tenantA = backend.bind(scope());
    const workspaceB = backend.bind(scope(IDS.tenantA, IDS.workspaceB, IDS.principalB));
    const tenantB = backend.bind(scope(IDS.tenantB, IDS.workspaceA, IDS.principalA));

    await tenantA.getFrameCount();
    await workspaceB.getFrameCount();
    await tenantB.getFrameCount();
    await tenantA.getFrameCount();

    const values = pool.queries
      .filter(({ sql }) => sql.includes("set_config('lex.tenant_id'"))
      .map(({ values }) => values);
    assert.deepEqual(values, [
      [IDS.tenantA, IDS.workspaceA, IDS.principalA],
      [IDS.tenantA, IDS.workspaceB, IDS.principalB],
      [IDS.tenantB, IDS.workspaceA, IDS.principalA],
      [IDS.tenantA, IDS.workspaceA, IDS.principalA],
    ]);
    assert.equal(pool.queries.filter(({ sql }) => sql.startsWith("RESET lex.tenant_id")).length, 8);
  });

  test("rolls back, clears scope, and releases safely after errors or cancellation", async () => {
    for (const failure of [/SELECT COUNT\(\*\) AS count FROM .*frames/, /INSERT INTO .*frames/]) {
      const pool = new FakePool();
      pool.failWhen = failure;
      const backend = new PostgresScopedFrameStoreBackend(pool as unknown as Pool, {
        schema: SCHEMA,
      });
      const store = backend.bind(scope());
      const operation = failure.source.includes("COUNT")
        ? () => store.getFrameCount()
        : () => store.saveFrame(frame("cancelled"));
      await assert.rejects(operation, /injected PostgreSQL failure/);
      assert.equal(pool.queries.filter(({ sql }) => sql === "ROLLBACK").length, 1);
      assert.equal(pool.queries.filter(({ sql }) => sql === "COMMIT").length, 0);
      assert.equal(
        pool.queries.filter(({ sql }) => sql.startsWith("RESET lex.tenant_id")).length,
        2
      );
      assert.equal(pool.releases.at(-1), undefined);
    }
  });

  test("rejects malformed, expired, and attenuated scope before checking out a client", async () => {
    const pool = new FakePool();
    const backend = new PostgresScopedFrameStoreBackend(pool as unknown as Pool, {
      schema: SCHEMA,
      now: () => new Date("2026-07-18T03:00:00.000Z"),
    });
    assert.throws(
      () => backend.bind(scope("not-a-uuid")),
      (error: unknown) =>
        error instanceof ScopedFrameStoreError &&
        error.code === SCOPED_FRAME_STORE_ERROR_CODES.INVALID_SCOPE
    );
    assert.throws(
      () =>
        backend.bind(
          scope(IDS.tenantA, IDS.workspaceA, IDS.principalA, [], {
            expiresAt: "2026-07-18T02:00:00.000Z",
          })
        ),
      (error: unknown) =>
        error instanceof ScopedFrameStoreError &&
        error.code === SCOPED_FRAME_STORE_ERROR_CODES.SCOPE_EXPIRED
    );
    const readOnly = backend.bind(
      scope(IDS.tenantA, IDS.workspaceA, IDS.principalA, [FRAME_STORE_CAPABILITIES.READ])
    );
    await assert.rejects(
      () => readOnly.saveFrame(frame("forbidden")),
      (error: unknown) =>
        error instanceof ScopedFrameStoreError &&
        error.code === SCOPED_FRAME_STORE_ERROR_CODES.CAPABILITY_MISSING
    );
    assert.equal(pool.queries.length, 0);
  });

  test("rechecks scope expiry after a delayed pool checkout and before transaction setup", async () => {
    const pool = new FakePool();
    let checkoutCount = 0;
    let releaseCheckout!: () => void;
    const checkoutGate = new Promise<void>((resolve) => {
      releaseCheckout = resolve;
    });
    const immediateConnect = pool.connect.bind(pool);
    pool.connect = async () => {
      checkoutCount += 1;
      if (checkoutCount === 2) await checkoutGate;
      return immediateConnect();
    };
    let now = new Date("2026-07-18T01:00:00.000Z");
    const backend = new PostgresScopedFrameStoreBackend(pool as unknown as Pool, {
      schema: SCHEMA,
      now: () => now,
    });
    const store = backend.bind(
      scope(undefined, undefined, undefined, undefined, {
        expiresAt: "2026-07-18T01:01:00.000Z",
      })
    );

    const pending = store.getFrameCount();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(checkoutCount, 2);
    now = new Date("2026-07-18T01:02:00.000Z");
    releaseCheckout();
    await assert.rejects(
      pending,
      (error: unknown) =>
        error instanceof ScopedFrameStoreError &&
        error.code === SCOPED_FRAME_STORE_ERROR_CODES.SCOPE_EXPIRED
    );
    assert.equal(
      pool.queries.some(({ sql }) => sql === "BEGIN"),
      false
    );
    assert.equal(
      pool.queries.some(({ sql }) => sql.includes("set_config('lex.tenant_id'")),
      false
    );
    assert.equal(pool.releases.length, 2);
  });

  test("uses the injected clock for statistics windows", async () => {
    const pool = new FakePool();
    const backend = new PostgresScopedFrameStoreBackend(pool as unknown as Pool, {
      schema: SCHEMA,
      now: () => new Date("2026-07-18T12:00:00.000Z"),
    });
    const store = backend.bind(scope());
    assert.equal((await store.getHealth()).checkedAt, "2026-07-18T12:00:00.000Z");
    await store.getStats();
    const aggregate = pool.queries.find(({ sql }) => sql.includes("COUNT(*) AS total_frames"));
    assert.ok(aggregate);
    assert.equal(aggregate.values[3], "2026-07-11T12:00:00.000Z");
    assert.equal(aggregate.values[4], "2026-06-18T12:00:00.000Z");
  });

  test("fails closed when the runtime role can bypass protected schema or RLS boundaries", async () => {
    for (const unsafe of [
      "role_is_superuser",
      "role_can_create_roles",
      "role_bypasses_rls",
      "role_owns_protected_relation",
      "role_can_mutate_protected_ledger",
      "role_has_admin_option",
      "role_can_set_unsafe_role",
      "role_can_create_in_schema",
    ] as const) {
      const pool = new FakePool();
      pool.runtimeBoundary = { ...pool.runtimeBoundary, [unsafe]: true };
      const backend = new PostgresScopedFrameStoreBackend(pool as unknown as Pool, {
        schema: SCHEMA,
      });
      const store = backend.bind(scope());
      await assert.rejects(() => store.getFrameCount(), /non-owner, non-superuser/);
      assert.equal(dataQueries(pool).length, 0);
    }
  });
});

describe("PostgreSQL FrameStore administration", () => {
  test("keeps migration and admin APIs off the runtime binder", () => {
    const pool = new FakePool();
    const runtime = new PostgresScopedFrameStoreBackend(pool as unknown as Pool, {
      schema: SCHEMA,
    });
    const admin = new PostgresFrameStoreAdministration(pool as unknown as Pool, {
      schema: SCHEMA,
    });
    assert.equal("migrate" in runtime, false);
    assert.equal("bindAdmin" in runtime, false);
    assert.equal("bind" in admin, false);
    assert.equal("migrate" in admin, true);
  });

  test("requires frame:admin and keeps ownership inspection explicitly scoped", async () => {
    const pool = new FakePool();
    const adminBackend = new PostgresFrameStoreAdministration(pool as unknown as Pool, {
      schema: SCHEMA,
      now: () => new Date("2026-07-18T12:00:00.000Z"),
    });
    assert.throws(
      () => adminBackend.bindAdmin(scope()),
      (error: unknown) =>
        error instanceof ScopedFrameStoreError &&
        error.code === SCOPED_FRAME_STORE_ERROR_CODES.CAPABILITY_MISSING
    );
    const admin = adminBackend.bindAdmin(
      scope(IDS.tenantA, IDS.workspaceA, IDS.principalA, [FRAME_STORE_CAPABILITIES.ADMIN])
    );
    assert.equal((await admin.getHealth()).checkedAt, "2026-07-18T12:00:00.000Z");
    assert.equal(await admin.getFrameOwnership("unknown"), null);
    const query = dataQueries(pool).at(-1);
    assert.ok(query);
    assertExplicitScope(query);
  });

  test("dry-run reports quarantined v1 rows without starting a transaction", async () => {
    const queries: RecordedQuery[] = [];
    const client = {
      query: async (sql: string) => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        queries.push({ sql: normalized, values: [] });
        if (normalized.includes("COUNT(*)")) {
          return result([{ count: "7", quarantine_exists: null }]);
        }
        if (normalized.includes("to_regclass($1)"))
          return result([{ exists: "lex_frame_store_migrations" }]);
        if (normalized.includes("MAX(version)")) return result([{ version: 1 }]);
        return result([]);
      },
    } as unknown as PoolClient;
    const plan = await planPostgresFrameStoreMigration(client, SCHEMA);
    assert.deepEqual(plan, {
      currentVersion: 1,
      targetVersion: 4,
      pendingVersions: [2, 3, 4],
      unownedFrameCount: 7,
      quarantineTableConflict: false,
    });
    assert.equal(
      queries.some(({ sql }) => /^(?:BEGIN|CREATE|ALTER|INSERT|DELETE)/.test(sql)),
      false
    );
  });

  test("dry-run reports only the recovery-ledger migration from schema v3", async () => {
    const queries: RecordedQuery[] = [];
    const client = {
      query: async (sql: string) => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        queries.push({ sql: normalized, values: [] });
        if (normalized.includes("to_regclass($1)"))
          return result([{ exists: "lex_frame_store_migrations" }]);
        if (normalized.includes("MAX(version)")) return result([{ version: 3 }]);
        return result([]);
      },
    } as unknown as PoolClient;

    assert.deepEqual(await planPostgresFrameStoreMigration(client, SCHEMA), {
      currentVersion: 3,
      targetVersion: 4,
      pendingVersions: [4],
      unownedFrameCount: 0,
      quarantineTableConflict: false,
    });
    assert.equal(
      queries.some(({ sql }) => sql.includes("COUNT(*)")),
      false
    );
  });

  test("migration is transactional, quarantines unowned rows, and installs forced RLS", async () => {
    const queries: RecordedQuery[] = [];
    const client = {
      query: async (sql: string, values: readonly unknown[] = []) => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        queries.push({ sql: normalized, values: [...values] });
        if (normalized.includes("MAX(version)")) return result([{ version: 0 }]);
        return result([]);
      },
    } as unknown as PoolClient;
    await migratePostgresFrameStore(client, SCHEMA);
    assert.equal(queries[0]?.sql, "BEGIN");
    assert.equal(queries.at(-1)?.sql, "COMMIT");
    const migrationSql = queries.map(({ sql }) => sql).join("\n");
    assert.match(migrationSql, /lex_frame_store_unowned_frames_v1/);
    assert.doesNotMatch(
      migrationSql,
      /CREATE TABLE IF NOT EXISTS lex_frame_store_unowned_frames_v1/
    );
    assert.match(migrationSql, /PRIMARY KEY \(tenant_id, workspace_id, id\)/);
    assert.match(migrationSql, /ENABLE ROW LEVEL SECURITY/);
    assert.match(migrationSql, /FORCE ROW LEVEL SECURITY/);
    assert.match(migrationSql, /current_setting\('lex\.principal_id', true\)/);
    assert.match(migrationSql, /CREATE POLICY lex_frames_runtime_select/);
    assert.match(migrationSql, /CREATE POLICY lex_frames_runtime_insert/);
    assert.match(migrationSql, /creator_principal_id::text = current_setting/);
    assert.match(migrationSql, /CREATE TRIGGER frames_ownership_immutable/);
    assert.match(migrationSql, /REVOKE ALL ON TABLE "lex_test"\."frames" FROM PUBLIC/);
    assert.match(migrationSql, /CREATE TABLE "lex_test"\."lex_frame_store_recovery_operations"/);
    assert.match(migrationSql, /CREATE TABLE "lex_test"\."lex_frame_store_recovery_assignments"/);
    assert.match(
      migrationSql,
      /FOREIGN KEY \(recovery_id\) REFERENCES "lex_test"\."lex_frame_store_recovery_operations" \(recovery_id\)/
    );
    assert.match(migrationSql, /CHECK \(state IN \('verified', 'cleaned'\)\)/);
    assert.match(
      migrationSql,
      /CONSTRAINT frame_store_recovery_assignments_frame_id_unique UNIQUE \(frame_id\)/
    );
    assert.match(
      migrationSql,
      /CONSTRAINT frame_store_recovery_assignments_destination_digest_sha256/
    );
    assert.match(
      migrationSql,
      /REVOKE ALL ON TABLE "lex_test"\."lex_frame_store_recovery_operations" FROM PUBLIC/
    );
    assert.match(
      migrationSql,
      /REVOKE ALL ON TABLE "lex_test"\."lex_frame_store_recovery_assignments" FROM PUBLIC/
    );
  });

  test("dry-run reports a conflicting pre-existing quarantine table", async () => {
    const client = {
      query: async (sql: string) => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (normalized.includes("COUNT(*)")) {
          return result([{ count: "7", quarantine_exists: "lex_frame_store_unowned_frames_v1" }]);
        }
        if (normalized.includes("to_regclass($1)")) {
          return result([{ exists: "lex_frame_store_migrations" }]);
        }
        if (normalized.includes("MAX(version)")) return result([{ version: 1 }]);
        return result([]);
      },
    } as unknown as PoolClient;

    const plan = await planPostgresFrameStoreMigration(client, SCHEMA);
    assert.equal(plan.quarantineTableConflict, true);
  });

  test("migration failure rolls back the complete schema change", async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        queries.push(normalized);
        if (normalized.includes("MAX(version)")) return result([{ version: 1 }]);
        if (normalized.includes("lex_frame_store_unowned_frames_v1")) {
          throw new Error("injected migration failure");
        }
        return result([]);
      },
    } as unknown as PoolClient;
    await assert.rejects(
      () => migratePostgresFrameStore(client, SCHEMA),
      /injected migration failure/
    );
    assert.equal(queries[0], "BEGIN");
    assert.equal(queries.at(-1), "ROLLBACK");
    assert.equal(queries.includes("COMMIT"), false);
  });
});
