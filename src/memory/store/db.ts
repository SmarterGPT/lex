/**
 * Database initialization and schema management for Frame storage
 *
 * Creates SQLite database with FTS5 virtual table for full-text search
 * on reference_point, keywords, and summary_caption.
 *
 * Supports encryption via SQLCipher when LEX_DB_KEY environment variable is set.
 *
 * @see CONTRACT.md for the FrameStore persistence contract
 */

import Database from "better-sqlite3-multiple-ciphers";
import { dirname } from "path";
import { mkdirSync, existsSync, readFileSync, statSync } from "fs";
import { pbkdf2Sync } from "crypto";
import { loadConfig } from "../../shared/config/index.js";
import {
  inspectSqliteSchema,
  LEGACY_DIVERGENT_SCHEMA_VERSION,
  SQLITE_SCHEMA_VERSION,
  SqliteSchemaIntegrityError,
  type SqliteSchemaInspection,
} from "./sqlite/schema-integrity.js";

/**
 * FrameStore schema version following SemVer.
 *
 * Changes require:
 * - Patch: additive optional fields
 * - Minor: additive required fields with defaults
 * - Major: breaking changes
 *
 * @see CONTRACT.md for change protocol
 */
export const FRAME_STORE_SCHEMA_VERSION = "1.0.1";

/** Latest SQLite migration applied by initializeDatabase(). */
export const DATABASE_SCHEMA_VERSION = SQLITE_SCHEMA_VERSION;

import { ReadOnlyDatabaseError } from "./read-only-error.js";
export { ReadOnlyDatabaseError } from "./read-only-error.js";
export type { ReadOnlyDatabaseErrorCode } from "./read-only-error.js";

export interface FrameRow {
  id: string;
  timestamp: string;
  branch: string;
  jira: string | null;
  module_scope: string; // JSON stringified array
  summary_caption: string;
  reference_point: string;
  status_snapshot: string; // JSON stringified object
  keywords: string | null; // JSON stringified array
  atlas_frame_id: string | null;
  feature_flags: string | null; // JSON stringified array
  permissions: string | null; // JSON stringified array
  module_attribution: string | null; // JSON stringified attribution receipt
  // Merge-weave metadata (v2)
  run_id: string | null;
  plan_hash: string | null;
  spend: string | null; // JSON stringified object
  // OAuth2/JWT user isolation (v3)
  user_id: string | null;
  // Deduplication metadata (v5)
  superseded_by: string | null;
  merged_from: string | null; // JSON stringified array
  frame_metadata?: string | null; // Scoped stores require this versioned JSON payload
}

/**
 * Database row type for code_atlas_runs table
 */
export interface CodeAtlasRunRow {
  run_id: string;
  repo_id: string;
  files_requested: string; // JSON stringified array
  files_scanned: string; // JSON stringified array
  units_emitted: number;
  max_files: number | null;
  max_bytes: number | null;
  truncated: number; // SQLite boolean (0 or 1)
  strategy: string | null;
  created_at: string;
  schema_version: string;
}

/**
 * Result of passphrase strength validation
 */
export interface PassphraseValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  characterClasses: {
    hasLowercase: boolean;
    hasUppercase: boolean;
    hasDigit: boolean;
    hasSymbol: boolean;
    count: number;
  };
}

/**
 * Detect sequential character patterns in a passphrase
 */
function detectSequentialPattern(passphrase: string): boolean {
  const lowerPass = passphrase.toLowerCase();
  const sequences = [
    "abcdefghijklmnopqrstuvwxyz",
    "zyxwvutsrqponmlkjihgfedcba",
    "0123456789",
    "9876543210",
    "qwertyuiop",
    "poiuytrewq",
    "asdfghjkl",
    "lkjhgfdsa",
    "zxcvbnm",
    "mnbvcxz",
  ];

  for (const seq of sequences) {
    for (let i = 0; i <= seq.length - 4; i++) {
      if (lowerPass.includes(seq.substring(i, i + 4))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Validate passphrase strength for entropy requirements
 */
export function validatePassphraseStrength(passphrase: string): PassphraseValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!passphrase || passphrase.trim().length === 0) {
    return {
      valid: false,
      errors: ["Passphrase cannot be empty or whitespace-only"],
      warnings: [],
      characterClasses: {
        hasLowercase: false,
        hasUppercase: false,
        hasDigit: false,
        hasSymbol: false,
        count: 0,
      },
    };
  }

  if (passphrase.length < 12) {
    errors.push(
      "Passphrase is too short. Use at least 12 characters (32+ recommended for production)."
    );
  }

  const hasLowercase = /[a-z]/.test(passphrase);
  const hasUppercase = /[A-Z]/.test(passphrase);
  const hasDigit = /[0-9]/.test(passphrase);
  const hasSymbol = /[^a-zA-Z0-9\s]/.test(passphrase);
  const classCount = [hasLowercase, hasUppercase, hasDigit, hasSymbol].filter(Boolean).length;

  if (classCount < 3) {
    errors.push(
      `Passphrase lacks character diversity. Use at least 3 of: lowercase, uppercase, digits, symbols. Found ${classCount} class(es).`
    );
  }

  if (/(.)\1{3,}/.test(passphrase)) {
    errors.push(
      "Passphrase contains repeating character patterns (4+ identical consecutive characters)."
    );
  }

  if (detectSequentialPattern(passphrase)) {
    errors.push(
      "Passphrase contains sequential character patterns (e.g., 'abcd', '1234', 'qwerty')."
    );
  }

  if (passphrase.length < 32 && errors.length === 0) {
    warnings.push("Consider using 32+ characters for production environments.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    characterClasses: { hasLowercase, hasUppercase, hasDigit, hasSymbol, count: classCount },
  };
}

/**
 * Get default database path: .smartergpt/lex/memory.db relative to the caller workspace root.
 * Can be overridden with LEX_DB_PATH, LEX_MEMORY_DB, or LEX_WORKSPACE_ROOT environment variables.
 */
export function getDefaultDbPath(): string {
  // Check for environment variable overrides
  if (process.env.LEX_DB_PATH) {
    return process.env.LEX_DB_PATH;
  }
  if (process.env.LEX_MEMORY_DB) {
    return process.env.LEX_MEMORY_DB;
  }

  const configuredPath = loadConfig().paths.database;
  const localDir = dirname(configuredPath);

  if (!existsSync(localDir)) {
    mkdirSync(localDir, { recursive: true });
  }

  return configuredPath;
}

/**
 * Derive encryption key from passphrase using PBKDF2
 * Uses 64K iterations as recommended by SQLCipher for security
 *
 * NOTE: This implementation uses a fixed application salt to ensure deterministic
 * key derivation. This is necessary because:
 * 1. SQLCipher doesn't support storing salt metadata separately
 * 2. Users must derive the same key from their passphrase each session
 * 3. The passphrase itself must be high-entropy to compensate
 *
 * Security considerations:
 * - Users MUST use strong, unique passphrases (32+ characters recommended)
 * - The fixed salt prevents per-database key uniqueness
 * - This is acceptable for single-user/small-team use cases
 * - Enterprise deployments should consider HSM integration (future work)
 *
 * @param passphrase - User-provided passphrase from LEX_DB_KEY
 * @param salt - Optional salt (defaults to application-wide constant)
 * @returns Hex-encoded key suitable for SQLCipher
 */
export function deriveEncryptionKey(passphrase: string, salt?: Buffer): string {
  // Validate passphrase strength
  if (!passphrase || passphrase.trim().length === 0) {
    throw new Error("Passphrase cannot be empty or whitespace-only");
  }
  if (passphrase.length < 12) {
    throw new Error(
      "Passphrase is too weak. Use at least 12 characters (32+ recommended for production). " +
        "Consider using a password manager to generate and store a strong passphrase."
    );
  }

  // Use application-wide constant salt for deterministic key derivation
  // This is necessary for password-based encryption without external metadata storage
  const APPLICATION_SALT = Buffer.from("lex-sqlcipher-v1-2025", "utf-8");
  const keySalt = salt || APPLICATION_SALT;

  // Derive 256-bit key with 64K iterations (SQLCipher recommendation)
  const key = pbkdf2Sync(passphrase, keySalt, 64000, 32, "sha256");

  return key.toString("hex");
}

/**
 * Get encryption key from environment variable
 * Required in production (NODE_ENV=production)
 * Optional in development/test environments
 *
 * @returns Derived encryption key or undefined if not set
 * @throws Error if NODE_ENV=production and LEX_DB_KEY is not set
 */
export function getEncryptionKey(): string | undefined {
  const passphrase = process.env.LEX_DB_KEY;

  // In production, encryption key is mandatory and must not be empty or whitespace-only
  if (process.env.NODE_ENV === "production" && (!passphrase || !passphrase.trim())) {
    throw new Error(
      "LEX_DB_KEY environment variable is required in production mode and must not be empty or whitespace-only. " +
        "Set LEX_DB_KEY to a strong passphrase (32+ characters) to enable database encryption."
    );
  }

  // Return derived key if passphrase is provided and not empty/whitespace-only
  return passphrase && passphrase.trim() ? deriveEncryptionKey(passphrase) : undefined;
}

/** Apply connection-local SQLCipher configuration without reading or changing schema. */
function configureEncryption(db: Database.Database): boolean {
  const encryptionKey = getEncryptionKey();
  if (!encryptionKey) return false;

  db.pragma(`cipher='sqlcipher'`);
  db.pragma(`key="x'${encryptionKey}'"`);
  return true;
}

interface FileSnapshotState {
  signature: string;
  size: bigint;
}

function fileSnapshotState(path: string): FileSnapshotState {
  try {
    const stat = statSync(path, { bigint: true });
    return {
      signature: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`,
      size: stat.size,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { signature: "missing", size: 0n };
    }
    throw error;
  }
}

type DatabaseSnapshotReader = (dbPath: string) => Buffer;

function readDatabaseSnapshot(dbPath: string): Buffer {
  return readFileSync(dbPath);
}

// A WAL file starts with a 32-byte file header. A file containing only the
// header has no frames and is effectively idle; treat it as inactive so that
// a header-only sidecar left by a prior read does not block subsequent reads.
// Rollback journals have no fixed header, so any non-zero size is active.
const WAL_ACTIVE_THRESHOLD = 32n;
export { WAL_ACTIVE_THRESHOLD };
const JOURNAL_ACTIVE_THRESHOLD = 0n;

// journalIndex mirrors the journalPaths array: 0 = "-wal", 1 = "-journal".
function isJournalActive(journal: FileSnapshotState, journalIndex: number): boolean {
  return journal.size > (journalIndex === 0 ? WAL_ACTIVE_THRESHOLD : JOURNAL_ACTIVE_THRESHOLD);
}

/**
 * Read a coherent main-file snapshot without asking SQLite to touch WAL bookkeeping.
 *
 * @internal The injectable reader keeps the before/read/after race contract deterministic in
 * tests. Production callers use the default filesystem reader.
 */
export function readStableDatabaseSnapshot(
  dbPath: string,
  readSnapshot: DatabaseSnapshotReader = readDatabaseSnapshot
): Buffer {
  const journalPaths = [`${dbPath}-wal`, `${dbPath}-journal`];
  const sourceBefore = fileSnapshotState(dbPath);
  const journalsBefore = journalPaths.map(fileSnapshotState);

  if (journalsBefore.some(isJournalActive)) {
    throw new ReadOnlyDatabaseError(
      "STORE_UNAVAILABLE",
      "The selected Lex store has an active SQLite journal and cannot be snapshotted without risking stale or incoherent bootstrap context."
    );
  }

  const snapshot = readSnapshot(dbPath);
  const sourceAfter = fileSnapshotState(dbPath);
  const journalsAfter = journalPaths.map(fileSnapshotState);
  const sourceChanged = sourceBefore.signature !== sourceAfter.signature;
  const journalChanged = journalsBefore.some(
    (journal, index) => journal.signature !== journalsAfter[index]?.signature
  );
  const journalBecameActive = journalsAfter.some(isJournalActive);

  if (sourceChanged || journalChanged || journalBecameActive) {
    throw new ReadOnlyDatabaseError(
      "STORE_UNAVAILABLE",
      "The selected Lex store changed while its read-only snapshot was being captured; retry after the writer is idle."
    );
  }

  return snapshot;
}

/** Make a detached WAL-mode main file self-contained for in-memory deserialization. */
function normalizeDetachedSnapshotJournalMode(snapshot: Buffer): Buffer {
  const sqliteHeader = Buffer.from("SQLite format 3\0", "utf8");
  if (snapshot.length < 20 || !snapshot.subarray(0, sqliteHeader.length).equals(sqliteHeader)) {
    return snapshot;
  }

  // Header bytes 18 and 19 are the SQLite file write/read versions. A value of
  // 2 tells SQLite to consult a WAL beside the database. We already proved no
  // non-empty WAL exists, so the detached copy can safely use rollback mode.
  if (snapshot[18] === 2 || snapshot[19] === 2) {
    snapshot[18] = 1;
    snapshot[19] = 1;
  }
  return snapshot;
}

/** Open one already-captured SQLite snapshot without mutating its source bytes. */
export function openDatabaseSnapshotReadOnly(snapshot: Buffer): Database.Database {
  let db: Database.Database | undefined;
  try {
    db = new Database(normalizeDetachedSnapshotJournalMode(Buffer.from(snapshot)));
    db.pragma("query_only = ON");
    return db;
  } catch (error) {
    if (db) db.close();
    const message = error instanceof Error ? error.message : String(error);
    throw new ReadOnlyDatabaseError(
      "STORE_UNAVAILABLE",
      `The selected Lex store snapshot could not be opened read-only: ${message}`
    );
  }
}

/**
 * Open an existing database through a connection that cannot write.
 *
 * This path deliberately does not create directories, initialize schema, apply
 * migrations, or set file-backed pragmas such as journal_mode.
 */
export function openDetachedDatabaseReadOnly(dbPath: string): Database.Database {
  if (dbPath.startsWith("file:")) {
    throw new ReadOnlyDatabaseError(
      "STORE_UNAVAILABLE",
      "SQLite file URIs cannot yet be opened through the detached read-only snapshot path. Configure LEX_DB_PATH with a filesystem path for hard read-only context reads."
    );
  }

  if (!dbPath || dbPath === ":memory:" || !existsSync(dbPath)) {
    throw new ReadOnlyDatabaseError(
      "STORE_NOT_FOUND",
      `The selected Lex store does not exist as a filesystem database: ${dbPath}.`
    );
  }

  let snapshot: Buffer;
  try {
    if (getEncryptionKey()) {
      throw new ReadOnlyDatabaseError(
        "STORE_UNAVAILABLE",
        "Encrypted Lex stores cannot yet be opened through the detached read-only snapshot path."
      );
    }
    snapshot = readStableDatabaseSnapshot(dbPath);
  } catch (error) {
    if (error instanceof ReadOnlyDatabaseError) throw error;
    throw new ReadOnlyDatabaseError(
      "STORE_UNAVAILABLE",
      `The selected Lex store could not be snapshotted read-only: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // better-sqlite3's file-level readonly mode still creates WAL/SHM sidecars.
  // Deserialize the stable filesystem snapshot into a query-only connection.
  return openDatabaseSnapshotReadOnly(snapshot);
}

/** Inspect a detached snapshot without creating, migrating, or repairing the source store. */
export function inspectDatabaseSchemaReadOnly(dbPath: string): SqliteSchemaInspection {
  const db = openDetachedDatabaseReadOnly(dbPath);
  try {
    return inspectSqliteSchema(db, { integrityCheck: true, frameCount: true });
  } finally {
    db.close();
  }
}

/**
 * Open an existing store for an explicitly requested maintenance operation.
 * This configures encryption and connection-local safety settings but never
 * initializes or migrates schema.
 */
export function openDatabaseForMaintenance(dbPath: string): Database.Database {
  if (!dbPath || dbPath === ":memory:" || dbPath.startsWith("file:") || !existsSync(dbPath)) {
    throw new Error(`SQLite maintenance requires an existing filesystem database: ${dbPath}.`);
  }

  const db = new Database(dbPath, { fileMustExist: true });
  try {
    configureEncryption(db);
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * Open an existing database through a connection that cannot write.
 *
 * This path deliberately does not create directories, initialize schema, apply
 * migrations, or set file-backed pragmas such as journal_mode.
 */
export function openDatabaseReadOnly(dbPath: string): Database.Database {
  const db = openDetachedDatabaseReadOnly(dbPath);
  try {
    const inspection = inspectSqliteSchema(db);
    const currentVersion = inspection.schema_version;

    if (currentVersion === null) {
      throw new ReadOnlyDatabaseError(
        "STORE_REQUIRES_MIGRATION",
        `The selected Lex store has no valid schema version metadata; version ${DATABASE_SCHEMA_VERSION} is required. Run an explicit writable Lex command to initialize or migrate it.`,
        0
      );
    }

    const structuralIssues = inspection.issues.filter(
      (issue) =>
        ![
          "SCHEMA_VERSION_BEHIND",
          "LEGACY_DIVERGENT_SCHEMA_VERSION",
          "SCHEMA_VERSION_NEWER",
        ].includes(issue.code)
    );
    if (currentVersion >= 12 && structuralIssues.length > 0) {
      throw new ReadOnlyDatabaseError(
        "STORE_INCOMPATIBLE",
        `The selected Lex store reports SQLite schema version ${currentVersion} but is structurally inconsistent: ${structuralIssues
          .map((issue) => issue.object_name)
          .join(
            ", "
          )}. Run \`lex db repair\` to diagnose it; read-only access will not modify the store.`,
        currentVersion
      );
    }

    if (currentVersion < DATABASE_SCHEMA_VERSION) {
      const action =
        currentVersion === LEGACY_DIVERGENT_SCHEMA_VERSION
          ? "Run `lex db repair`, then explicitly apply the recognized repair with `lex db repair --write`."
          : "Run an explicit writable Lex command to migrate it.";
      throw new ReadOnlyDatabaseError(
        "STORE_REQUIRES_MIGRATION",
        `The selected Lex store uses SQLite schema version ${currentVersion}; version ${DATABASE_SCHEMA_VERSION} is required. ${action}`,
        currentVersion
      );
    }
    if (currentVersion > DATABASE_SCHEMA_VERSION) {
      throw new ReadOnlyDatabaseError(
        "STORE_INCOMPATIBLE",
        `The selected Lex store uses newer SQLite schema version ${currentVersion}; this Lex build supports version ${DATABASE_SCHEMA_VERSION}.`,
        currentVersion
      );
    }
    if (!inspection.healthy) {
      throw new ReadOnlyDatabaseError(
        "STORE_INCOMPATIBLE",
        `The selected Lex store failed structural validation: ${inspection.issues
          .map((issue) => issue.object_name)
          .join(", ")}. Run \`lex db repair\` to diagnose it.`,
        currentVersion
      );
    }

    return db;
  } catch (error) {
    db.close();
    if (error instanceof ReadOnlyDatabaseError) throw error;
    throw new ReadOnlyDatabaseError(
      "STORE_UNAVAILABLE",
      `The selected Lex store could not be validated read-only: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Initialize database with schema and indexes
 */
export function initializeDatabase(db: Database.Database): void {
  // Set SQLite pragmas for performance and reliability
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = 10000");
  db.pragma("foreign_keys = ON");

  // Create schema version table for migration support
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Check current schema version
  const versionRow = db.prepare("SELECT MAX(version) as version FROM schema_version").get() as {
    version: number | null;
  };
  const currentVersion = versionRow?.version || 0;

  if (currentVersion > DATABASE_SCHEMA_VERSION) {
    const inspection = inspectSqliteSchema(db);
    throw new SqliteSchemaIntegrityError(
      `SQLite schema version ${currentVersion} is newer than supported version ${DATABASE_SCHEMA_VERSION}.`,
      inspection
    );
  }
  if (currentVersion === LEGACY_DIVERGENT_SCHEMA_VERSION) {
    const inspection = inspectSqliteSchema(db);
    throw new SqliteSchemaIntegrityError(
      `SQLite schema version ${currentVersion} requires explicit repair; ordinary initialization will not modify it. Run \`lex db repair\` to diagnose the store.`,
      inspection
    );
  }

  // Apply migrations
  if (currentVersion < 1) {
    applyMigrationV1(db);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(1);
  }
  if (currentVersion < 2) {
    applyMigrationV2(db);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(2);
  }
  if (currentVersion < 3) {
    applyMigrationV3(db);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(3);
  }
  if (currentVersion < 4) {
    applyMigrationV4(db);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(4);
  }
  if (currentVersion < 5) {
    applyMigrationV5(db);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(5);
  }
  if (currentVersion < 6) {
    applyMigrationV6(db);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(6);
  }
  if (currentVersion < 7) {
    applyMigrationV7(db);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(7);
  }
  if (currentVersion < 8) {
    applyMigrationV8(db);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(8);
  }
  if (currentVersion < 9) {
    applyMigrationV9(db);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(9);
  }
  if (currentVersion < 10) {
    applyMigrationV10(db);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(10);
  }
  if (currentVersion < 11) {
    applyMigrationV11(db);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(11);
  }
  if (currentVersion < 12) {
    applyMigrationV12(db);
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(12);
  }

  const migratedInspection = inspectSqliteSchema(db);
  const nonVersionIssues = migratedInspection.issues.filter(
    (issue) => issue.code !== "SCHEMA_VERSION_BEHIND"
  );
  if (migratedInspection.schema_version === 12 && nonVersionIssues.length === 0) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(DATABASE_SCHEMA_VERSION);
  }

  const finalInspection = inspectSqliteSchema(db);
  if (!finalInspection.healthy) {
    throw new SqliteSchemaIntegrityError(
      "The SQLite store does not match the required FrameStore structure. Run `lex db repair` for a non-mutating diagnosis.",
      finalInspection
    );
  }
}

/**
 * Migration V1: Initial schema
 */
function applyMigrationV1(db: Database.Database): void {
  // Create frames table with all fields from FRAME.md
  db.exec(`
    CREATE TABLE IF NOT EXISTS frames (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      branch TEXT NOT NULL,
      jira TEXT,
      module_scope TEXT NOT NULL,
      summary_caption TEXT NOT NULL,
      reference_point TEXT NOT NULL,
      status_snapshot TEXT NOT NULL,
      keywords TEXT,
      atlas_frame_id TEXT,
      feature_flags TEXT,
      permissions TEXT
    );
  `);

  // Create FTS5 virtual table for fuzzy search on reference_point, keywords, summary_caption
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS frames_fts USING fts5(
      reference_point,
      summary_caption,
      keywords,
      content='frames',
      content_rowid='rowid'
    );
  `);

  // Create triggers to keep FTS index in sync with frames table
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS frames_ai AFTER INSERT ON frames BEGIN
      INSERT INTO frames_fts(rowid, reference_point, summary_caption, keywords)
      VALUES (new.rowid, new.reference_point, new.summary_caption, new.keywords);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS frames_ad AFTER DELETE ON frames BEGIN
      DELETE FROM frames_fts WHERE rowid = old.rowid;
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS frames_au AFTER UPDATE ON frames BEGIN
      UPDATE frames_fts
      SET reference_point = new.reference_point,
          summary_caption = new.summary_caption,
          keywords = new.keywords
      WHERE rowid = new.rowid;
    END;
  `);

  // Create indexes for common query patterns
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_frames_timestamp ON frames(timestamp DESC);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_frames_branch ON frames(branch);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_frames_jira ON frames(jira);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_frames_atlas_frame_id ON frames(atlas_frame_id);
  `);
}

/**
 * Migration V2: Add images table
 */
function applyMigrationV2(db: Database.Database): void {
  // Create images table for Frame attachments
  db.exec(`
    CREATE TABLE IF NOT EXISTS images (
      image_id TEXT PRIMARY KEY,
      frame_id TEXT NOT NULL,
      data BLOB NOT NULL,
      mime_type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (frame_id) REFERENCES frames(id) ON DELETE CASCADE
    );
  `);

  // Create index for frame_id lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_images_frame_id ON images(frame_id);
  `);
}

/**
 * Migration V3: Add execution provenance fields (Frame schema v2)
 */
function applyMigrationV3(db: Database.Database): void {
  // Add new optional columns for execution provenance
  // Safe to add with NULL default, backward compatible
  db.exec(`
    ALTER TABLE frames ADD COLUMN run_id TEXT;
  `);

  db.exec(`
    ALTER TABLE frames ADD COLUMN plan_hash TEXT;
  `);

  db.exec(`
    ALTER TABLE frames ADD COLUMN spend TEXT;
  `);
}

/**
 * Migration V4: Add OAuth2/JWT authentication support
 */
function applyMigrationV4(db: Database.Database): void {
  // Create users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login TEXT,
      UNIQUE(provider, provider_user_id)
    );
  `);

  // Create refresh tokens table
  db.exec(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
  `);

  // Create index for token lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
  `);

  // Add user_id column to frames table
  db.exec(`
    ALTER TABLE frames ADD COLUMN user_id TEXT;
  `);

  // Create index for user_id lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_frames_user_id ON frames(user_id);
  `);

  // Create a default system user and assign existing frames to it
  const defaultUserId = "system-default";
  db.exec(`
    INSERT OR IGNORE INTO users (user_id, email, name, provider, provider_user_id)
    VALUES ('${defaultUserId}', 'system@localhost', 'System Default User', 'system', 'default');
  `);

  // Assign all existing frames (with NULL user_id) to the default user
  db.exec(`
    UPDATE frames SET user_id = '${defaultUserId}' WHERE user_id IS NULL;
  `);
}

/**
 * Migration V5: Add code_units table for the experimental Code Index
 *
 * Stores CodeUnit records for code discovery and indexing.
 * Schema aligned with src/atlas/schemas/code-unit.ts (CA-001).
 *
 * Note: Database uses snake_case column names, which will be mapped to
 * camelCase TypeScript properties in the queries module (matching Frame pattern).
 * The span.startLine/endLine from CodeUnit schema is flattened to start_line/end_line.
 */
function applyMigrationV5(db: Database.Database): void {
  // Create code_units table with schema aligned to CodeUnit type
  // Kind values must match CodeUnitKindSchema enum in src/atlas/schemas/code-unit.ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS code_units (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      language TEXT NOT NULL,

      kind TEXT NOT NULL CHECK (kind IN ('module', 'class', 'function', 'method')),
      symbol_path TEXT NOT NULL,
      name TEXT NOT NULL,

      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,

      tags TEXT,
      doc_comment TEXT,

      discovered_at TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT 'code-unit-v0',

      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Index for repo_id lookups (common query pattern)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_code_units_repo ON code_units(repo_id);
  `);

  // Composite index for file path queries within a repo
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_code_units_file ON code_units(repo_id, file_path);
  `);

  // Composite index for kind queries within a repo
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_code_units_kind ON code_units(repo_id, kind);
  `);

  // Index for symbol path lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_code_units_symbol ON code_units(symbol_path);
  `);
}

/**
 * Migration V6: Add code_atlas_runs table for Code Index provenance records
 *
 * Schema aligned with CodeAtlasRun type from src/atlas/schemas/code-atlas-run.ts
 */
function applyMigrationV6(db: Database.Database): void {
  // Create code_atlas_runs table for Code Index extraction provenance
  db.exec(`
    CREATE TABLE IF NOT EXISTS code_atlas_runs (
      run_id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      files_requested TEXT NOT NULL,
      files_scanned TEXT NOT NULL,
      units_emitted INTEGER NOT NULL,
      max_files INTEGER,
      max_bytes INTEGER,
      truncated INTEGER NOT NULL DEFAULT 0,
      strategy TEXT CHECK (strategy IN ('static', 'llm-assisted', 'mixed')),
      created_at TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT 'code-atlas-run-v0'
    );
  `);

  // Create index for repo_id lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_code_atlas_runs_repo ON code_atlas_runs(repo_id);
  `);

  // Create index for created_at queries (temporal ordering)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_code_atlas_runs_created ON code_atlas_runs(created_at);
  `);
}

/**
 * Migration V7: Add lexsona_behavior_rules table for LexSona behavioral memory
 *
 * Schema aligned with LexSona Mathematical Framework v0.1
 * and CptPlnt lexsona_behavior_rule.schema.json
 *
 * @see docs/research/LexSona/MATH_FRAMEWORK_v0.1.md
 * @see docs/research/LexSona/CptPlnt/lexsona_behavior_rule.schema.json
 */
function applyMigrationV7(db: Database.Database): void {
  // Create lexsona_behavior_rules table for behavioral rule storage
  db.exec(`
    CREATE TABLE IF NOT EXISTS lexsona_behavior_rules (
      rule_id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      text TEXT NOT NULL,

      -- Scope (all nullable for partial matching)
      -- Stored as JSON for flexibility
      scope TEXT NOT NULL,

      -- Bayesian Beta confidence model
      -- Prior: Beta(alpha_0=2, beta_0=5) — skeptical, requires evidence
      alpha INTEGER NOT NULL DEFAULT 2,
      beta INTEGER NOT NULL DEFAULT 5,

      -- Observation count (reinforcements + counterexamples)
      observation_count INTEGER NOT NULL DEFAULT 0,

      -- Severity level
      severity TEXT NOT NULL CHECK(severity IN ('must', 'should', 'style')) DEFAULT 'should',

      -- Decay time constant in days (default: 180 days)
      decay_tau INTEGER NOT NULL DEFAULT 180,

      -- Timestamps
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_observed TEXT NOT NULL DEFAULT (datetime('now')),

      -- Optional: Link to Lex Frame for auditability
      frame_id TEXT
    );
  `);

  // Index for scope-based filtering (using JSON_EXTRACT for module_id)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_lexsona_rules_module
    ON lexsona_behavior_rules(json_extract(scope, '$.module_id'));
  `);

  // Index for category-based grouping
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_lexsona_rules_category
    ON lexsona_behavior_rules(category);
  `);

  // Index for confidence + recency filtering (for active rule queries)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_lexsona_rules_observation_last
    ON lexsona_behavior_rules(observation_count, last_observed DESC);
  `);

  // Index for severity filtering
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_lexsona_rules_severity
    ON lexsona_behavior_rules(severity);
  `);

  // Index for frame linkage
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_lexsona_rules_frame_id
    ON lexsona_behavior_rules(frame_id)
    WHERE frame_id IS NOT NULL;
  `);
}

/**
 * Migration V9: Expand FTS5 index to include next_action, module_scope, jira, branch
 *
 * Expands the frames_fts virtual table to search additional fields that agents
 * frequently query. This improves the effectiveness of `lex recall` for
 * agent-driven memory retrieval.
 *
 * Fields added to FTS5 index:
 * - next_action: Extracted from status_snapshot JSON (often contains actionable context)
 * - module_scope: JSON array of module IDs (agents search by module)
 * - jira: Ticket ID (should be instantly searchable)
 * - branch: Branch context (frequently queried)
 *
 * @see https://github.com/Guffawaffle/lex/issues/DX-003
 */
function applyMigrationV9(db: Database.Database): void {
  // Drop existing FTS5 table and triggers
  db.exec(`DROP TRIGGER IF EXISTS frames_au;`);
  db.exec(`DROP TRIGGER IF EXISTS frames_ad;`);
  db.exec(`DROP TRIGGER IF EXISTS frames_ai;`);
  db.exec(`DROP TABLE IF EXISTS frames_fts;`);

  // Create expanded FTS5 virtual table with additional searchable fields
  // Note: We use external contentless FTS5 (content='') to allow custom columns
  // that don't exist in the frames table (e.g., next_action from JSON extraction)
  db.exec(`
    CREATE VIRTUAL TABLE frames_fts USING fts5(
      reference_point,
      summary_caption,
      keywords,
      next_action,
      module_scope,
      jira,
      branch,
      content=''
    );
  `);

  // Create triggers to keep FTS index in sync with frames table
  // Extract next_action from status_snapshot JSON during insert/update
  db.exec(`
    CREATE TRIGGER frames_ai AFTER INSERT ON frames BEGIN
      INSERT INTO frames_fts(rowid, reference_point, summary_caption, keywords, next_action, module_scope, jira, branch)
      VALUES (
        new.rowid,
        new.reference_point,
        new.summary_caption,
        new.keywords,
        json_extract(new.status_snapshot, '$.next_action'),
        new.module_scope,
        new.jira,
        new.branch
      );
    END;
  `);

  db.exec(`
    CREATE TRIGGER frames_ad AFTER DELETE ON frames BEGIN
      INSERT INTO frames_fts(frames_fts, rowid, reference_point, summary_caption, keywords, next_action, module_scope, jira, branch)
      VALUES ('delete', old.rowid, old.reference_point, old.summary_caption, old.keywords, json_extract(old.status_snapshot, '$.next_action'), old.module_scope, old.jira, old.branch);
    END;
  `);

  db.exec(`
    CREATE TRIGGER frames_au AFTER UPDATE ON frames BEGIN
      INSERT INTO frames_fts(frames_fts, rowid, reference_point, summary_caption, keywords, next_action, module_scope, jira, branch)
      VALUES ('delete', old.rowid, old.reference_point, old.summary_caption, old.keywords, json_extract(old.status_snapshot, '$.next_action'), old.module_scope, old.jira, old.branch);
      INSERT INTO frames_fts(rowid, reference_point, summary_caption, keywords, next_action, module_scope, jira, branch)
      VALUES (new.rowid, new.reference_point, new.summary_caption, new.keywords, json_extract(new.status_snapshot, '$.next_action'), new.module_scope, new.jira, new.branch);
    END;
  `);

  // Rebuild FTS index from existing data
  db.exec(`
    INSERT INTO frames_fts(rowid, reference_point, summary_caption, keywords, next_action, module_scope, jira, branch)
    SELECT
      rowid,
      reference_point,
      summary_caption,
      keywords,
      json_extract(status_snapshot, '$.next_action'),
      module_scope,
      jira,
      branch
    FROM frames;
  `);
}

/**
 * Migration V10: Add personas table for managed persona storage
 *
 * Adds personas table to store managed persona definitions for LexSona.
 * Unlike frames, personas have no decay - they are stable configuration
 * with explicit versioning.
 *
 * @see https://github.com/Guffawaffle/lex/issues/616
 */
function applyMigrationV10(db: Database.Database): void {
  // Create personas table
  db.exec(`
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      manifest_yaml TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      source TEXT NOT NULL DEFAULT 'user' CHECK(source IN ('bundled', 'user', 'project')),
      checksum TEXT
    );
  `);

  // Index for filtering by source (bundled, user, project)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_personas_source
    ON personas(source);
  `);

  // Index for ordering by updated_at
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_personas_updated
    ON personas(updated_at DESC);
  `);
}

/**
 * Migration V11: Add deduplication fields to frames table
 *
 * Adds superseded_by and merged_from fields to support frame deduplication.
 * - superseded_by: ID of frame that supersedes this one
 * - merged_from: JSON array of frame IDs that were merged into this one
 */
function applyMigrationV11(db: Database.Database): void {
  // Add superseded_by column
  db.exec(`
    ALTER TABLE frames ADD COLUMN superseded_by TEXT;
  `);

  // Add merged_from column (JSON array)
  db.exec(`
    ALTER TABLE frames ADD COLUMN merged_from TEXT;
  `);

  // Create index for superseded_by to efficiently filter out superseded frames
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_frames_superseded_by
    ON frames(superseded_by);
  `);
}

/** Migration V12: persist module attribution provenance for Frame writes. */
function applyMigrationV12(db: Database.Database): void {
  db.exec(`
    ALTER TABLE frames ADD COLUMN module_attribution TEXT;
  `);
}

/**
 * Migration V8: Receipt storage for governance tracking
 *
 * Adds receipts table to track operation outcomes with failure classification,
 * recovery suggestions, and aggregation support for governance queries.
 */
function applyMigrationV8(db: Database.Database): void {
  // Create receipts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      schema_version TEXT NOT NULL DEFAULT '1.0.0',
      kind TEXT NOT NULL DEFAULT 'Receipt',

      -- What happened
      action TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('success', 'failure', 'partial', 'deferred')),
      rationale TEXT NOT NULL,

      -- Failure classification (Wave 2)
      failure_class TEXT CHECK(failure_class IN (
        'timeout', 'resource_exhaustion', 'model_error',
        'context_overflow', 'policy_violation'
      )),
      failure_details TEXT,
      recovery_suggestion TEXT,

      -- Uncertainty handling
      confidence TEXT NOT NULL CHECK(confidence IN ('high', 'medium', 'low', 'uncertain')),
      uncertainty_notes TEXT, -- JSON array of UncertaintyMarker objects

      -- Reversibility
      reversibility TEXT NOT NULL CHECK(reversibility IN (
        'reversible', 'partially-reversible', 'irreversible'
      )),
      rollback_path TEXT,
      rollback_tested INTEGER, -- SQLite boolean (0 or 1)

      -- Escalation
      escalation_required INTEGER NOT NULL DEFAULT 0, -- SQLite boolean
      escalation_reason TEXT,
      escalated_to TEXT,

      -- Metadata
      timestamp TEXT NOT NULL,
      agent_id TEXT,
      session_id TEXT,
      frame_id TEXT,

      -- OAuth2/JWT user isolation
      user_id TEXT,

      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Index for outcome queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_receipts_outcome
    ON receipts(outcome);
  `);

  // Index for failure classification queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_receipts_failure_class
    ON receipts(failure_class)
    WHERE failure_class IS NOT NULL;
  `);

  // Index for session-based queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_receipts_session
    ON receipts(session_id)
    WHERE session_id IS NOT NULL;
  `);

  // Index for timestamp-based queries (most recent failures, etc.)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_receipts_timestamp
    ON receipts(timestamp DESC);
  `);

  // Index for frame linkage
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_receipts_frame_id
    ON receipts(frame_id)
    WHERE frame_id IS NOT NULL;
  `);

  // Index for user isolation
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_receipts_user_id
    ON receipts(user_id)
    WHERE user_id IS NOT NULL;
  `);

  // Composite index for common governance queries (failure class by session)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_receipts_session_failure
    ON receipts(session_id, failure_class, timestamp DESC)
    WHERE session_id IS NOT NULL AND failure_class IS NOT NULL;
  `);
}

/**
 * Create and initialize a database connection
 *
 * Automatically applies encryption if LEX_DB_KEY is set.
 * In production mode (NODE_ENV=production), encryption is mandatory.
 *
 * @param dbPath - Optional database file path (defaults to getDefaultDbPath())
 * @returns Initialized database connection
 */
export function createDatabase(dbPath?: string): Database.Database {
  const path = dbPath || getDefaultDbPath();
  if (path !== ":memory:" && !path.startsWith("file:")) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);

  try {
    // Apply encryption if key is available
    if (configureEncryption(db)) {
      // Verify encryption is working by testing database access
      try {
        db.prepare("SELECT 1").get();
      } catch (error) {
        throw new Error(
          `Failed to open encrypted database. The encryption key may be incorrect. ` +
            `Error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    initializeDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
