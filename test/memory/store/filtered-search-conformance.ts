import assert from "node:assert/strict";

import type { Frame } from "@app/memory/frames/types.js";
import type { FrameStore } from "@app/memory/store/frame-store.js";

/** Search relevance filters must constrain the candidate set before its limit. */
export async function exerciseFilteredSearchConformance(
  store: Pick<FrameStore, "saveFrames" | "searchFrames" | "deleteFrame">,
  prefix: string
): Promise<void> {
  const branch = "feature/recovery_%";
  const moduleScope = ["target/search"];
  const frames: Frame[] = [];
  const frame = (suffix: string, overrides: Partial<Frame> = {}): Frame => ({
    id: `${prefix}-${suffix}`,
    timestamp: "2026-01-05T00:00:00.000Z",
    branch,
    module_scope: moduleScope,
    summary_caption: "Retrieval evidence",
    reference_point: "bounded candidate selection",
    status_snapshot: { next_action: "check current context" },
    ...overrides,
  });
  const save = async (batch: Frame[]) => {
    frames.push(...batch);
    assert.ok((await store.saveFrames(batch)).every(({ success }) => success));
  };

  try {
    await save([
      frame("target-a"),
      frame("target-z"),
      frame("module-only", { branch: "other/branch", timestamp: "2026-01-06T00:00:00.000Z" }),
      frame("branch-only", {
        module_scope: ["other/module"],
        timestamp: "2026-01-07T00:00:00.000Z",
      }),
      frame("case-decoy", {
        branch: branch.toUpperCase(),
        module_scope: ["other/module"],
        timestamp: "2026-01-08T00:00:00.000Z",
      }),
      ...Array.from({ length: 64 }, (_, index) =>
        frame(`noise-${index}`, {
          branch: "other/branch",
          module_scope: ["other/module"],
          timestamp: "2026-02-01T00:00:00.000Z",
        })
      ),
    ]);
    assert.deepEqual(
      (await store.searchFrames({ branch, limit: 1 })).map(({ id }) => id),
      [`${prefix}-branch-only`],
      "older exact-branch hits survive a newer unrelated candidate window"
    );
    assert.deepEqual(
      (await store.searchFrames({ moduleScope, limit: 1 })).map(({ id }) => id),
      [`${prefix}-module-only`],
      "older module hits survive a newer unrelated candidate window"
    );
    assert.deepEqual(await store.searchFrames({ branch: "feature/recovery__", limit: 1 }), []);
    assert.deepEqual(await store.searchFrames({ branch: "' OR 1=1 --", limit: 1 }), []);
    assert.deepEqual(
      (await store.searchFrames({ branch, moduleScope, limit: 2 })).map(({ id }) => id),
      [`${prefix}-target-z`, `${prefix}-target-a`],
      "equal timestamps use descending IDs rather than insertion order"
    );

    await save([
      frame("query-decoy", {
        summary_caption: "Unrelated evidence",
        timestamp: "2026-01-05T01:00:00.000Z",
      }),
      frame("too-old", { timestamp: "2026-01-03T00:00:00.000Z" }),
      frame("too-new", { timestamp: "2026-01-08T00:00:00.000Z" }),
    ]);
    assert.deepEqual(
      (
        await store.searchFrames({
          query: "retrieval",
          exact: true,
          branch,
          moduleScope,
          since: new Date("2026-01-04T00:00:00.000Z"),
          until: new Date("2026-01-06T00:00:00.000Z"),
          limit: 1,
        })
      ).map(({ id }) => id),
      [`${prefix}-target-z`],
      "text, branch, module, and time filters remain conjunctive before limiting"
    );
  } finally {
    for (const { id } of frames) await store.deleteFrame(id);
  }
}
