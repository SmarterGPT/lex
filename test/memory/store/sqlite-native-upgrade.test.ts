import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3-multiple-ciphers";
import { createDatabase, deriveEncryptionKey } from "../../../src/memory/store/db.js";
import { SqliteFrameStore } from "../../../src/memory/store/sqlite/frame-store.js";
import { getFrameById, saveFrame } from "../../../src/memory/store/queries.js";

const require = createRequire(import.meta.url);
const directory = fileURLToPath(new URL("../../fixtures/sqlite-native-v12/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
const digest = (filename: string) =>
  createHash("sha256").update(readFileSync(filename)).digest("hex");
function unlock(db: Database.Database, encrypted: boolean, key = manifest.passphrase) {
  if (encrypted) {
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key="x'${deriveEncryptionKey(key)}'"`);
  }
}

test("SQLite 13 uses the bundled Node-API package without install hooks", () => {
  const metadata = require("better-sqlite3-multiple-ciphers/package.json");
  assert.equal(metadata.version, "13.0.3");
  assert.equal(metadata.gypfile, false);
  for (const hook of ["preinstall", "install", "postinstall"])
    assert.equal(metadata.scripts?.[hook], undefined);
  const nativeRoot = dirname(require.resolve("better-sqlite3-multiple-ciphers/package.json"));
  assert.deepEqual(readdirSync(join(nativeRoot, "prebuilds")).sort(), [
    "darwin-arm64.node",
    "darwin-x64.node",
    "linux-arm64.node",
    "linux-x64.node",
    "linuxmusl-arm64.node",
    "linuxmusl-x64.node",
    "win32-arm64.node",
    "win32-x64.node",
  ]);
});

test("locked install surface excludes umbrella prompts and native installers", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  assert.equal(
    metadata.dependencies["@types/better-sqlite3-multiple-ciphers"],
    "npm:@types/better-sqlite3@9.6.0"
  );
  for (const hook of ["preinstall", "install", "postinstall"])
    assert.equal(metadata.scripts?.[hook], undefined);
  const forbidden = [
    "inquirer",
    "@inquirer/prompts",
    "@inquirer/editor",
    "@inquirer/external-editor",
    "external-editor",
    "prebuild-install",
    "socket.io",
  ];
  for (const location of Object.keys(lock.packages)) {
    for (const name of forbidden) {
      assert.ok(!location.endsWith(`node_modules/${name}`), `Unexpected dependency ${location}`);
    }
  }
  const db = createDatabase(":memory:");
  const store = new SqliteFrameStore(db);
  try {
    assert.equal(store.db, db);
    assert.equal(typeof db.key, "function");
    assert.equal(typeof store.db.rekey, "function");
  } finally {
    db.close();
  }
});

for (const fixture of manifest.fixtures as Array<{
  filename: string;
  encrypted: boolean;
  sha256: string;
  size: number;
}>) {
  test(`new driver reads prior ${fixture.encrypted ? "SQLCipher" : "plain"} Lex fixture without modifying bytes or sidecars`, () => {
    assert.equal(manifest.driver.version, "12.11.1");
    assert.equal(manifest.databaseSchemaVersion, 14);
    const filename = join(directory, fixture.filename);
    const beforeEntries = readdirSync(directory).sort();
    assert.equal(digest(filename), fixture.sha256);
    assert.equal(readFileSync(filename).length, fixture.size);
    const db = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      unlock(db, fixture.encrypted);
      assert.equal(
        getFrameById(db, manifest.frame.id)?.summary_caption,
        manifest.frame.summary_caption
      );
      assert.equal(db.pragma("quick_check", { simple: true }), "ok");
      assert.equal(
        (
          db.prepare("SELECT MAX(version) AS version FROM schema_version").get() as {
            version: number;
          }
        ).version,
        manifest.databaseSchemaVersion
      );
      assert.equal(
        (
          db
            .prepare("SELECT count(*) AS count FROM frames_fts WHERE frames_fts MATCH 'Synthetic'")
            .get() as { count: number }
        ).count,
        1
      );
      assert.throws(() => db.exec("DELETE FROM frames"));
    } finally {
      db.close();
    }
    assert.equal(digest(filename), fixture.sha256);
    assert.deepEqual(readdirSync(directory).sort(), beforeEntries);
  });

  test(`Lex writes and reopens a disposable copy of prior ${fixture.encrypted ? "SQLCipher" : "plain"} data`, () => {
    const temporary = mkdtempSync(join(tmpdir(), "lex-sqlite-upgrade-"));
    const filename = join(temporary, "copy.sqlite");
    const previousKey = process.env.LEX_DB_KEY;
    const previousMode = process.env.NODE_ENV;
    try {
      copyFileSync(join(directory, fixture.filename), filename);
      process.env.NODE_ENV = "test";
      if (fixture.encrypted) process.env.LEX_DB_KEY = manifest.passphrase;
      else delete process.env.LEX_DB_KEY;
      const db = createDatabase(filename);
      try {
        saveFrame(db, {
          ...manifest.frame,
          id: "new-driver-frame",
          summary_caption: "New driver preserved the prior data",
        });
        assert.equal(
          getFrameById(db, manifest.frame.id)?.summary_caption,
          manifest.frame.summary_caption
        );
        db.pragma("wal_checkpoint(TRUNCATE)");
        db.pragma("journal_mode = DELETE");
      } finally {
        db.close();
      }
      const reopened = new Database(filename, { readonly: true, fileMustExist: true });
      try {
        unlock(reopened, fixture.encrypted);
        assert.equal(
          getFrameById(reopened, "new-driver-frame")?.summary_caption,
          "New driver preserved the prior data"
        );
        assert.equal(reopened.pragma("quick_check", { simple: true }), "ok");
      } finally {
        reopened.close();
      }
      if (fixture.encrypted) {
        for (const key of [undefined, "synthetic-wrong-test-passphrase"]) {
          const wrong = new Database(filename, { readonly: true, fileMustExist: true });
          const before = digest(filename);
          try {
            if (key) unlock(wrong, true, key);
            assert.throws(() => wrong.prepare("SELECT * FROM frames").get());
          } finally {
            wrong.close();
          }
          assert.equal(digest(filename), before);
        }
      }
    } finally {
      if (previousKey === undefined) delete process.env.LEX_DB_KEY;
      else process.env.LEX_DB_KEY = previousKey;
      if (previousMode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousMode;
      assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
      rmSync(temporary, { recursive: true, force: true });
    }
  });
}
