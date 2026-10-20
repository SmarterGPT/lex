#!/usr/bin/env npx tsx
/** Verify the installed bundled Node-API binary using only disposable databases. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

async function checkBindings(): Promise<void> {
  let temporaryDirectory: string | undefined;
  try {
    const require = createRequire(import.meta.url);
    const { verifySqliteRuntime } = await import("./verify-sqlite-runtime.mjs");
    verifySqliteRuntime(resolve(import.meta.dirname, ".."));
    const metadata = require("better-sqlite3-multiple-ciphers/package.json");
    assert.equal(metadata.version, "13.0.3");
    assert.equal(metadata.gypfile, false);
    for (const hook of ["preinstall", "install", "postinstall"]) {
      assert.equal(metadata.scripts?.[hook], undefined, `Unexpected SQLite ${hook} hook`);
    }
    const { default: Database } = await import("better-sqlite3-multiple-ciphers");
    const memory = new Database(":memory:");
    let sqliteVersion: string;
    try {
      memory.exec("CREATE VIRTUAL TABLE health_fts USING fts5(value)");
      memory.prepare("INSERT INTO health_fts VALUES (?)").run("bundled native check");
      assert.equal(
        (
          memory
            .prepare("SELECT count(*) AS count FROM health_fts WHERE health_fts MATCH 'bundled'")
            .get() as { count: number }
        ).count,
        1
      );
      sqliteVersion = (
        memory.prepare("SELECT sqlite_version() AS version").get() as { version: string }
      ).version;
    } finally {
      memory.close();
    }

    temporaryDirectory = mkdtempSync(join(tmpdir(), "lex-sqlite-health-"));
    const filename = join(temporaryDirectory, "encrypted.sqlite");
    const key = "e".repeat(64); // Synthetic health-check key; never read a real store or credential.
    const encrypted = new Database(filename);
    try {
      encrypted.pragma("cipher='sqlcipher'");
      encrypted.pragma(`key="x'${key}'"`);
      encrypted.exec("CREATE TABLE health(value TEXT); INSERT INTO health VALUES ('encrypted')");
    } finally {
      encrypted.close();
    }
    assert.notEqual(readFileSync(filename).subarray(0, 16).toString(), "SQLite format 3\0");
    const unkeyed = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      assert.throws(() => unkeyed.prepare("SELECT * FROM health").get());
    } finally {
      unkeyed.close();
    }
    const reopened = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      reopened.pragma("cipher='sqlcipher'");
      reopened.pragma(`key="x'${key}'"`);
      assert.equal(
        (reopened.prepare("SELECT value FROM health").get() as { value: string }).value,
        "encrypted"
      );
      assert.equal(reopened.pragma("quick_check", { simple: true }), "ok");
    } finally {
      reopened.close();
    }
    console.log(
      `SQLite ${metadata.version} bundled native binary, FTS5 and SQLCipher checks passed`
    );
    console.log(
      `SQLite engine: ${sqliteVersion}; Node: ${process.version}; platform: ${process.platform}-${process.arch}`
    );
  } catch (error) {
    console.error(
      `SQLite bundled native check failed: ${error instanceof Error ? error.message : String(error)}`
    );
    console.error(
      "Use the exact locked package on a supported platform; see docs/dev/sqlite-bindings.md."
    );
    console.error("No source-build or download fallback was attempted.");
    process.exitCode = 1;
  } finally {
    if (temporaryDirectory) {
      const temporaryRoot = resolve(tmpdir()) + sep;
      const target = resolve(temporaryDirectory);
      if (!target.startsWith(temporaryRoot))
        throw new Error("Refusing cleanup outside the temporary directory");
      rmSync(target, { recursive: true, force: true });
    }
  }
}
await checkBindings();
