#!/usr/bin/env node
/** Installed-package proof; does not inspect or open any configured Lex store. */
import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function verifySqliteRuntime(packageRoot) {
  const root = realpathSync(packageRoot);
  const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const hook of ["preinstall", "install", "postinstall"]) {
    assert.equal(metadata.scripts?.[hook], undefined, `Unexpected Lex ${hook} hook`);
  }
  assert.equal(metadata.dependencies?.["better-sqlite3-multiple-ciphers"], "13.0.3");
  assert.equal(metadata.dependencies?.["inquirer"], undefined, "Full Inquirer is not required");
  assert.equal(metadata.dependencies?.["@inquirer/input"], "5.1.2");
  assert.equal(metadata.dependencies?.["@inquirer/confirm"], "6.1.1");
  const require = createRequire(join(root, "package.json"));
  const driver = require("better-sqlite3-multiple-ciphers/package.json");
  assert.equal(driver.version, "13.0.3");
  assert.equal(driver.gypfile, false);
  for (const hook of ["preinstall", "install", "postinstall"]) {
    assert.equal(driver.scripts?.[hook], undefined, `Unexpected SQLite ${hook} hook`);
  }
  assert.deepEqual(Object.keys(driver.dependencies).sort(), ["node-addon-api"]);
  const driverRoot = dirname(require.resolve("better-sqlite3-multiple-ciphers/package.json"));
  const linuxMusl =
    process.platform === "linux" && !process.report.getReport().header.glibcVersionRuntime;
  const target = `${linuxMusl ? "linuxmusl" : process.platform}-${process.arch}.node`;
  const binary = realpathSync(join(driverRoot, "prebuilds", target));
  const Database = require("better-sqlite3-multiple-ciphers");
  const db = new Database(":memory:");
  try {
    assert.ok(require.cache[binary], "The exact bundled platform prebuild must be loaded");
    assert.equal(typeof db.key, "function");
    assert.equal(typeof db.rekey, "function");
    db.exec("CREATE VIRTUAL TABLE native_probe USING fts5(value)");
    db.prepare("INSERT INTO native_probe VALUES (?)").run("bundled runtime");
    assert.equal(
      db
        .prepare("SELECT count(*) AS count FROM native_probe WHERE native_probe MATCH 'bundled'")
        .get().count,
      1
    );
    db.pragma("cipher='sqlcipher'");
    assert.equal(db.pragma("cipher", { simple: true }), "sqlcipher");
    console.log(`Installed Lex/SQLite hook boundary and bundled ${target} verified`);
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifySqliteRuntime(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
}
