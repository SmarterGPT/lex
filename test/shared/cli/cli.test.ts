/**
 * CLI Tests
 *
 * Tests for lex remember, lex recall, and lex check commands
 */

import { test } from "node:test";
import assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  canonicalizeStorePath,
  createStoreIdentity,
} from "../../../src/shared/config/store-identity.js";

const testDir = join(tmpdir(), "lex-cli-test-" + Date.now());
const testDbPath = join(testDir, "frames.db");
const lexBin = join(process.cwd(), "dist", "shared", "cli", "lex.js");

// Create safe test environment (isolated from process.env to prevent shell injection)
// LEX_DEFAULT_BRANCH prevents git commands from being called during tests
function getTestEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    LEX_LOG_LEVEL: "silent",
    LEX_POLICY_PATH: join(testDir, "lexmap.policy.json"),
    LEX_DB_PATH: testDbPath,
    LEX_DEFAULT_BRANCH: "test-branch", // Prevents git calls
    PATH: process.env.PATH, // Only inherit PATH for node resolution
  };
}

// Setup test environment
function setupTest() {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
  mkdirSync(testDir, { recursive: true });

  // Create a minimal policy file for testing
  const policyPath = join(testDir, "lexmap.policy.json");
  const policy = {
    modules: {
      "ui/admin-panel": {
        owns_paths: ["web-ui/admin/**"],
      },
      "services/auth-core": {
        owns_paths: ["backend/auth/**"],
        forbidden_callers: ["ui/**"],
      },
      "services/user-api": {
        owns_paths: ["backend/users/**"],
      },
    },
  };
  writeFileSync(policyPath, JSON.stringify(policy, null, 2));

  // Set environment variable for policy path
  process.env.LEX_POLICY_PATH = policyPath;
  process.env.LEX_DB_PATH = testDbPath;
}

function cleanup() {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
  delete process.env.LEX_POLICY_PATH;
  delete process.env.LEX_DB_PATH;
}

test("CLI: lex --version shows version", () => {
  setupTest();
  try {
    const output = execFileSync(process.execPath, [lexBin, "--version"], { encoding: "utf-8" });
    assert.match(output, /\d+\.\d+\.\d+/, "Version should be in semver format");
  } finally {
    cleanup();
  }
});

test("CLI: lex --help shows help text", () => {
  setupTest();
  try {
    const output = execFileSync(process.execPath, [lexBin, "--help"], { encoding: "utf-8" });
    assert.match(output, /remember/, "Help should mention remember command");
    assert.match(output, /recall/, "Help should mention recall command");
    assert.match(output, /context/, "Help should mention context command");
    assert.match(output, /check/, "Help should mention check command");
  } finally {
    cleanup();
  }
});

test("CLI: lex remember --help surfaces the required module contract", () => {
  setupTest();
  try {
    const output = execFileSync(process.execPath, [lexBin, "remember", "--help"], {
      encoding: "utf-8",
    });
    assert.match(output, /Required module IDs/);
    assert.match(output, /auto.*inference/);
    assert.match(output, /unscoped.*fallback/);
    assert.match(output, /required\s+Frame\s+fields still apply/);
    assert.match(output, /provenance-json/);
  } finally {
    cleanup();
  }
});

test("CLI: lex remember --modules auto records inferred attribution", () => {
  setupTest();
  try {
    const output = execFileSync(
      process.execPath,
      [
        lexBin,
        "--json",
        "remember",
        "--summary",
        "Continue user API work",
        "--next",
        "Run API tests",
        "--modules",
        "auto",
      ],
      { encoding: "utf-8", env: getTestEnv() }
    );
    const event = JSON.parse(output.trim());
    assert.strictEqual(event.data.moduleAttribution.mode, "inferred");
    assert.ok(event.data.modules.length > 0);
    assert.strictEqual(event.data.referencePoint, "Continue user API work");
  } finally {
    cleanup();
  }
});

test("CLI: lex remember with valid module_scope succeeds", () => {
  setupTest();
  try {
    const output = execFileSync(
      process.execPath,
      [
        lexBin,
        "remember",
        "--reference-point",
        "test frame",
        "--summary",
        "Test summary",
        "--next",
        "Test next action",
        "--modules",
        "ui/admin-panel,services/user-api",
      ],
      { encoding: "utf-8", env: getTestEnv() }
    );

    assert.match(output, /Frame created successfully/, "Should show success message");
    assert.match(output, /Frame ID:/, "Should show Frame ID");
  } finally {
    cleanup();
  }
});

test("CLI: lex remember with invalid module_scope fails", () => {
  setupTest();
  try {
    execFileSync(
      process.execPath,
      [
        lexBin,
        "remember",
        "--reference-point",
        "test frame",
        "--summary",
        "Test summary",
        "--next",
        "Test next action",
        "--modules",
        "invalid-module",
      ],
      { encoding: "utf-8", env: getTestEnv() }
    );
    assert.fail("Should have thrown an error");
  } catch (error: any) {
    assert.match(
      error.stderr || error.stdout,
      /Module validation failed/,
      "Should show validation error"
    );
  } finally {
    cleanup();
  }
});

test("CLI: lex remember with --json outputs JSON", () => {
  setupTest();
  try {
    const output = execFileSync(
      process.execPath,
      [
        lexBin,
        "--json",
        "remember",
        "--reference-point",
        "json test",
        "--summary",
        "JSON test",
        "--next",
        "Test action",
        "--modules",
        "ui/admin-panel",
      ],
      { encoding: "utf-8", env: getTestEnv() }
    );

    // AX v0.1: --json outputs CliEvent format with v, ts, level, message, data
    const event = JSON.parse(output.trim());
    assert.equal(event.v, 1, "CliEvent should have version 1");
    assert.ok(event.ts, "CliEvent should have timestamp");
    assert.equal(event.level, "success", "Should be success level");
    assert.ok(event.data?.frame_id, "data should contain frame_id");
    assert.ok(event.data?.created_at, "data should contain created_at");
    assert.equal(event.data?.success, true, "data should contain success: true");
    assert.equal(event.data?.branch, "test-branch", "existing branch field should be preserved");
    assert.deepEqual(
      event.data?.modules,
      ["ui/admin-panel"],
      "existing modules should be preserved"
    );
    assert.equal(
      event.data?.referencePoint,
      "json test",
      "existing referencePoint should be preserved"
    );

    const canonicalStorePath = canonicalizeStorePath(testDbPath);
    const expectedStoreIdentity = createStoreIdentity(canonicalStorePath);
    assert.equal(
      event.data?.storeIdentity,
      expectedStoreIdentity,
      "receipt should bind the exact selected store identity"
    );
    assert.deepEqual(event.data?.store, {
      backend: "sqlite",
      canonicalLocation: canonicalStorePath,
      identity: expectedStoreIdentity,
    });
    assert.equal(
      Object.prototype.hasOwnProperty.call(event.data, "provenance"),
      false,
      "existing no-provenance receipts should not gain an asserted provenance value"
    );
  } finally {
    cleanup();
  }
});

test("CLI: caller provenance persists exactly from remember receipt through context", () => {
  setupTest();
  try {
    const referencePoint = "caller provenance round trip";
    const provenance = {
      schemaVersion: "caller-handoff/v1",
      workspace: { id: "workspace-fixture", root: "D:\\fixture" },
      repositories: [{ id: "repo-a", head: "0123456789abcdef", issue: null, pullRequest: 42 }],
      verified: true,
    };
    const rememberOutput = execFileSync(
      process.execPath,
      [
        lexBin,
        "--json",
        "remember",
        "--reference-point",
        referencePoint,
        "--summary",
        "Caller provenance persistence",
        "--next",
        "Read the exact historical object",
        "--modules",
        "ui/admin-panel",
        "--provenance-json",
        JSON.stringify(provenance),
      ],
      { encoding: "utf-8", env: getTestEnv() }
    );
    const receipt = JSON.parse(rememberOutput.trim());
    assert.deepEqual(receipt.data?.provenance, provenance);

    const contextOutput = execFileSync(
      process.execPath,
      [
        lexBin,
        "--json",
        "context",
        referencePoint,
        "--project-root",
        testDir,
        "--branch",
        "test-branch",
        "--max-tokens",
        "2000",
      ],
      { encoding: "utf-8", env: getTestEnv() }
    );
    const context = JSON.parse(contextOutput.trim());
    assert.equal(context.safety?.contentTrust, "untrusted-historical-data");
    assert.equal(context.frames?.length, 1);
    assert.deepEqual(context.frames[0]?.provenance, provenance);
  } finally {
    cleanup();
  }
});

test("CLI: lex recall retrieves created frame", () => {
  setupTest();
  try {
    // Create a frame first
    execFileSync(
      process.execPath,
      [
        lexBin,
        "remember",
        "--reference-point",
        "recall test frame",
        "--summary",
        "Test recall",
        "--next",
        "Test action",
        "--modules",
        "ui/admin-panel",
      ],
      { encoding: "utf-8", env: getTestEnv() }
    );

    // Recall it
    const output = execFileSync(process.execPath, [lexBin, "recall", "recall test frame"], {
      encoding: "utf-8",
      env: getTestEnv(),
    });

    // Natural language output shows "test frame" (query with common words stripped)
    assert.match(output, /test frame/, "Should show query topic");
    assert.match(output, /Test recall/, "Should show summary");
  } finally {
    cleanup();
  }
});

test("CLI: lex recall with --json outputs JSON", () => {
  setupTest();
  try {
    // Create a frame first
    execFileSync(
      process.execPath,
      [
        lexBin,
        "remember",
        "--reference-point",
        "json recall test",
        "--summary",
        "JSON recall",
        "--next",
        "Test action",
        "--modules",
        "ui/admin-panel",
      ],
      { encoding: "utf-8", env: getTestEnv() }
    );

    // Recall it
    const output = execFileSync(
      process.execPath,
      [lexBin, "--json", "recall", "json recall test"],
      {
        encoding: "utf-8",
        env: getTestEnv(),
      }
    );

    const json = JSON.parse(output.trim());
    assert.ok(Array.isArray(json), "JSON should be an array");
    assert.ok(json.length > 0, "JSON should contain results");
    assert.ok(json[0].frame, "JSON should contain frame data");
  } finally {
    cleanup();
  }
});

test("CLI: lex recall preserves exact hyphenated reference semantics", () => {
  setupTest();
  try {
    const remember = (referencePoint: string, summary: string) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            lexBin,
            "--json",
            "remember",
            "--reference-point",
            referencePoint,
            "--summary",
            summary,
            "--next",
            "Verify exact compound recall",
            "--modules",
            "ui/admin-panel",
          ],
          { encoding: "utf-8", env: getTestEnv() }
        ).trim()
      );
    const target = remember("aligned-stack-dogfood-2026-08-28", "Exact compound target");
    remember("aligned-stack-dogfooding-2026-08-28", "Prefix-only decoy");

    const recall = (query: string) =>
      JSON.parse(
        execFileSync(process.execPath, [lexBin, "--json", "recall", query, "--exact"], {
          encoding: "utf-8",
          env: getTestEnv(),
        }).trim()
      );
    const hyphenated = recall("aligned-stack-dogfood-2026-08-28");
    const tokenized = recall("aligned stack dogfood");

    assert.deepEqual(
      hyphenated.map((entry: { frame: { id: string } }) => entry.frame.id),
      [target.data.frame_id]
    );
    assert.deepEqual(
      tokenized.map((entry: { frame: { id: string } }) => entry.frame.id),
      [target.data.frame_id]
    );
  } finally {
    cleanup();
  }
});

test("CLI: lex check with no violations exits with 0", () => {
  setupTest();
  try {
    const mergedPath = join(testDir, "merged.json");
    const policyPath = join(testDir, "lexmap.policy.json");

    // Create a merged scanner output with no violations
    const merged = {
      sources: ["test"],
      files: [
        {
          path: "web-ui/admin/test.ts",
          module_scope: "ui/admin-panel",
          declarations: [],
          imports: [{ from: "services/user-api", type: "default" }],
          feature_flags: [],
          permissions: [],
          warnings: [],
        },
      ],
    };
    writeFileSync(mergedPath, JSON.stringify(merged, null, 2));

    const output = execFileSync(process.execPath, [lexBin, "check", mergedPath, policyPath], {
      encoding: "utf-8",
    });

    assert.match(output, /No policy violations/, "Should show no violations");
  } finally {
    cleanup();
  }
});

test("CLI: lex check with violations exits with 1", () => {
  setupTest();
  try {
    const mergedPath = join(testDir, "merged.json");
    const policyPath = join(testDir, "lexmap.policy.json");

    // Create a merged scanner output with violations
    const merged = {
      sources: ["test"],
      files: [
        {
          path: "web-ui/admin/test.ts",
          module_scope: "ui/admin-panel",
          declarations: [],
          imports: [{ from: "services/auth-core", type: "default" }],
          feature_flags: [],
          permissions: [],
          warnings: [],
        },
      ],
    };
    writeFileSync(mergedPath, JSON.stringify(merged, null, 2));

    try {
      execFileSync(process.execPath, [lexBin, "check", mergedPath, policyPath], {
        encoding: "utf-8",
      });
      assert.fail("Should have exited with code 1");
    } catch (error: any) {
      assert.strictEqual(error.status, 1, "Should exit with code 1");
      const output = error.stdout || error.stderr;
      assert.match(output, /violation/i, "Should mention violations");
    }
  } finally {
    cleanup();
  }
});

test("CLI: lex check with --json outputs JSON", () => {
  setupTest();
  try {
    const mergedPath = join(testDir, "merged.json");
    const policyPath = join(testDir, "lexmap.policy.json");

    // Create a merged scanner output with no violations
    const merged = {
      sources: ["test"],
      files: [],
    };
    writeFileSync(mergedPath, JSON.stringify(merged, null, 2));

    const output = execFileSync(
      process.execPath,
      [lexBin, "--json", "check", mergedPath, policyPath],
      {
        encoding: "utf-8",
      }
    );

    const json = JSON.parse(output.trim());
    assert.ok(Array.isArray(json.violations), "JSON should contain violations array");
    assert.strictEqual(json.count, 0, "JSON should show count of 0");
  } finally {
    cleanup();
  }
});

test("CLI: lex timeline shows frames for a ticket", () => {
  setupTest();
  try {
    // Create multiple frames for the same ticket
    execFileSync(
      process.execPath,
      [
        lexBin,
        "remember",
        "--jira",
        "TICKET-123",
        "--reference-point",
        "frame 1",
        "--summary",
        "First frame",
        "--next",
        "Test action 1",
        "--modules",
        "ui/admin-panel",
      ],
      { encoding: "utf-8", env: getTestEnv() }
    );

    execFileSync(
      process.execPath,
      [
        lexBin,
        "remember",
        "--jira",
        "TICKET-123",
        "--reference-point",
        "frame 2",
        "--summary",
        "Second frame",
        "--next",
        "Test action 2",
        "--modules",
        "ui/admin-panel,services/user-api",
      ],
      { encoding: "utf-8", env: getTestEnv() }
    );

    // Get timeline
    const output = execFileSync(process.execPath, [lexBin, "timeline", "TICKET-123"], {
      encoding: "utf-8",
      env: getTestEnv(),
    });

    assert.match(output, /TICKET-123/, "Should show ticket ID");
    assert.match(output, /First frame/, "Should show first frame");
    assert.match(output, /Second frame/, "Should show second frame");
    assert.match(output, /Module Scope Evolution/, "Should show module scope evolution");
  } finally {
    cleanup();
  }
});

test("CLI: lex timeline with --format=json outputs JSON", () => {
  setupTest();
  try {
    // Create a frame
    execFileSync(
      process.execPath,
      [
        lexBin,
        "remember",
        "--jira",
        "TICKET-456",
        "--reference-point",
        "json timeline test",
        "--summary",
        "JSON test",
        "--next",
        "Test action",
        "--modules",
        "ui/admin-panel",
      ],
      { encoding: "utf-8", env: getTestEnv() }
    );

    // Get timeline as JSON
    const output = execFileSync(
      process.execPath,
      [lexBin, "timeline", "TICKET-456", "--format=json"],
      {
        encoding: "utf-8",
        env: getTestEnv(),
      }
    );

    const json = JSON.parse(output.trim());
    assert.ok(Array.isArray(json), "JSON should be an array");
    assert.ok(json.length > 0, "JSON should contain timeline entries");
    assert.ok(json[0].frame, "Entry should contain frame");
  } finally {
    cleanup();
  }
});

test("CLI: lex timeline with --json outputs structured CliEvent (AX v0.1)", () => {
  setupTest();
  try {
    // Create a frame
    execFileSync(
      process.execPath,
      [
        lexBin,
        "remember",
        "--jira",
        "TICKET-AX",
        "--reference-point",
        "ax json timeline test",
        "--summary",
        "AX JSON test",
        "--next",
        "Test action",
        "--modules",
        "ui/admin-panel",
      ],
      { encoding: "utf-8", env: getTestEnv() }
    );

    // Get timeline with --json global flag (AX v0.1 format)
    const output = execFileSync(process.execPath, [lexBin, "--json", "timeline", "TICKET-AX"], {
      encoding: "utf-8",
      env: getTestEnv(),
    });

    // AX v0.1: --json outputs CliEvent format with v, ts, level, message, data
    const event = JSON.parse(output.trim());
    assert.equal(event.v, 1, "CliEvent should have version 1");
    assert.ok(event.ts, "CliEvent should have timestamp");
    assert.equal(event.level, "success", "Should be success level");
    assert.equal(event.code, "TIMELINE_RETRIEVED", "Should have TIMELINE_RETRIEVED code");
    assert.ok(event.data?.frames, "data should contain frames array");
    assert.ok(Array.isArray(event.data.frames), "frames should be an array");
    assert.ok(event.data.frames.length > 0, "frames should have entries");
    assert.ok(event.data.frames[0].id, "Each frame should have id");
    assert.ok(event.data.frames[0].referencePoint, "Each frame should have referencePoint");
  } finally {
    cleanup();
  }
});

test("CLI: lex timeline shows blocker evolution", () => {
  setupTest();
  try {
    // Create frames with blockers
    execFileSync(
      process.execPath,
      [
        lexBin,
        "remember",
        "--jira",
        "TICKET-789",
        "--reference-point",
        "blocker test 1",
        "--summary",
        "Frame with blocker",
        "--next",
        "Test action",
        "--modules",
        "ui/admin-panel",
        "--blockers",
        "CORS issue",
      ],
      { encoding: "utf-8", env: getTestEnv() }
    );

    execFileSync(
      process.execPath,
      [
        lexBin,
        "remember",
        "--jira",
        "TICKET-789",
        "--reference-point",
        "blocker test 2",
        "--summary",
        "Frame without blocker",
        "--next",
        "Test action",
        "--modules",
        "ui/admin-panel",
      ],
      { encoding: "utf-8", env: getTestEnv() }
    );

    // Get timeline
    const output = execFileSync(process.execPath, [lexBin, "timeline", "TICKET-789"], {
      encoding: "utf-8",
      env: getTestEnv(),
    });

    assert.match(output, /CORS issue/, "Should show blocker");
    assert.match(output, /Blocker Tracking/, "Should show blocker tracking section");
  } finally {
    cleanup();
  }
});

test("CLI: lex remember without policy file succeeds with warning", () => {
  const noPolicyDir = join(tmpdir(), "lex-no-policy-test-" + Date.now());
  const noPolicyDbPath = join(noPolicyDir, "frames.db");

  try {
    mkdirSync(noPolicyDir, { recursive: true });
    // Create a package.json to make this a valid "repo root" so the loader
    // doesn't fall back to finding the real lex repo's canon/policy file
    writeFileSync(join(noPolicyDir, "package.json"), '{"name": "test-no-policy"}');

    const noPolicyEnv = {
      NODE_ENV: "test",
      LEX_LOG_LEVEL: "silent",
      LEX_DB_PATH: noPolicyDbPath,
      LEX_DEFAULT_BRANCH: "test-branch",
      PATH: process.env.PATH,
      LEX_WORKSPACE_ROOT: noPolicyDir, // Point to dir without policy
    };

    // Use spawnSync to capture both stdout and stderr
    const result = spawnSync(
      process.execPath,
      [
        lexBin,
        "remember",
        "--reference-point",
        "no policy test",
        "--summary",
        "Test without policy",
        "--next",
        "Test action",
        "--modules",
        "any-module-id",
      ],
      { encoding: "utf-8", env: noPolicyEnv }
    );

    const output = result.stdout + result.stderr;
    assert.match(output, /No policy file found/, "Should warn about no policy file");
    assert.match(output, /Module validation skipped/, "Should indicate validation was skipped");
    assert.match(output, /Frame created successfully/, "Should create frame successfully");
    assert.match(output, /any-module-id/, "Should use the provided module ID as-is");
  } finally {
    if (existsSync(noPolicyDir)) {
      rmSync(noPolicyDir, { recursive: true, force: true });
    }
  }
});

test("CLI: lex remember with --skip-policy flag succeeds with any module", () => {
  setupTest();
  try {
    const result = spawnSync(
      process.execPath,
      [
        lexBin,
        "remember",
        "--skip-policy",
        "--reference-point",
        "skip policy test",
        "--summary",
        "Test with skip-policy flag",
        "--next",
        "Test action",
        "--modules",
        "invalid-module-id",
      ],
      { encoding: "utf-8", env: getTestEnv() }
    );

    const output = result.stdout + result.stderr;
    assert.match(output, /Policy validation disabled/, "Should indicate policy was skipped");
    assert.match(output, /Module validation skipped/, "Should indicate validation was skipped");
    assert.match(output, /Frame created successfully/, "Should create frame successfully");
    assert.match(output, /invalid-module-id/, "Should use the provided module ID as-is");
  } finally {
    cleanup();
  }
});
