import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";

import {
  DEFAULT_EXCLUDED_TEST_PATHS,
  DEFAULT_EXCLUDED_TEST_PREFIXES,
  classifyDefaultTest,
  discoverDefaultTests,
  runTestProcess,
} from "../../scripts/run-tests.mjs";

test("test-process watchdog terminates a stalled child and preserves normal exit status", () => {
  const normal = runTestProcess(["-e", "process.exitCode = 3"], { timeoutMs: 5000 });
  assert.equal(normal.status, 3);
  const stalled = runTestProcess(["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 300 });
  assert.equal(stalled.error?.code, "ETIMEDOUT");
  assert.notEqual(stalled.status, 0);
  assert.throws(() => runTestProcess([], { timeoutMs: 0 }), /Invalid test deadline/);
});

const fixtureRoot = mkdtempSync(join(tmpdir(), "lex-portable-test-runner-"));

after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function createFixture(relativePath) {
  const path = join(fixtureRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
}

test("discovers supported test files in deterministic groups", () => {
  [
    "test/zeta.test.ts",
    "test/nested/alpha.test.mts",
    "test/nested/bravo.spec.ts",
    "test/nested/charlie.test.mjs",
    "test/nested/ignored.spec.mjs",
    "test/nested/ignored.test.tsx",
    "test/nested/helper.ts",
  ].forEach(createFixture);

  assert.deepEqual(discoverDefaultTests(fixtureRoot), {
    typescript: ["test/nested/alpha.test.mts", "test/nested/bravo.spec.ts", "test/zeta.test.ts"],
    javascript: ["test/nested/charlie.test.mjs"],
    excluded: [],
  });
});

test("keeps every default-suite quarantine explicit", () => {
  assert.deepEqual(DEFAULT_EXCLUDED_TEST_PREFIXES, ["test/shared/git/"]);
  assert.deepEqual(DEFAULT_EXCLUDED_TEST_PATHS, [
    "test/memory/api-ingestion.perf.test.ts",
    "test/memory/store/encryption-edge-cases.spec.ts",
    "test/shared/cli/export.test.ts",
    "test/shared/paths/normalizer.test.ts",
    "test/shared/tokens/expander.test.ts",
  ]);

  for (const path of DEFAULT_EXCLUDED_TEST_PATHS) {
    assert.equal(classifyDefaultTest(path), "excluded");
    assert.equal(classifyDefaultTest(path.replaceAll("/", "\\")), "excluded");
  }
  assert.equal(classifyDefaultTest("test/shared/git/nested.test.ts"), "excluded");
});

test("does not quarantine unrelated tests with similar names", () => {
  assert.equal(classifyDefaultTest("test/feature/export.test.ts"), "typescript");
  assert.equal(classifyDefaultTest("test/shared/git-adapter/run.test.ts"), "typescript");
});
