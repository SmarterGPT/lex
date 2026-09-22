import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import Database from "better-sqlite3-multiple-ciphers";

import type { Frame } from "@app/memory/frames/types.js";
import { MCPServer, type MCPRuntimeScopeGuardV1 } from "@app/memory/mcp_server/server.js";
import { createDatabase } from "@app/memory/store/db.js";
import {
  FRAME_STORE_CAPABILITIES,
  SCOPED_SQLITE_ERROR_CODES,
  SCOPED_FRAME_STORE_ERROR_CODES,
  SCOPED_SQLITE_SCHEMA_VERSION,
  ScopedSqliteError,
  ScopedFrameStoreError,
  SqliteScopedFrameStoreBackend,
  createSqliteScopeMigrationManifest,
  inspectScopedSqliteSchema,
  inventorySqliteScope,
  migrateSqliteStoreToScopedV15,
  recoverSqliteScopeMigration,
  type SqliteScopeMigrationManifestV1,
  type SqliteScopeTargetV1,
} from "@app/memory/store/index.js";
import {
  RUNTIME_SCOPE_CONTRACT_VERSION,
  type AuthorityGrantId,
  type AuthorityVersion,
  type AuthorizedScopeV1,
  type CapabilityId,
  type ContentDigest,
  type ExecutionSurfaceId,
  type InvocationContextV1,
  type PrincipalId,
  type RegistryInstanceId,
  type RuntimeId,
  type ScopeVersion,
  type TenantId,
  type TraceId,
  type TrustedRuntimeScopeBootstrapV1,
  type WorkspaceId,
} from "@app/shared/runtime-scope/index.js";
import { exerciseScopedFrameStoreConformance } from "../scoped-frame-store-conformance.js";

const IDS = Object.freeze({
  tenantA: "01900000-0000-7000-8000-000000000001" as TenantId,
  workspaceA: "01900000-0000-7000-8000-000000000002" as WorkspaceId,
  principalA: "01900000-0000-7000-8000-000000000003" as PrincipalId,
  tenantB: "01900000-0000-7000-8000-000000000004" as TenantId,
  workspaceB: "01900000-0000-7000-8000-000000000005" as WorkspaceId,
  principalB: "01900000-0000-7000-8000-000000000006" as PrincipalId,
});

const TARGET_A: SqliteScopeTargetV1 = Object.freeze({
  tenantId: IDS.tenantA,
  workspaceId: IDS.workspaceA,
  creatorPrincipalId: IDS.principalA,
  scopeVersion: "scope-v1" as ScopeVersion,
});

const TARGET_B: SqliteScopeTargetV1 = Object.freeze({
  tenantId: IDS.tenantB,
  workspaceId: IDS.workspaceB,
  creatorPrincipalId: IDS.principalB,
  scopeVersion: "scope-v1" as ScopeVersion,
});

function scope(
  target: SqliteScopeTargetV1,
  capabilities: readonly CapabilityId[] = [
    FRAME_STORE_CAPABILITIES.READ,
    FRAME_STORE_CAPABILITIES.WRITE,
    FRAME_STORE_CAPABILITIES.DELETE,
  ]
): AuthorizedScopeV1 {
  return {
    schemaVersion: RUNTIME_SCOPE_CONTRACT_VERSION,
    grantId: "01900000-0000-7000-8000-000000000010" as AuthorityGrantId,
    tenantId: target.tenantId,
    workspaceId: target.workspaceId,
    principalId: target.creatorPrincipalId,
    capabilities,
    authorityVersion: "authority-v1" as AuthorityVersion,
    scopeVersion: target.scopeVersion,
    authorityDigest: "sha256:authority" as ContentDigest,
    verifiedAt: "2026-07-18T00:00:00.000Z",
  };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function legacyFrame(id = "legacy-frame"): Frame {
  return {
    id,
    timestamp: "2026-07-18T01:00:00.000Z",
    branch: "main",
    module_scope: ["memory/store"],
    summary_caption: "Preserve this legacy Frame",
    reference_point: "explicit SQLite scope migration",
    status_snapshot: { next_action: "verify scoped ownership" },
    userId: "legacy-user-value",
  };
}

function createLegacyStore(path: string, frames: readonly Frame[] = []): void {
  const db = createDatabase(path);
  const statement = db.prepare(
    `INSERT INTO frames (
       id, timestamp, branch, jira, module_scope, summary_caption, reference_point,
       status_snapshot, keywords, atlas_frame_id, feature_flags, permissions,
       module_attribution, run_id, plan_hash, spend, user_id, superseded_by, merged_from
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const frame of frames) {
    statement.run(
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
      frame.userId ?? null,
      frame.superseded_by ?? null,
      frame.merged_from ? JSON.stringify(frame.merged_from) : null
    );
  }
  db.close();
}

function withTempStore(
  name: string,
  operation: (root: string, dbPath: string) => void | Promise<void>
): Promise<void> | void {
  const root = mkdtempSync(join(tmpdir(), `lex-${name}-`));
  const dbPath = join(root, "memory.db");
  try {
    const result = operation(root, dbPath);
    if (result instanceof Promise) {
      return result.finally(() => rmSync(root, { recursive: true, force: true }));
    }
    rmSync(root, { recursive: true, force: true });
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function migrate(path: string, target: SqliteScopeTargetV1): SqliteScopeMigrationManifestV1 {
  const manifest = createSqliteScopeMigrationManifest(path, target);
  migrateSqliteStoreToScopedV15(path, manifest, { write: true });
  return manifest;
}

function trustedMcpScope(target: SqliteScopeTargetV1): MCPRuntimeScopeGuardV1 {
  const projectRoot = resolve(".");
  const bootstrap: TrustedRuntimeScopeBootstrapV1 = {
    async resolve(request) {
      const invocationContext: InvocationContextV1 = {
        schemaVersion: RUNTIME_SCOPE_CONTRACT_VERSION,
        projectRoot,
        requestedWorkspace: { workspaceId: target.workspaceId },
        repositoryEvidence: {
          schemaVersion: 1,
          canonicalRoot: projectRoot,
        },
        runtimeSurface: {
          schemaVersion: 1,
          executionSurfaceId: "sqlite-test-surface" as ExecutionSurfaceId,
          registryInstanceId: "sqlite-test-registry" as RegistryInstanceId,
          runtimeId: request.runtimeId,
        },
      };
      return {
        resolved: true,
        invocationContext,
        authorizedScope: scope(target, request.requestedCapabilities),
      };
    },
  };
  return {
    bootstrap,
    request: {
      schemaVersion: 1,
      bootstrap: {
        schemaVersion: 1,
        cwd: projectRoot,
        argv: ["node", "lex"],
        allowedEnvironment: {},
        platform: "linux",
        executionSurface: {
          schemaVersion: 1,
          nativePlatform: "linux",
          kind: "linux-native",
          installationRef: "/usr/bin/node",
          evidenceDigest: "sha256:sqlite-test-surface" as ContentDigest,
        },
        capturedAt: "2026-07-18T00:00:00.000Z",
      },
      runtimeId: "sqlite-test-runtime" as RuntimeId,
      traceId: "sqlite-test-trace" as TraceId,
    },
  };
}

test("legacy ownership migration is explicit, deterministic, backed up, and idempotent", () =>
  withTempStore("scope-migration", (root, dbPath) => {
    createLegacyStore(dbPath, [legacyFrame()]);
    const attachmentDb = createDatabase(dbPath);
    attachmentDb
      .prepare(
        "INSERT INTO images (image_id, frame_id, data, mime_type, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run("legacy-image", "legacy-frame", Buffer.from("preserved"), "text/plain", 1);
    attachmentDb.close();
    const sourceHash = sha256(dbPath);
    const entriesBefore = readdirSync(root);
    const firstManifest = createSqliteScopeMigrationManifest(dbPath, TARGET_A);
    const secondManifest = createSqliteScopeMigrationManifest(dbPath, TARGET_A);
    assert.deepEqual(secondManifest, firstManifest);

    const dryRun = migrateSqliteStoreToScopedV15(dbPath, firstManifest);
    assert.equal(dryRun.receipt.mode, "dry-run");
    assert.equal(dryRun.receipt.outcome, "ready");
    assert.equal(dryRun.receipt.backup, null);
    assert.equal(dryRun.recoveryPath, null);
    assert.equal(sha256(dbPath), sourceHash);
    assert.deepEqual(readdirSync(root), entriesBefore);

    assert.throws(
      () => new SqliteScopedFrameStoreBackend(dbPath),
      (error: unknown) =>
        error instanceof ScopedSqliteError &&
        error.code === SCOPED_SQLITE_ERROR_CODES.MIGRATION_REQUIRED
    );

    const committed = migrateSqliteStoreToScopedV15(dbPath, firstManifest, { write: true });
    assert.equal(committed.receipt.outcome, "migrated");
    assert.ok(committed.recoveryPath);
    assert.equal(existsSync(committed.recoveryPath), true);
    assert.equal(committed.receipt.backup?.sha256, firstManifest.source.sha256);
    assert.equal(JSON.stringify(committed.receipt).includes(dbPath), false);
    assert.equal(JSON.stringify(committed.receipt).includes(committed.recoveryPath), false);

    const repeated = migrateSqliteStoreToScopedV15(dbPath, firstManifest, { write: true });
    assert.equal(repeated.receipt.outcome, "already-migrated");
    assert.equal(repeated.recoveryPath, committed.recoveryPath);
    assert.equal(readdirSync(root).filter((entry) => entry.endsWith(".bak")).length, 1);

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const inspection = inspectScopedSqliteSchema(db, { integrityCheck: true });
    assert.equal(inspection.healthy, true);
    assert.equal(inspection.schemaVersion, SCOPED_SQLITE_SCHEMA_VERSION);
    assert.equal(inspection.frameCount, 1);
    assert.equal(inspection.binding?.tenantId, TARGET_A.tenantId);
    const ownership = db
      .prepare(
        "SELECT tenant_id, workspace_id, creator_principal_id, scope_version FROM frames WHERE id = ?"
      )
      .get("legacy-frame") as Record<string, string>;
    assert.deepEqual(ownership, {
      tenant_id: TARGET_A.tenantId,
      workspace_id: TARGET_A.workspaceId,
      creator_principal_id: TARGET_A.creatorPrincipalId,
      scope_version: TARGET_A.scopeVersion,
    });
    const attachment = db
      .prepare("SELECT frame_id, data FROM images WHERE image_id = ?")
      .get("legacy-image") as { frame_id: string; data: Buffer };
    assert.equal(attachment.frame_id, "legacy-frame");
    assert.equal(attachment.data.toString("utf8"), "preserved");
    db.close();
    assert.throws(() => createDatabase(dbPath));
  }));

test("the SQLite adapter passes the shared scoped normal-operation contract", () =>
  withTempStore("scope-conformance", async (_root, dbPath) => {
    createLegacyStore(dbPath);
    migrate(dbPath, TARGET_A);
    const backend = new SqliteScopedFrameStoreBackend(dbPath, {
      now: () => new Date("2026-07-18T13:00:00.000Z"),
    });
    const store = backend.bind(scope(TARGET_A));
    await exerciseScopedFrameStoreConformance(store, "sqlite");
    await backend.close();
  }));

test("trusted scoped SQLite MCP disables attachments without creating dangling frame references", () =>
  withTempStore("scope-mcp-images", async (_root, dbPath) => {
    createLegacyStore(dbPath);
    migrate(dbPath, TARGET_A);
    const backend = new SqliteScopedFrameStoreBackend(dbPath);
    const store = backend.bind(scope(TARGET_A));
    assert.equal(store.getMetadata().capabilities.images, false);

    const server = new MCPServer({
      frameStoreBinder: backend,
      runtimeScope: trustedMcpScope(TARGET_A),
    });
    try {
      const listed = await server.handleRequest({ method: "tools/list" });
      for (const name of ["frame_create", "frame_validate"]) {
        const tool = (listed.tools as Array<Record<string, unknown>>).find(
          (candidate) => candidate.name === name
        ) as { inputSchema: { properties: Record<string, unknown> } };
        assert.equal("images" in tool.inputSchema.properties, false);
      }

      const help = await server.handleRequest({
        method: "tools/call",
        params: { name: "help", arguments: { tool: "frame_create", examples: false } },
      });
      assert.equal((help.data?.optionalFields as string[]).includes("images"), false);

      for (const name of ["frame_create", "frame_validate"]) {
        for (const attachmentInput of [
          { images: [{ data: "aGVsbG8=", mime_type: "image/png" }] },
          { image_ids: ["caller-controlled-image"] },
        ]) {
          const response = await server.handleRequest({
            method: "tools/call",
            params: {
              name,
              arguments: {
                reference_point: "trusted-sqlite-images",
                summary_caption: "Attachments require a scope-bound service",
                status_snapshot: { next_action: "retain explicit unsupported behavior" },
                module_scope: ["memory/store"],
                ...attachmentInput,
              },
            },
          });
          assert.equal(response.error?.code, "VALIDATION_INVALID_IMAGE");
        }
      }

      assert.equal(await store.getFrameCount(), 0);
    } finally {
      await store.close();
      await server.close();
      await backend.close();
    }
  }));

test("two workspace files can persist identical IDs without collision or observation", () =>
  withTempStore("scope-isolation", async (root, firstPath) => {
    const secondPath = join(root, "second.db");
    createLegacyStore(firstPath);
    createLegacyStore(secondPath);
    migrate(firstPath, TARGET_A);
    migrate(secondPath, TARGET_B);
    const backendA = new SqliteScopedFrameStoreBackend(firstPath);
    const backendB = new SqliteScopedFrameStoreBackend(secondPath);
    const storeA = backendA.bind(scope(TARGET_A));
    const storeB = backendB.bind(scope(TARGET_B));
    await storeA.saveFrame({ ...legacyFrame("same-id"), summary_caption: "workspace A" });
    await storeB.saveFrame({ ...legacyFrame("same-id"), summary_caption: "workspace B" });
    assert.equal((await storeA.getFrameById("same-id"))?.summary_caption, "workspace A");
    assert.equal((await storeB.getFrameById("same-id"))?.summary_caption, "workspace B");
    const criteria = { branch: "main", moduleScope: ["memory/store"], limit: 1 };
    assert.deepEqual(
      (await storeA.searchFrames(criteria)).map(({ summary_caption }) => summary_caption),
      ["workspace A"]
    );
    assert.deepEqual(
      (await storeB.searchFrames(criteria)).map(({ summary_caption }) => summary_caption),
      ["workspace B"]
    );
    assert.equal(await storeA.getFrameCount(), 1);
    assert.equal(await storeB.getFrameCount(), 1);
    assert.throws(
      () => backendA.bind(scope(TARGET_B)),
      (error: unknown) =>
        error instanceof ScopedSqliteError &&
        error.code === SCOPED_SQLITE_ERROR_CODES.SCOPE_MISMATCH
    );
    await backendA.close();
    await backendB.close();
  }));

test("ownership is internally stamped, immutable, scope-filtered, and admin-gated", () =>
  withTempStore("scope-stamping", async (_root, dbPath) => {
    createLegacyStore(dbPath);
    migrate(dbPath, TARGET_A);
    const backend = new SqliteScopedFrameStoreBackend(dbPath);
    const normalScope = scope(TARGET_A);
    const store = backend.bind(normalScope);
    await store.saveFrame({ ...legacyFrame("stamped"), userId: "forged" } as never);
    assert.equal((await store.getFrameById("stamped"))?.userId, undefined);
    assert.throws(() => backend.bindAdmin(normalScope));
    const admin = backend.bindAdmin(scope(TARGET_A, [FRAME_STORE_CAPABILITIES.ADMIN]));
    assert.deepEqual(await admin.getFrameOwnership("stamped"), {
      schemaVersion: 1,
      tenantId: TARGET_A.tenantId,
      workspaceId: TARGET_A.workspaceId,
      creatorPrincipalId: TARGET_A.creatorPrincipalId,
      scopeVersion: TARGET_A.scopeVersion,
    });

    const db = new Database(dbPath, { fileMustExist: true });
    assert.throws(() =>
      db.prepare("UPDATE frames SET tenant_id = ? WHERE id = ?").run(TARGET_B.tenantId, "stamped")
    );
    assert.throws(() =>
      db
        .prepare("UPDATE frame_store_scope SET workspace_id = ? WHERE singleton = 1")
        .run(TARGET_B.workspaceId)
    );
    assert.throws(() => db.prepare("DELETE FROM frame_store_scope WHERE singleton = 1").run());
    db.close();
    await backend.close();
  }));

test("runtime binding rejects non-UUID principals before they can be persisted", () =>
  withTempStore("scope-runtime-principal", async (_root, dbPath) => {
    createLegacyStore(dbPath);
    migrate(dbPath, TARGET_A);
    const backend = new SqliteScopedFrameStoreBackend(dbPath);
    assert.throws(
      () =>
        backend.bind({
          ...scope(TARGET_A),
          principalId: "principal-a" as PrincipalId,
        }),
      (error: unknown) =>
        error instanceof ScopedFrameStoreError &&
        error.code === SCOPED_FRAME_STORE_ERROR_CODES.INVALID_SCOPE
    );
    await backend.close();
  }));

test("stale, ambiguous, conflicting, and non-UUID mappings fail closed", () => {
  withTempStore("scope-fail-closed", (root, dbPath) => {
    createLegacyStore(dbPath, [legacyFrame()]);
    const manifest = createSqliteScopeMigrationManifest(dbPath, TARGET_A);
    const writer = createDatabase(dbPath);
    writer
      .prepare("UPDATE frames SET summary_caption = ? WHERE id = ?")
      .run("changed", "legacy-frame");
    writer.close();
    assert.throws(
      () => migrateSqliteStoreToScopedV15(dbPath, manifest, { write: true }),
      (error: unknown) =>
        error instanceof ScopedSqliteError &&
        error.code === SCOPED_SQLITE_ERROR_CODES.SOURCE_CHANGED
    );
    assert.equal(
      readdirSync(root).some((entry) => entry.endsWith(".bak")),
      false
    );
  });

  withTempStore("scope-partial", (_root, dbPath) => {
    createLegacyStore(dbPath);
    const db = createDatabase(dbPath);
    db.exec("CREATE TABLE frame_store_scope (singleton INTEGER PRIMARY KEY)");
    db.close();
    const inventory = inventorySqliteScope(dbPath);
    assert.notEqual(inventory.state, "legacy-unowned");
    assert.throws(() => createSqliteScopeMigrationManifest(dbPath, TARGET_A));
  });

  withTempStore("scope-invalid-id", (_root, dbPath) => {
    createLegacyStore(dbPath);
    assert.throws(
      () =>
        createSqliteScopeMigrationManifest(dbPath, {
          ...TARGET_A,
          tenantId: "tenant-a" as TenantId,
        }),
      (error: unknown) =>
        error instanceof ScopedSqliteError &&
        error.code === SCOPED_SQLITE_ERROR_CODES.MAPPING_CONFLICT
    );
  });

  withTempStore("scope-unknown-extension", (_root, dbPath) => {
    createLegacyStore(dbPath);
    const db = createDatabase(dbPath);
    db.exec("ALTER TABLE frames ADD COLUMN unknown_owner_hint TEXT");
    db.close();
    const inventory = inventorySqliteScope(dbPath);
    assert.equal(inventory.state, "malformed");
    assert.ok(inventory.issues.includes("legacy-frame-column:unknown_owner_hint"));
    assert.throws(() => createSqliteScopeMigrationManifest(dbPath, TARGET_A));
  });
});

test("a late transaction failure rolls back the rebuild and leaves recovery evidence", () =>
  withTempStore("scope-rollback", (root, dbPath) => {
    createLegacyStore(dbPath, [legacyFrame()]);
    const db = createDatabase(dbPath);
    db.exec(`
      CREATE TRIGGER reject_scope_v15 BEFORE INSERT ON schema_version
      WHEN new.version = 15 BEGIN
        SELECT RAISE(ABORT, 'simulated interruption');
      END;
    `);
    db.close();
    const manifest = createSqliteScopeMigrationManifest(dbPath, TARGET_A);
    assert.throws(
      () => migrateSqliteStoreToScopedV15(dbPath, manifest, { write: true }),
      (error: unknown) =>
        error instanceof ScopedSqliteError &&
        error.code === SCOPED_SQLITE_ERROR_CODES.RECOVERY_REQUIRED
    );
    const inventory = inventorySqliteScope(dbPath);
    assert.equal(inventory.state, "legacy-unowned");
    assert.equal(inventory.frameCount, 1);
    assert.equal(readdirSync(root).filter((entry) => entry.endsWith(".bak")).length, 1);
  }));

test("explicit recovery verifies the backup and restores the legacy source", () =>
  withTempStore("scope-recovery", (_root, dbPath) => {
    createLegacyStore(dbPath, [legacyFrame()]);
    const manifest = createSqliteScopeMigrationManifest(dbPath, TARGET_A);
    const migrated = migrateSqliteStoreToScopedV15(dbPath, manifest, { write: true });
    assert.ok(migrated.recoveryPath);
    const dryRun = recoverSqliteScopeMigration(dbPath, migrated.recoveryPath);
    assert.equal(dryRun.receipt.outcome, "ready");
    assert.equal(inventorySqliteScope(dbPath).state, "scoped");
    const restored = recoverSqliteScopeMigration(dbPath, migrated.recoveryPath, { write: true });
    assert.equal(restored.receipt.outcome, "restored");
    assert.equal(inventorySqliteScope(dbPath).state, "legacy-unowned");
    assert.equal(inventorySqliteScope(dbPath).frameCount, 1);
  }));

test("read-only scoped stores reject mutation while preserving normal reads", () =>
  withTempStore("scope-read-only", async (_root, dbPath) => {
    createLegacyStore(dbPath, [legacyFrame()]);
    migrate(dbPath, TARGET_A);
    chmodSync(dbPath, 0o444);
    const backend = new SqliteScopedFrameStoreBackend(dbPath, { accessMode: "read-only" });
    const store = backend.bind(scope(TARGET_A));
    assert.equal((await store.getFrameById("legacy-frame"))?.id, "legacy-frame");
    await assert.rejects(
      () => store.saveFrame(legacyFrame("blocked")),
      (error: unknown) =>
        error instanceof ScopedSqliteError && error.code === SCOPED_SQLITE_ERROR_CODES.READ_ONLY
    );
    await backend.close();
  }));

test("malformed persisted binding evidence is unreachable to normal service", () =>
  withTempStore("scope-binding-evidence", (_root, dbPath) => {
    createLegacyStore(dbPath);
    migrate(dbPath, TARGET_A);
    const db = new Database(dbPath, { fileMustExist: true });
    db.exec("DROP TRIGGER frame_store_scope_immutable_update");
    db.prepare("UPDATE frame_store_scope SET migration_receipt_json = ? WHERE singleton = 1").run(
      "not-json"
    );
    db.close();
    const inventory = inventorySqliteScope(dbPath);
    assert.equal(inventory.state, "malformed");
    assert.ok(inventory.issues.includes("binding-evidence:malformed"));
    assert.throws(
      () => new SqliteScopedFrameStoreBackend(dbPath),
      (error: unknown) =>
        error instanceof ScopedSqliteError &&
        error.code === SCOPED_SQLITE_ERROR_CODES.SCHEMA_MALFORMED
    );
  }));
