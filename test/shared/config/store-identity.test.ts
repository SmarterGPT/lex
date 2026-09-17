import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { alternateStoreWarning, resolveStoreIdentity } from "@app/shared/config/store-identity.js";

test("store identity discovers alternate shared stores in project ancestors", () => {
  const root = mkdtempSync(join(tmpdir(), "lex-store-identity-"));
  const projectRoot = join(root, "repos", "app");
  const selected = join(projectRoot, ".smartergpt", "lex", "memory.db");
  const shared = join(root, ".smartergpt", "lex", "memory.db");
  mkdirSync(join(projectRoot, ".smartergpt", "lex"), { recursive: true });
  mkdirSync(join(root, ".smartergpt", "lex"), { recursive: true });
  writeFileSync(selected, "selected");
  writeFileSync(shared, "shared");

  try {
    const resolution = resolveStoreIdentity(selected, "default", projectRoot);
    const warning = alternateStoreWarning(resolution);

    assert.match(resolution.identity, /^path-v1:[a-f0-9]{16}$/);
    assert.ok(
      resolution.candidates.some(
        (candidate) => candidate.canonicalPath === realpathSync.native(shared)
      )
    );
    assert.ok(warning?.includes(realpathSync.native(shared)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
