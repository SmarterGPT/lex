#!/usr/bin/env node
/** Explicit qualification with an already-retained old binary; never downloads or opens live stores. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const index = process.argv.indexOf("--prior-module");
assert.ok(
  index >= 0 && process.argv[index + 1],
  "Pass --prior-module <retained old installed package directory>"
);
const priorRoot = resolve(process.argv[index + 1]);
const priorRequire = createRequire(join(priorRoot, "package.json"));
assert.equal(JSON.parse(readFileSync(join(priorRoot, "package.json"), "utf8")).version, "12.11.1");
const PriorDatabase = priorRequire(priorRoot);
const require = createRequire(import.meta.url);
assert.equal(require("better-sqlite3-multiple-ciphers/package.json").version, "13.0.3");
const Database = require("better-sqlite3-multiple-ciphers");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "test/fixtures/sqlite-native-v12");
const manifest = JSON.parse(readFileSync(join(fixtures, "manifest.json"), "utf8"));
const { deriveEncryptionKey } = await import("../dist/memory/store/db.js");
const digest = (filename) => createHash("sha256").update(readFileSync(filename)).digest("hex");
const temporary = mkdtempSync(join(tmpdir(), "lex-sqlite-reverse-"));
const beforeEntries = readdirSync(fixtures).sort();
function unlock(db, encrypted) {
  if (encrypted) {
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key="x'${deriveEncryptionKey(manifest.passphrase)}'"`);
  }
}
try {
  for (const fixture of manifest.fixtures) {
    const source = join(fixtures, fixture.filename);
    assert.equal(digest(source), fixture.sha256);
    const filename = join(temporary, fixture.filename);
    copyFileSync(source, filename);
    // New engine writes existing prior-version data without changing cipher/key semantics.
    const current = new Database(filename);
    try {
      unlock(current, fixture.encrypted);
      current.exec("CREATE TABLE cross_version_probe (value TEXT)");
      current.prepare("INSERT INTO cross_version_probe VALUES (?)").run("written-by-13");
    } finally {
      current.close();
    }
    const afterNewWrite = digest(filename);
    const oldReader = new PriorDatabase(filename, { readonly: true, fileMustExist: true });
    try {
      unlock(oldReader, fixture.encrypted);
      assert.equal(
        oldReader.prepare("SELECT value FROM cross_version_probe").get().value,
        "written-by-13"
      );
      assert.equal(
        oldReader.prepare("SELECT summary_caption FROM frames WHERE id = ?").get(manifest.frame.id)
          .summary_caption,
        manifest.frame.summary_caption
      );
      assert.equal(oldReader.pragma("quick_check", { simple: true }), "ok");
    } finally {
      oldReader.close();
    }
    assert.equal(digest(filename), afterNewWrite);
    const oldWriter = new PriorDatabase(filename);
    try {
      unlock(oldWriter, fixture.encrypted);
      oldWriter.prepare("INSERT INTO cross_version_probe VALUES (?)").run("written-by-12");
    } finally {
      oldWriter.close();
    }
    const newReader = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      unlock(newReader, fixture.encrypted);
      assert.deepEqual(
        newReader.prepare("SELECT value FROM cross_version_probe ORDER BY rowid").all(),
        [{ value: "written-by-13" }, { value: "written-by-12" }]
      );
      assert.equal(newReader.pragma("quick_check", { simple: true }), "ok");
    } finally {
      newReader.close();
    }
    assert.equal(digest(source), fixture.sha256);
    console.log(`12.11.1 <-> 13.0.3 read/write/reopen passed: ${fixture.filename}`);
  }
  assert.deepEqual(readdirSync(fixtures).sort(), beforeEntries);
} finally {
  const target = resolve(temporary);
  assert.ok(target.startsWith(resolve(tmpdir()) + sep), "Cleanup must stay in temporary root");
  rmSync(target, { recursive: true, force: true });
}
