/** Bundled Node-API runtime proof; only disposable databases are used. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("bundled SQLite, FTS5 and real encrypted reopen work without a rebuild", () => {
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/check-sqlite-bindings.ts"],
    {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      encoding: "utf8",
      timeout: 30000,
    }
  );
  assert.match(output, /bundled native binary, FTS5 and SQLCipher checks passed/);
  assert.match(output, /Installed Lex\/SQLite hook boundary and bundled .*\.node verified/);
});
