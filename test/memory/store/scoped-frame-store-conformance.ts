import assert from "node:assert/strict";

import type { Frame } from "@app/memory/frames/types.js";
import type { ScopedFrameStore } from "@app/memory/store/index.js";
import { exerciseFilteredSearchConformance } from "./filtered-search-conformance.js";

/** Backend-neutral normal-operation contract used by durable adapter suites. */
export async function exerciseScopedFrameStoreConformance(
  store: ScopedFrameStore,
  prefix: string
): Promise<void> {
  await exerciseFilteredSearchConformance(store, prefix);
  const recent = `${prefix}-recent`;
  const old = `${prefix}-old`;
  const superseded = `${prefix}-superseded`;
  const invalid = `${prefix}-invalid`;
  const now = "2026-07-18T12:00:00.000Z";

  const complete: Frame = {
    id: `${prefix}-complete-v8`,
    timestamp: "2026-07-18T11:59:00.000Z",
    branch: "feature/complete-frame-round-trip",
    jira: "LEX-768",
    module_scope: ["memory/store", "durability"],
    summary_caption: "Every canonical Frame field survives durable storage",
    reference_point: "complete Frame v8 round trip",
    status_snapshot: {
      next_action: "compare exact values",
      blockers: ["none"],
      merge_blockers: ["review"],
      tests_failing: ["zero"],
      provenance: {
        schemaVersion: "caller-provenance/v1",
        repository: { id: prefix, head: "0123456789abcdef" },
      },
    },
    keywords: ["durable", "metadata"],
    atlas_frame_id: "atlas-complete-v7",
    feature_flags: ["scoped-store"],
    permissions: ["frame:read", "frame:write"],
    module_attribution: {
      mode: "explicit",
      confidence: "high",
      evidence: ["shared conformance"],
    },
    image_ids: ["image-a", "image-b"],
    runId: "run-complete-v7",
    planHash: "sha256:complete-plan",
    spend: { prompts: 3, tokens_estimated: 987 },
    executorRole: "implementation-agent",
    toolCalls: ["read", "write", "test"],
    guardrailProfile: "strict",
    turnCost: {
      components: {
        latency: 12,
        contextReset: 2,
        renegotiation: 1,
        tokenBloat: 4,
        attentionSwitch: 0,
      },
      weights: { lambda: 0.1, gamma: 0.2, rho: 0.3, tau: 0.1, alpha: 0.3 },
      weightedScore: 2.5,
      sessionId: "session-complete-v7",
      timestamp: "2026-07-18T11:59:30.000Z",
    },
    capabilityTier: "senior",
    taskComplexity: {
      tier: "senior",
      assignedModel: "model-a",
      actualModel: "model-b",
      escalated: true,
      escalationReason: "durability review",
      retryCount: 1,
      tierMismatch: false,
    },
    superseded_by: "next-complete-frame",
    merged_from: ["prior-a", "prior-b"],
    contradiction_resolution: {
      type: "scope",
      contradicts_frame_id: "prior-a",
      scope: "memory/store",
      note: "Both statements apply in different scopes",
    },
  };
  await store.saveFrame(complete);
  assert.deepEqual(await store.getFrameById(complete.id), complete);
  const updatedComplete: Frame = {
    ...complete,
    toolCalls: ["read", "write", "test", "verify"],
    guardrailProfile: "strict-reviewed",
  };
  assert.equal(
    await store.updateFrame(complete.id, {
      toolCalls: updatedComplete.toolCalls,
      guardrailProfile: updatedComplete.guardrailProfile,
      id: "caller-controlled-id",
      timestamp: "1900-01-01T00:00:00.000Z",
      userId: "caller-controlled-user",
      tenantId: "caller-controlled-tenant",
    } as never),
    true
  );
  assert.deepEqual(await store.getFrameById(complete.id), updatedComplete);
  await assert.rejects(() => store.updateFrame(complete.id, { status_snapshot: {} as never }));
  assert.deepEqual(await store.getFrameById(complete.id), updatedComplete);
  assert.equal(await store.deleteFrame(complete.id), true);

  const moduleLimitMatch = `${prefix}-module-limit-match`;
  const moduleLimitOther = `${prefix}-module-limit-other`;
  await store.saveFrames([
    {
      id: moduleLimitOther,
      timestamp: "2026-07-18T11:58:00.000Z",
      branch: "feature/module-limit",
      module_scope: ["other/module"],
      summary_caption: "Newer frame outside the requested module",
      reference_point: "module filtering precedes limit",
      status_snapshot: { next_action: "remain excluded" },
    },
    {
      id: moduleLimitMatch,
      timestamp: "2026-07-18T11:57:00.000Z",
      branch: "feature/module-limit",
      module_scope: ["target/module"],
      summary_caption: "Older frame inside the requested module",
      reference_point: "module filtering precedes limit",
      status_snapshot: { next_action: "survive limit" },
    },
  ]);
  assert.deepEqual(
    (await store.searchFrames({ moduleScope: ["target/module"], limit: 1 })).map(({ id }) => id),
    [moduleLimitMatch]
  );
  assert.equal(await store.deleteFrame(moduleLimitOther), true);
  assert.equal(await store.deleteFrame(moduleLimitMatch), true);

  const hyphenTarget = `${prefix}-hyphen-target`;
  const hyphenDecoy = `${prefix}-hyphen-decoy`;
  await store.saveFrames([
    {
      id: hyphenTarget,
      timestamp: "2026-07-18T11:56:00.000Z",
      branch: "feature/hyphen-search",
      module_scope: ["target/search"],
      summary_caption: "Target compound reference",
      reference_point: "aligned-stack-dogfood-2026-08-28",
      status_snapshot: { next_action: "verify exact compound search" },
    },
    {
      id: hyphenDecoy,
      timestamp: "2026-07-18T11:55:00.000Z",
      branch: "feature/hyphen-search",
      module_scope: ["other/search"],
      summary_caption: "Prefix-only compound decoy",
      reference_point: "aligned-stack-dogfooding-2026-08-28",
      status_snapshot: { next_action: "remain excluded" },
    },
  ]);
  assert.deepEqual(
    (
      await store.searchFrames({
        query: "aligned-stack-dogfood-2026-08-28",
        exact: true,
        moduleScope: ["target/search"],
      })
    ).map(({ id }) => id),
    [hyphenTarget]
  );
  assert.deepEqual(
    (await store.searchFrames({ query: "aligned stack dogfood", exact: true })).map(({ id }) => id),
    [hyphenTarget]
  );
  assert.equal(await store.deleteFrame(hyphenDecoy), true);
  assert.equal(await store.deleteFrame(hyphenTarget), true);

  const batch = await store.saveFrames([
    {
      id: recent,
      timestamp: now,
      branch: "feature/scoped-sqlite",
      module_scope: ["memory/store", "sqlite"],
      summary_caption: "Scoped SQLite conformance",
      reference_point: "durable ownership filter",
      status_snapshot: { next_action: "verify every normal operation" },
      spend: { prompts: 2, tokens_estimated: 120 },
    },
    {
      id: old,
      timestamp: "2025-01-01T00:00:00.000Z",
      branch: "archive",
      module_scope: ["archive"],
      summary_caption: "Old scoped frame",
      reference_point: "delete before boundary",
      status_snapshot: { next_action: "delete explicitly" },
    },
    {
      id: superseded,
      timestamp: "2026-07-18T11:00:00.000Z",
      branch: "feature/scoped-sqlite",
      module_scope: ["memory/store"],
      summary_caption: "Superseded scoped frame",
      reference_point: "purge boundary",
      status_snapshot: { next_action: "purge explicitly" },
      superseded_by: recent,
    },
  ]);
  assert.deepEqual(
    batch.map(({ success }) => success),
    [true, true, true]
  );

  const aborted = await store.saveFrames([
    {
      id: invalid,
      timestamp: now,
      branch: "main",
      module_scope: [],
      summary_caption: "",
      reference_point: "",
      status_snapshot: {},
    },
    {
      id: `${prefix}-must-not-write`,
      timestamp: now,
      branch: "main",
      module_scope: ["memory/store"],
      summary_caption: "Must roll back",
      reference_point: "batch atomicity",
      status_snapshot: { next_action: "remain absent" },
    },
  ]);
  assert.equal(
    aborted.every(({ success }) => !success),
    true
  );
  assert.equal(await store.getFrameById(`${prefix}-must-not-write`), null);

  assert.equal((await store.getFrameById(recent))?.userId, undefined);
  assert.deepEqual(
    (await store.searchFrames({ query: "durable ownership", exact: true })).map(({ id }) => id),
    [recent]
  );
  const firstPage = await store.listFrames({ limit: 1 });
  assert.equal(firstPage.frames.length, 1);
  assert.equal(firstPage.page.hasMore, true);
  assert.ok(firstPage.page.nextCursor);
  const secondPage = await store.listFrames({ limit: 1, cursor: firstPage.page.nextCursor! });
  assert.equal(secondPage.frames.length, 1);
  assert.notEqual(secondPage.frames[0].id, firstPage.frames[0].id);
  assert.equal(await store.getFrameCount(), 3);

  const stats = await store.getStats(true);
  assert.equal(stats.totalFrames, 3);
  assert.equal(stats.moduleDistribution?.["memory/store"], 2);
  assert.deepEqual(await store.getTurnCostMetrics("2026-07-18T00:00:00.000Z"), {
    frameCount: 2,
    estimatedTokens: 120,
    prompts: 2,
  });

  assert.equal(
    await store.updateFrame(recent, {
      summary_caption: "Updated within the bound scope",
      userId: "caller-controlled-identity",
    } as never),
    true
  );
  assert.equal(
    (await store.getFrameById(recent))?.summary_caption,
    "Updated within the bound scope"
  );
  assert.equal((await store.getFrameById(recent))?.userId, undefined);

  assert.equal(await store.deleteFramesBefore(new Date("2026-01-01T00:00:00.000Z")), 1);
  assert.equal(await store.deleteFramesByBranch("not-present"), 0);
  assert.equal(await store.deleteFramesByModule("not-present"), 0);
  assert.equal(await store.purgeSuperseded(), 1);
  assert.equal(await store.deleteFrame(recent), true);
  assert.equal(await store.getFrameCount(), 0);
}
