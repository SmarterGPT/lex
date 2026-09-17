import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const testDir = join(tmpdir(), `lex-introspect-resolution-${Date.now()}`);
const lexBin = join(process.cwd(), "dist", "shared", "cli", "lex.js");

function setupConsumerWorkspace() {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }

  const consumerDir = join(testDir, "consumer-app");
  const policyDir = join(consumerDir, ".smartergpt", "lex");
  mkdirSync(policyDir, { recursive: true });

  writeFileSync(join(consumerDir, "package.json"), JSON.stringify({ name: "consumer-app" }));
  writeFileSync(
    join(policyDir, "lexmap.policy.json"),
    JSON.stringify(
      {
        modules: {
          "consumer/module": {
            owns_paths: ["src/**"],
            allowed_callers: [],
            forbidden_callers: [],
          },
        },
      },
      null,
      2
    )
  );
  writeFileSync(
    join(consumerDir, ".lex.config.json"),
    JSON.stringify(
      {
        paths: {
          appRoot: ".",
          database: "./data/shared.db",
          policy: "./.smartergpt/lex/lexmap.policy.json",
        },
      },
      null,
      2
    )
  );

  return consumerDir;
}

function cleanup() {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

test("lex introspect --json exposes workspace and path provenance for consumer workspaces", () => {
  const consumerDir = setupConsumerWorkspace();
  const env = {
    ...process.env,
    NODE_ENV: "test",
    LEX_LOG_LEVEL: "silent",
    LEX_DEFAULT_BRANCH: "test-branch",
  };

  delete env.LEX_WORKSPACE_ROOT;
  delete env.LEX_APP_ROOT;
  delete env.LEX_DB_PATH;
  delete env.LEX_MEMORY_DB;
  delete env.LEX_POLICY_PATH;

  try {
    const result = spawnSync(process.execPath, [lexBin, "--json", "introspect"], {
      cwd: consumerDir,
      encoding: "utf-8",
      env,
    });

    assert.strictEqual(result.status, 0, `Expected success, got: ${result.stderr}`);

    const event = JSON.parse(result.stdout.trim());
    const data = event.data as Record<string, unknown>;
    const resolution = data.resolution as Record<string, unknown>;
    const workspaceRoot = resolution.workspaceRoot as Record<string, unknown>;
    const configFile = resolution.configFile as Record<string, unknown>;
    const database = resolution.database as Record<string, unknown>;
    const policy = resolution.policy as Record<string, unknown>;
    const branch = resolution.branch as Record<string, unknown>;

    assert.strictEqual(workspaceRoot.path, consumerDir);
    assert.strictEqual(workspaceRoot.source, "package");
    assert.strictEqual(configFile.path, join(consumerDir, ".lex.config.json"));
    assert.strictEqual(configFile.source, "caller-workspace");
    assert.strictEqual(database.path, join(consumerDir, "data", "shared.db"));
    assert.strictEqual(database.source, "file:.lex.config.json");
    assert.strictEqual(
      database.canonicalPath,
      realpathSync.native(join(consumerDir, "data", "shared.db"))
    );
    assert.match(database.identity as string, /^path-v1:[a-f0-9]{16}$/);
    assert.strictEqual(policy.path, join(consumerDir, ".smartergpt", "lex", "lexmap.policy.json"));
    assert.strictEqual(policy.source, "workspace-working");
    assert.strictEqual(policy.loaded, true);
    assert.strictEqual(branch.name, "test-branch");
    assert.strictEqual(branch.source, "env:LEX_DEFAULT_BRANCH");
  } finally {
    cleanup();
  }
});
