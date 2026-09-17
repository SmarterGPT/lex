import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("public context import does not load CLI, MCP, database drivers or behavioral stores", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { registerHooks } from 'node:module';
    const hooks = registerHooks({ load(url, context, next) {
      if (/mcp_server|shared\\/cli\\/index|store\\/(sqlite|postgres)|behavioral|better-sqlite|node_modules\\/pg\\//.test(url)) {
        throw new Error('Unrelated module loaded: ' + url);
      }
      return next(url, context);
    }});
    const api = await import('@smartergpt/lex/context');
    if (typeof api.buildSessionContext !== 'function') throw new Error('Missing builder');
    hooks.deregister();
  `,
    ],
    { encoding: "utf8", timeout: 10000, windowsHide: true }
  );
  assert.equal(result.status, 0, result.stderr);
});
