#!/usr/bin/env node
// One-time historical fixture generation. Requires the actual pre-upgrade locked driver.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
assert.equal(
  sourceCommit,
  "e5971fb4d0ba86b3bf5114259444b3c3d9d9c9df",
  "Historical fixtures require the declared prior source"
);
const require = createRequire(import.meta.url);
const driver = require("better-sqlite3-multiple-ciphers/package.json");
assert.equal(driver.version, "12.11.1", "Never regenerate historical fixtures with the new driver");
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
assert.equal(lock.packages["node_modules/better-sqlite3-multiple-ciphers"].version, driver.version);
process.env.NODE_ENV = "test";
process.env.LEX_LOG_LEVEL = "silent";
const { createDatabase, DATABASE_SCHEMA_VERSION } = await import("../dist/memory/store/db.js");
const { saveFrame } = await import("../dist/memory/store/queries.js");
const directory = join(root, "test", "fixtures", "sqlite-native-v12");
mkdirSync(directory, { recursive: true });
const passphrase = "disposable-sqlite-compatibility-fixture-key";
const frame = {
  id: "v12-fixture-frame",
  timestamp: "2026-10-20T00:00:00.000Z",
  branch: "fixture",
  module_scope: ["memory/store"],
  summary_caption: "Synthetic prior-driver fixture",
  reference_point: "sqlite-native-upgrade",
  status_snapshot: { next_action: "verify compatibility without live stores" },
  keywords: ["synthetic", "compatibility"],
};
const fixtures = [];
for (const encrypted of [false, true]) {
  const filename = encrypted ? "lex-v12.11.1.sqlcipher.fixture" : "lex-v12.11.1.plain.fixture";
  const path = join(directory, filename);
  assert.equal(existsSync(path), false, "Historical fixtures must not be overwritten");
  if (encrypted) process.env.LEX_DB_KEY = passphrase;
  else delete process.env.LEX_DB_KEY;
  const db = createDatabase(path);
  try {
    saveFrame(db, frame);
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.pragma("journal_mode = DELETE");
  } finally {
    db.close();
  }
  const bytes = readFileSync(path);
  fixtures.push({
    filename,
    encrypted,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
writeFileSync(
  join(directory, "manifest.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      driver: {
        name: driver.name,
        version: driver.version,
        integrity: lock.packages["node_modules/better-sqlite3-multiple-ciphers"].integrity,
      },
      generatedOn: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
      sourceCommit,
      databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
      passphrase,
      cipher: "sqlcipher",
      keyDerivation:
        "Lex deriveEncryptionKey: PBKDF2-SHA256, 64000 iterations, 32 bytes, application salt lex-sqlcipher-v1-2025",
      frame,
      fixtures,
    },
    null,
    2
  ) + "\n"
);
console.log(JSON.stringify({ driver: driver.version, fixtures }));
