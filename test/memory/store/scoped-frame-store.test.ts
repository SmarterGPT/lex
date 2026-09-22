import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Frame } from "@app/memory/frames/types.js";
import {
  FRAME_STORE_CAPABILITIES,
  SCOPED_FRAME_STORE_ERROR_CODES,
  MemoryScopedFrameStoreBackend,
  ScopedFrameStoreError,
  type ScopedFrameInput,
  type ScopedFrameListOptions,
  type ScopedFrameSearchCriteria,
  type ScopedFrameUpdate,
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
import { exerciseScopedFrameStoreConformance } from "./scoped-frame-store-conformance.js";

type AssertNever<Value extends never> = Value;
type ForbiddenSelector = "tenantId" | "workspaceId" | "principalId" | "userId";
type _SearchHasNoAuthoritySelector = AssertNever<
  Extract<keyof ScopedFrameSearchCriteria, ForbiddenSelector>
>;
type _ListHasNoAuthoritySelector = AssertNever<
  Extract<keyof ScopedFrameListOptions, ForbiddenSelector>
>;
type _WriteHasNoAuthoritySelector = AssertNever<Extract<keyof ScopedFrameInput, ForbiddenSelector>>;
type _UpdateHasNoAuthoritySelector = AssertNever<
  Extract<keyof ScopedFrameUpdate, ForbiddenSelector>
>;

const ALL_NORMAL_CAPABILITIES = [
  FRAME_STORE_CAPABILITIES.READ,
  FRAME_STORE_CAPABILITIES.WRITE,
  FRAME_STORE_CAPABILITIES.DELETE,
];

function scope(
  tenant: string,
  workspace: string,
  principal: string,
  capabilities: readonly CapabilityId[] = ALL_NORMAL_CAPABILITIES,
  overrides: Partial<AuthorizedScopeV1> = {}
): AuthorizedScopeV1 {
  return {
    schemaVersion: RUNTIME_SCOPE_CONTRACT_VERSION,
    grantId: `grant-${tenant}-${workspace}-${principal}` as AuthorityGrantId,
    tenantId: tenant as TenantId,
    workspaceId: workspace as WorkspaceId,
    principalId: principal as PrincipalId,
    capabilities,
    authorityVersion: "authority-v1" as AuthorityVersion,
    scopeVersion: "scope-v1" as ScopeVersion,
    authorityDigest: "sha256:authority" as ContentDigest,
    verifiedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

function frame(id: string, overrides: Partial<Frame> = {}): ScopedFrameInput {
  return {
    id,
    timestamp: "2026-07-18T01:00:00.000Z",
    branch: "agent/759-scoped-frame-store",
    module_scope: ["memory/store"],
    summary_caption: `Scoped Frame ${id}`,
    reference_point: "scope-bound persistence",
    status_snapshot: { next_action: "verify FrameStore isolation" },
    ...overrides,
  };
}

async function rejectsWithCode(
  operation: () => Promise<unknown>,
  code: string,
  capability?: CapabilityId
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof ScopedFrameStoreError);
    assert.equal(error.code, code);
    assert.equal(error.requiredCapability, capability);
    return true;
  });
}

describe("MemoryScopedFrameStoreBackend", () => {
  test("satisfies the shared normal-operation and exact Frame round-trip contract", async () => {
    const backend = new MemoryScopedFrameStoreBackend();
    const store = backend.bind(scope("tenant-a", "workspace-a", "principal-a"));
    await exerciseScopedFrameStoreConformance(store, "memory");
    await backend.close();
  });

  test("serializes validated partial merges without losing unrelated concurrent fields", async () => {
    const backend = new MemoryScopedFrameStoreBackend();
    const store = backend.bind(scope("tenant-a", "workspace-a", "principal-a"));
    await store.saveFrame(frame("atomic-update"));
    await Promise.all([
      store.updateFrame("atomic-update", { jira: "LEX-768" }),
      store.updateFrame("atomic-update", { keywords: ["preserved"] }),
    ]);
    const updated = await store.getFrameById("atomic-update");
    assert.equal(updated?.jira, "LEX-768");
    assert.deepEqual(updated?.keywords, ["preserved"]);
    await backend.close();
  });

  test("binds an immutable snapshot without expanding attenuated capabilities", async () => {
    const mutableCapabilities = [FRAME_STORE_CAPABILITIES.READ];
    const mutableScope = scope("tenant-a", "workspace-a", "principal-a", mutableCapabilities);
    const backend = new MemoryScopedFrameStoreBackend();
    const store = backend.bind(mutableScope);

    mutableCapabilities.push(FRAME_STORE_CAPABILITIES.WRITE);
    assert.notEqual(store.authorizedScope, mutableScope);
    assert.equal(Object.isFrozen(store.authorizedScope), true);
    assert.equal(Object.isFrozen(store.authorizedScope.capabilities), true);
    assert.deepEqual(store.authorizedScope.capabilities, [FRAME_STORE_CAPABILITIES.READ]);
    await rejectsWithCode(
      () => store.saveFrame(frame("cannot-write")),
      SCOPED_FRAME_STORE_ERROR_CODES.CAPABILITY_MISSING,
      FRAME_STORE_CAPABILITIES.WRITE
    );

    await backend.close();
  });

  test("rejects missing, future-version, and already-expired scope", () => {
    const backend = new MemoryScopedFrameStoreBackend({
      now: () => new Date("2026-07-18T02:00:00.000Z"),
    });
    assert.throws(
      () => backend.bind(undefined as unknown as AuthorizedScopeV1),
      (error: unknown) =>
        error instanceof ScopedFrameStoreError &&
        error.code === SCOPED_FRAME_STORE_ERROR_CODES.INVALID_SCOPE
    );
    assert.throws(
      () => backend.bind({ ...scope("t", "w", "p"), schemaVersion: 2 } as never),
      (error: unknown) =>
        error instanceof ScopedFrameStoreError &&
        error.code === SCOPED_FRAME_STORE_ERROR_CODES.INVALID_SCOPE
    );
    assert.throws(
      () =>
        backend.bind(
          scope("t", "w", "p", ALL_NORMAL_CAPABILITIES, {
            expiresAt: "2026-07-18T01:59:59.999Z",
          })
        ),
      (error: unknown) =>
        error instanceof ScopedFrameStoreError &&
        error.code === SCOPED_FRAME_STORE_ERROR_CODES.SCOPE_EXPIRED
    );
  });

  test("isolates identical Frame IDs across tenant and workspace ownership", async () => {
    const backend = new MemoryScopedFrameStoreBackend();
    const workspaceA = backend.bind(scope("tenant-a", "workspace-a", "principal-a"));
    const workspaceB = backend.bind(scope("tenant-a", "workspace-b", "principal-a"));
    const tenantB = backend.bind(scope("tenant-b", "workspace-a", "principal-a"));

    await workspaceA.saveFrame(frame("same-id", { summary_caption: "owned by workspace A" }));
    await workspaceB.saveFrame(frame("same-id", { summary_caption: "owned by workspace B" }));
    await tenantB.saveFrame(frame("same-id", { summary_caption: "owned by tenant B" }));

    assert.equal(
      (await workspaceA.getFrameById("same-id"))?.summary_caption,
      "owned by workspace A"
    );
    assert.equal(
      (await workspaceB.getFrameById("same-id"))?.summary_caption,
      "owned by workspace B"
    );
    assert.equal((await tenantB.getFrameById("same-id"))?.summary_caption, "owned by tenant B");
    assert.equal(await workspaceA.getFrameCount(), 1);
    assert.equal(await workspaceB.getFrameCount(), 1);
    assert.equal(await tenantB.getFrameCount(), 1);

    assert.equal(await workspaceA.deleteFrame("same-id"), true);
    assert.equal(await workspaceA.getFrameById("same-id"), null);
    assert.equal(
      (await workspaceB.getFrameById("same-id"))?.summary_caption,
      "owned by workspace B"
    );
    assert.equal((await tenantB.getFrameById("same-id"))?.summary_caption, "owned by tenant B");

    await backend.close();
  });

  test("stamps creator internally and ignores caller ownership on create and update", async () => {
    const backend = new MemoryScopedFrameStoreBackend();
    const writer = backend.bind(scope("tenant-a", "workspace-a", "principal-creator"));
    const sameWorkspaceWriter = backend.bind(
      scope("tenant-a", "workspace-a", "principal-collaborator")
    );
    const admin = backend.bindAdmin(
      scope("tenant-a", "workspace-a", "principal-admin", [FRAME_STORE_CAPABILITIES.ADMIN])
    );
    const spoofedFrame = {
      ...frame("creator-stamp"),
      userId: "caller-controlled-principal",
      tenantId: "caller-controlled-tenant",
      workspaceId: "caller-controlled-workspace",
      creatorPrincipalId: "caller-controlled-principal",
    } as unknown as ScopedFrameInput;

    await writer.saveFrame(spoofedFrame);
    const storedFrame = await writer.getFrameById("creator-stamp");
    assert.ok(storedFrame);
    assert.equal(storedFrame.userId, undefined);
    assert.equal("tenantId" in (storedFrame as unknown as Record<string, unknown>), false);
    assert.equal("workspaceId" in (storedFrame as unknown as Record<string, unknown>), false);
    assert.equal(
      "creatorPrincipalId" in (storedFrame as unknown as Record<string, unknown>),
      false
    );
    assert.deepEqual(await admin.getFrameOwnership("creator-stamp"), {
      schemaVersion: 1,
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      creatorPrincipalId: "principal-creator",
      scopeVersion: "scope-v1",
    });

    await sameWorkspaceWriter.updateFrame("creator-stamp", {
      summary_caption: "collaborator update",
      userId: "replacement-principal",
    } as unknown as ScopedFrameUpdate);
    assert.equal(
      (await writer.getFrameById("creator-stamp"))?.summary_caption,
      "collaborator update"
    );
    assert.equal((await writer.getFrameById("creator-stamp"))?.userId, undefined);
    assert.equal(
      (await admin.getFrameOwnership("creator-stamp"))?.creatorPrincipalId,
      "principal-creator"
    );

    await sameWorkspaceWriter.saveFrame({
      ...frame("creator-stamp"),
      summary_caption: "collaborator upsert",
    });
    assert.equal(
      (await admin.getFrameOwnership("creator-stamp"))?.creatorPrincipalId,
      "principal-creator"
    );

    await backend.close();
  });

  test("checks read, write, delete, and admin capabilities at operation boundaries", async () => {
    const backend = new MemoryScopedFrameStoreBackend();
    const writer = backend.bind(scope("tenant-a", "workspace-a", "writer"));
    await writer.saveFrame(frame("capability-frame"));
    const readOnly = backend.bind(
      scope("tenant-a", "workspace-a", "reader", [FRAME_STORE_CAPABILITIES.READ])
    );
    const empty = backend.bind(scope("tenant-a", "workspace-a", "empty", []));

    assert.equal((await readOnly.listFrames()).frames.length, 1);
    assert.equal(await readOnly.getFrameCount(), 1);
    await rejectsWithCode(
      () => readOnly.updateFrame("capability-frame", { jira: "LEX-759" }),
      SCOPED_FRAME_STORE_ERROR_CODES.CAPABILITY_MISSING,
      FRAME_STORE_CAPABILITIES.WRITE
    );
    await rejectsWithCode(
      () => readOnly.deleteFrame("capability-frame"),
      SCOPED_FRAME_STORE_ERROR_CODES.CAPABILITY_MISSING,
      FRAME_STORE_CAPABILITIES.DELETE
    );
    await rejectsWithCode(
      () => empty.getFrameById("capability-frame"),
      SCOPED_FRAME_STORE_ERROR_CODES.CAPABILITY_MISSING,
      FRAME_STORE_CAPABILITIES.READ
    );
    assert.throws(
      () => backend.bindAdmin(scope("tenant-a", "workspace-a", "not-admin", [])),
      (error: unknown) =>
        error instanceof ScopedFrameStoreError &&
        error.requiredCapability === FRAME_STORE_CAPABILITIES.ADMIN
    );

    await backend.close();
  });

  test("keeps list, search, statistics, batch, and bulk deletion inside the bound scope", async () => {
    const backend = new MemoryScopedFrameStoreBackend();
    const workspaceA = backend.bind(scope("tenant-a", "workspace-a", "principal-a"));
    const workspaceB = backend.bind(scope("tenant-a", "workspace-b", "principal-a"));
    const batch = [
      frame("old", {
        timestamp: "2026-06-01T00:00:00.000Z",
        summary_caption: "Scoped alpha history",
        spend: { tokens_estimated: 10, prompts: 1 },
      }),
      frame("new", {
        timestamp: "2026-07-18T01:00:00.000Z",
        summary_caption: "Scoped beta current",
        module_scope: ["memory/store", "memory/scope"],
        spend: { tokens_estimated: 20, prompts: 2 },
        superseded_by: "replacement",
      }),
    ];
    assert.equal(
      (await workspaceA.saveFrames(batch)).every((result) => result.success),
      true
    );
    await workspaceB.saveFrame(frame("hidden", { summary_caption: "Scoped alpha hidden" }));

    assert.deepEqual(
      (await workspaceA.searchFrames({ query: "alpha" })).map(({ id }) => id),
      ["old"]
    );
    assert.deepEqual(
      (
        await workspaceA.searchFrames({
          query: "alpha",
          branch: "agent/759-scoped-frame-store",
          moduleScope: ["memory/store"],
          limit: 1,
        })
      ).map(({ id }) => id),
      ["old"],
      "a newer matching Frame in another workspace must not displace the scoped hit"
    );
    assert.deepEqual(
      (await workspaceA.listFrames({ limit: 10 })).frames.map(({ id }) => id),
      ["new", "old"]
    );
    assert.equal((await workspaceA.getStats(true)).totalFrames, 2);
    assert.deepEqual(await workspaceA.getTurnCostMetrics(), {
      frameCount: 2,
      estimatedTokens: 30,
      prompts: 3,
    });
    assert.equal(await workspaceA.purgeSuperseded(), 1);
    assert.equal(await workspaceA.deleteFramesBefore(new Date("2026-07-01T00:00:00.000Z")), 1);
    assert.equal(await workspaceA.getFrameCount(), 0);
    assert.equal(await workspaceB.getFrameCount(), 1);

    await backend.close();
  });

  test("rechecks expiry and closes views independently from the shared backend", async () => {
    let now = new Date("2026-07-18T01:00:00.000Z");
    const backend = new MemoryScopedFrameStoreBackend({ now: () => now });
    const expiring = scope("tenant-a", "workspace-a", "principal-a", ALL_NORMAL_CAPABILITIES, {
      expiresAt: "2026-07-18T02:00:00.000Z",
    });
    const first = backend.bind(expiring);
    const second = backend.bind(expiring);
    await first.saveFrame(frame("lifecycle"));

    await first.close();
    await rejectsWithCode(
      () => first.getFrameById("lifecycle"),
      SCOPED_FRAME_STORE_ERROR_CODES.STORE_CLOSED
    );
    assert.equal((await second.getFrameById("lifecycle"))?.id, "lifecycle");

    now = new Date("2026-07-18T02:00:00.000Z");
    await rejectsWithCode(
      () => second.getFrameById("lifecycle"),
      SCOPED_FRAME_STORE_ERROR_CODES.SCOPE_EXPIRED
    );
    await backend.close();
    assert.throws(
      () => backend.bind(scope("tenant-a", "workspace-a", "principal-a")),
      (error: unknown) =>
        error instanceof ScopedFrameStoreError &&
        error.code === SCOPED_FRAME_STORE_ERROR_CODES.STORE_CLOSED
    );
  });
});
