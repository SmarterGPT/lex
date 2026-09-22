import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  buildKnowledgeContext,
  checkKnowledgeWorkspace,
  explainKnowledgeFrame,
  indexKnowledgeWorkspace,
  readKnowledgeWorkspace,
  type KnowledgeWorkspaceOptions,
} from "../../src/knowledge/index.js";

const COMMIT = "1234567890abcdef1234567890abcdef12345678";
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "lex-knowledge-workspace-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function markdown(title: string, body = "Observe the state transition."): string {
  return `<!-- lex:frame
id: repair-transition
type: probe
lifecycle: active
-->

## ${title}

${body}

<!-- lex:end -->`;
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function runFixtureGit(root: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function workspace(
  title = "Initial observation",
  body?: string
): {
  readonly root: string;
  readonly sourcePath: string;
  readonly databasePath: string;
  readonly options: KnowledgeWorkspaceOptions;
} {
  const root = temporaryDirectory();
  const sourcePath = join(root, "docs", "knowledge.md");
  const databasePath = join(root, ".smartergpt", "lex", "knowledge.db");
  write(join(root, "lex.yaml"), "version: 1\nknowledge:\n  sources:\n    - docs/knowledge.md\n");
  write(sourcePath, markdown(title, body));
  return {
    root,
    sourcePath,
    databasePath,
    options: {
      projectRoot: root,
      repositoryKey: "example/repo",
      databasePath,
      revision: { commitSha: COMMIT, branch: "main", dirtyPaths: new Set() },
    },
  };
}

describe("Knowledge workspace operations", () => {
  test("check validates without creating or writing a store", () => {
    const fixture = workspace();
    const result = checkKnowledgeWorkspace(fixture.options);

    assert.equal(result.operation, "knowledge-check");
    assert.equal(result.recordCount, 1);
    assert.equal(result.databaseWrites, 0);
    assert.equal(existsSync(fixture.databasePath), false);
  });

  test("context reports an unindexed workspace without creating a store", () => {
    const fixture = workspace();
    const context = buildKnowledgeContext(fixture.options);

    assert.equal(context.snapshot.freshness, "unindexed");
    assert.deepEqual(context.records, []);
    assert.equal(existsSync(fixture.databasePath), false);
  });

  test("index aborts before store creation when inputs change between fingerprints", () => {
    const fixture = workspace();
    const before = readKnowledgeWorkspace(fixture.options);
    write(fixture.sourcePath, markdown("Changed during index"));
    const after = readKnowledgeWorkspace(fixture.options);
    const reads = [before, after];

    assert.throws(
      () =>
        indexKnowledgeWorkspace({
          ...fixture.options,
          readWorkspace: () => reads.shift()!,
        }),
      /inputs changed during indexing/
    );
    assert.equal(existsSync(fixture.databasePath), false);
  });

  test("context returns current bodies through a hard read-only bounded projection", () => {
    const fixture = workspace();
    const indexed = indexKnowledgeWorkspace({
      ...fixture.options,
      now: () => new Date("2026-07-21T00:00:00.000Z"),
    });
    const context = buildKnowledgeContext({ ...fixture.options, query: "repair", maxBytes: 8_000 });

    assert.equal(context.snapshot.activeSnapshotId, indexed.snapshotId);
    assert.equal(context.snapshot.freshness, "current");
    assert.equal(context.records.length, 1);
    assert.equal(context.records[0].freshness, "current");
    assert.ok(context.records[0].whySelected.includes("query-match"));
    assert.equal(context.safety.contentTrust, "untrusted-project-data");
    assert.ok(context.budget.usedBytes <= context.budget.maxBytes);
    assert.equal(Buffer.byteLength(JSON.stringify(context), "utf8"), context.budget.usedBytes);
  });

  test("stale source content is never returned in preferred context", () => {
    const fixture = workspace("Before");
    indexKnowledgeWorkspace(fixture.options);
    write(fixture.sourcePath, markdown("After", "A stale body that must not be projected."));

    const context = buildKnowledgeContext(fixture.options);
    assert.equal(context.snapshot.freshness, "stale");
    assert.deepEqual(context.records, []);
    assert.ok(context.warnings.some((warning) => warning.includes("stored bodies were excluded")));
  });

  test("context preserves each hypothesis confidence and omits it on other record types", () => {
    for (const confidence of ["low", "medium", "high"] as const) {
      const fixture = workspace();
      write(
        fixture.sourcePath,
        markdown("Working hypothesis").replace(
          "type: probe",
          `type: hypothesis\nconfidence: ${confidence}`
        )
      );
      indexKnowledgeWorkspace(fixture.options);
      const context = buildKnowledgeContext(fixture.options);
      assert.equal(context.records.length, 1);
      assert.equal(context.records[0].type, "hypothesis");
      assert.equal(context.records[0].confidence, confidence);
      assert.equal(context.safety.contentTrust, "untrusted-project-data");
      assert.equal(context.budget.usedBytes, Buffer.byteLength(JSON.stringify(context), "utf8"));
    }
    for (const type of ["evidence", "seam", "probe"] as const) {
      const fixture = workspace();
      write(fixture.sourcePath, markdown("Observation").replace("type: probe", `type: ${type}`));
      indexKnowledgeWorkspace(fixture.options);
      const context = buildKnowledgeContext(fixture.options);
      assert.equal(context.records.length, 1);
      assert.equal(context.records[0].type, type);
      assert.equal(Object.hasOwn(context.records[0], "confidence"), false);
    }
  });

  test("confidence participates in the byte limit without being dropped to fit a hypothesis", () => {
    const fixture = workspace();
    write(
      fixture.sourcePath,
      markdown("Working hypothesis", "x".repeat(2_000)).replace(
        "type: probe",
        "type: hypothesis\nconfidence: medium"
      )
    );
    indexKnowledgeWorkspace(fixture.options);
    const full = buildKnowledgeContext({ ...fixture.options, maxBytes: 8_000 });
    assert.equal(full.records[0]?.confidence, "medium");
    const exactBudget = full.budget.usedBytes;
    assert.ok(exactBudget > 2_048 && exactBudget < 8_000);
    const fits = buildKnowledgeContext({ ...fixture.options, maxBytes: exactBudget });
    assert.equal(fits.records.length, 1);
    assert.equal(fits.budget.usedBytes, exactBudget);
    assert.equal(fits.records[0].confidence, "medium");
    const unqualified = structuredClone(fits);
    Reflect.deleteProperty(unqualified.records[0], "confidence");
    assert.ok(Buffer.byteLength(JSON.stringify(unqualified), "utf8") <= exactBudget - 1);

    const tooSmall = buildKnowledgeContext({ ...fixture.options, maxBytes: exactBudget - 1 });
    assert.deepEqual(tooSmall.records, [], "omit the whole hypothesis, never its qualification");
    assert.equal(tooSmall.budget.omittedRecords, 1);
    assert.equal(tooSmall.budget.usedBytes, Buffer.byteLength(JSON.stringify(tooSmall), "utf8"));
    assert.ok(tooSmall.budget.usedBytes <= tooSmall.budget.maxBytes);
  });

  test("a confidence-only source change excludes the stale snapshot until reindexing", () => {
    const fixture = workspace();
    const source = markdown("Working hypothesis").replace(
      "type: probe",
      "type: hypothesis\nconfidence: low"
    );
    write(fixture.sourcePath, source);
    indexKnowledgeWorkspace(fixture.options);
    write(fixture.sourcePath, source.replace("confidence: low", "confidence: high"));
    const stale = buildKnowledgeContext(fixture.options);
    assert.equal(stale.snapshot.freshness, "stale");
    assert.deepEqual(stale.records, []);
    indexKnowledgeWorkspace(fixture.options);
    const current = buildKnowledgeContext(fixture.options);
    assert.equal(current.snapshot.freshness, "current");
    assert.equal(current.records[0]?.confidence, "high");
  });

  test("removed blocks make the snapshot stale and cannot leak stored bodies", () => {
    const fixture = workspace("Before removal");
    indexKnowledgeWorkspace(fixture.options);
    write(fixture.sourcePath, "# Ordinary Markdown\n\nThe block was removed.\n");

    const context = buildKnowledgeContext(fixture.options);
    assert.equal(context.snapshot.freshness, "stale");
    assert.deepEqual(context.records, []);
    const explained = explainKnowledgeFrame("repair-transition", fixture.options);
    assert.equal(explained.freshness, "missing");
    assert.equal(explained.stored?.anchor, "repair-transition");
    assert.equal(explained.current, null);
  });

  test("one byte budget deterministically omits records that do not fit", () => {
    const fixture = workspace("Oversized", "x".repeat(2_000));
    indexKnowledgeWorkspace(fixture.options);

    const context = buildKnowledgeContext({ ...fixture.options, maxBytes: 2_048 });
    assert.deepEqual(context.records, []);
    assert.equal(context.budget.maxBytes, 2_048);
    assert.equal(context.budget.omittedRecords, 1);
    assert.ok(Buffer.byteLength(JSON.stringify(context), "utf8") <= context.budget.maxBytes);
  });

  test("explain preserves stored coordinates and locates the current ID after a file move", () => {
    const fixture = workspace();
    indexKnowledgeWorkspace(fixture.options);
    const movedPath = join(fixture.root, "notes", "moved.md");
    write(movedPath, markdown("Initial observation"));
    write(
      join(fixture.root, "lex.yaml"),
      "version: 1\nknowledge:\n  sources:\n    - notes/moved.md\n"
    );
    rmSync(fixture.sourcePath);

    const explained = explainKnowledgeFrame("repair-transition", fixture.options);
    assert.equal(explained.freshness, "stale");
    assert.equal(explained.stored?.path, "docs/knowledge.md");
    assert.equal(explained.current?.path, "notes/moved.md");
    assert.equal(explained.current?.anchor, "repair-transition");
  });

  test("reports invalid repository declarations as targeted compile errors", () => {
    const fixture = workspace();
    write(join(fixture.root, "lex.repository.json"), "{ invalid json");

    assert.throws(
      () => readKnowledgeWorkspace({ ...fixture.options, repositoryKey: undefined }),
      /Invalid lex\.repository\.json/
    );
  });

  test("derives dirty source paths from one workspace status snapshot", () => {
    const fixture = workspace();
    write(join(fixture.root, "docs", "other.md"), "ordinary markdown");
    runFixtureGit(fixture.root, ["init"]);
    runFixtureGit(fixture.root, ["add", "."]);
    // Build a baseline through plumbing so this default-suite test never invokes signing or hooks.
    const tree = runFixtureGit(fixture.root, ["write-tree"]);
    const commit = runFixtureGit(fixture.root, [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test",
      "commit-tree",
      tree,
      "-m",
      "fixture",
    ]);
    runFixtureGit(fixture.root, ["update-ref", "HEAD", commit]);
    write(fixture.sourcePath, markdown("Dirty observation"));
    write(join(fixture.root, "docs", "other.md"), "unrelated dirty markdown");

    const observed = readKnowledgeWorkspace({
      projectRoot: fixture.root,
      repositoryKey: "example/repo",
      databasePath: fixture.databasePath,
    });

    assert.equal(observed.compiled.records[0].provenance.sourceLayer, "working-tree");
    assert.equal(
      observed.compiled.records[0].provenance.baseCommitSha,
      observed.compiled.records[0].provenance.commitSha
    );
  });
});
