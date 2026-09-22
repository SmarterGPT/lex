import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

const lexBin = join(process.cwd(), "dist", "shared", "cli", "lex.js");
let projectRoot: string;

function run(args: readonly string[]): Record<string, unknown> {
  const stdout = execFileSync(process.execPath, [lexBin, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, LEX_LOG_LEVEL: "silent" },
  });
  return JSON.parse(stdout) as Record<string, unknown>;
}

before(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "lex-knowledge-cli-"));
  mkdirSync(join(projectRoot, "docs"), { recursive: true });
  writeFileSync(
    join(projectRoot, "lex.yaml"),
    "version: 1\nknowledge:\n  sources:\n    - docs/knowledge.md\n",
    "utf8"
  );
  writeFileSync(
    join(projectRoot, "docs", "knowledge.md"),
    `<!-- lex:frame
id: repair-transition
type: probe
lifecycle: active
-->

## Observe repair transition

Capture the state before and after repair.

<!-- lex:end -->` +
      ["low", "medium", "high"]
        .map(
          (confidence) => `

<!-- lex:frame
id: cache-hypothesis-${confidence}
type: hypothesis
lifecycle: active
confidence: ${confidence}
-->

## Cache state ${confidence}

A working explanation of cache behavior.

<!-- lex:end -->`
        )
        .join(""),
    "utf8"
  );
  execFileSync("git", ["init", "--quiet"], { cwd: projectRoot });
  execFileSync("git", ["add", "."], { cwd: projectRoot });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Lex Test",
      "-c",
      "user.email=lex-test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
    { cwd: projectRoot }
  );
});

after(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("lex knowledge", () => {
  test("check emits structured JSON and performs no store write", () => {
    const result = run(["knowledge", "check", "--repository-key", "example/repo"]);
    assert.equal(result.operation, "knowledge-check");
    assert.equal(result.recordCount, 4);
    assert.equal(result.databaseWrites, 0);
    assert.equal(existsSync(join(projectRoot, ".smartergpt", "lex", "knowledge.db")), false);
  });

  test("index, context, and explain share one structured provider contract", () => {
    const indexed = run(["knowledge", "index", "--repository-key", "example/repo"]);
    assert.equal(indexed.operation, "knowledge-index");
    assert.equal(indexed.activated, true);

    const context = run([
      "knowledge",
      "context",
      "repair",
      "--repository-key",
      "example/repo",
      "--max-bytes",
      "8000",
    ]);
    assert.equal(context.operation, "knowledge-context");
    assert.equal((context.snapshot as { freshness: string }).freshness, "current");
    assert.equal((context.records as unknown[]).length, 1);
    assert.equal(Object.hasOwn((context.records as object[])[0], "confidence"), false);

    const hypotheses = run(["knowledge", "context", "cache", "--repository-key", "example/repo"]);
    const records = hypotheses.records as Array<{ id: string; type: string; confidence?: string }>;
    assert.equal(records.length, 3);
    assert.ok(records.every(({ type }) => type === "hypothesis"));
    assert.deepEqual(Object.fromEntries(records.map(({ id, confidence }) => [id, confidence])), {
      "cache-hypothesis-low": "low",
      "cache-hypothesis-medium": "medium",
      "cache-hypothesis-high": "high",
    });
    assert.equal(
      (hypotheses.budget as { usedBytes: number }).usedBytes,
      Buffer.byteLength(JSON.stringify(hypotheses), "utf8")
    );

    const explained = run([
      "knowledge",
      "explain",
      "repair-transition",
      "--repository-key",
      "example/repo",
    ]);
    assert.equal(explained.operation, "knowledge-explain");
    assert.equal(explained.freshness, "current");
    assert.equal((explained.current as { anchor: string }).anchor, "repair-transition");
  });
});
