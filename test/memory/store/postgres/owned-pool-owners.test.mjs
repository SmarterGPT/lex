import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("actual owned constructors retain pending/failed close and caller ownership", () => {
  const fixture = fileURLToPath(
    new URL("./fixtures/owned-pool-owners.fixture.mjs", import.meta.url)
  );
  const env = { ...process.env, LEX_POSTGRES_POOL_MAX: "64" };
  for (const name of Object.keys(env))
    if (
      name.startsWith("PG") ||
      ["LEX_DATABASE_URL", "LEX_POSTGRES_PASSWORD", "NODE_OPTIONS"].includes(name)
    )
      delete env[name];
  const run = spawnSync(process.execPath, ["--experimental-test-module-mocks", fixture], {
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 65536,
  });
  assert.equal(run.error, undefined);
  assert.equal(run.signal, null);
  assert.equal(run.status, 0, run.stderr);
  const data = JSON.parse(run.stdout.trim());
  assert.equal(data.result, "PASS_ACTUAL_OWNER_WRAPPERS_FAKE_RESOURCES");
  assert.equal(data.physicalCases, 12);
  assert.equal(data.externalCases, 4);
  assert.equal(data.logicalCases, 3);
  assert.equal(data.actualCompiledCore, true);
  assert.equal(data.databaseOrNetwork, false);
});
