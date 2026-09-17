/**
 * Frame storage interface
 *
 * Main export for database operations with connection pooling and graceful shutdown.
 *
 * Usage:
 *   import { getDb, saveFrame, getFrameById, searchFrames } from '@smartergpt/lex/store';
 *
 *   const db = getDb();
 *   await saveFrame(db, myFrame);
 *   const frame = await getFrameById(db, 'frame-001');
 *   const results = await searchFrames(db, 'auth deadlock');
 */

import Database from "better-sqlite3-multiple-ciphers";
import { createDatabase, getDefaultDbPath } from "./db.js";

export type { FrameRow, CodeAtlasRunRow, ReadOnlyDatabaseErrorCode } from "./db.js";
export type { BehaviorRuleRow } from "./lexsona-queries.js";
export type { CallerProvenance, Frame, FrameStatusSnapshot } from "../frames/types.js";
export type { SearchResult, ExportFramesOptions } from "./queries.js";
export type {
  FrameStore,
  FrameSearchCriteria,
  FrameListOptions,
  FrameListResult,
  SaveResult,
  StoreStats,
  TurnCostMetrics,
  FrameStoreMetadata,
  FrameStoreHealth,
} from "./frame-store.js";
export {
  FRAME_STORE_SCOPE_CONTRACT_VERSION,
  FRAME_STORE_CAPABILITIES,
  SCOPED_FRAME_STORE_ERROR_CODES,
  ScopedFrameStoreError,
  scopedFrameStoreAsLegacyView,
} from "./scoped-frame-store.js";
export type {
  FrameStoreCapability,
  FrameOwnershipV1,
  ScopedFrameInput,
  ScopedFrameUpdate,
  ScopedFrameSearchCriteria,
  ScopedFrameListOptions,
  ScopedFrameStore,
  ScopedFrameStoreBinder,
  FrameStoreAdmin,
  FrameStoreAdminBinder,
  ScopedFrameStoreErrorCode,
} from "./scoped-frame-store.js";
export type { CodeAtlasStore } from "./code-atlas-store.js";

export {
  BEHAVIORAL_STORE_CONTRACT_VERSION,
  BEHAVIORAL_STORE_CAPABILITIES,
  BEHAVIORAL_STORE_ERROR_CODES,
  BehavioralStoreError,
  behavioralContentDigest,
  canonicalBehavioralJson,
} from "./behavioral-store.js";
export type {
  BehavioralStoreCapability,
  BehavioralStoreErrorCode,
  BehavioralStoreBindingV1,
  BehavioralRuleSeverityV1,
  BehavioralRuleLayerV1,
  BehavioralApplicabilityV1,
  BehavioralConfidencePriorV1,
  PersonaRevisionInputV1,
  RuleRevisionInputV1,
  BehavioralDetailedProvenanceV1,
  PersonaRevisionV1,
  RuleRevisionV1,
  BehavioralBaselineRevisionV1,
  BehavioralSnapshotQueryV1,
  BehavioralSnapshotV1,
  BehavioralEvidenceKindV1,
  BehavioralEvidenceInputV1,
  BehavioralPromotionInputV1,
  BehavioralRevisionWriteV1,
  BehavioralWriteOperationV1,
  BehavioralWriteReceiptV1,
  ScopedBehavioralReadStore,
  ScopedBehavioralWriteStore,
  BehavioralStoreBinder,
  BehavioralStoreBackendOptionsV1,
} from "./behavioral-store.js";

// SqliteFrameStore - production-ready FrameStore implementation
export {
  SqliteFrameStore,
  SqliteScopedFrameStoreBackend,
  SqliteBehavioralStoreBackend,
  SQLITE_BEHAVIORAL_STORE_SCHEMA_VERSION,
  SCOPED_SQLITE_SCHEMA_VERSION,
  LEGACY_SQLITE_SCHEMA_VERSION,
  SCOPED_SQLITE_ERROR_CODES,
  ScopedSqliteError,
  inspectScopedSqliteSchema,
  requireHealthyScopedSqliteSchema,
  SQLITE_SCOPE_MIGRATION_MANIFEST_VERSION,
  SQLITE_SCOPE_MIGRATION_RECEIPT_VERSION,
  inventorySqliteScope,
  createSqliteScopeMigrationManifest,
  validateSqliteScopeMigrationManifest,
  migrateSqliteStoreToScopedV15,
  recoverSqliteScopeMigration,
} from "./sqlite/index.js";
export type {
  SqliteFrameStoreAccessMode,
  SqliteFrameStoreOptions,
  SqliteScopedFrameStoreOptions,
  ScopedSqliteErrorCode,
  ScopedSqliteSchemaState,
  ScopedSqliteSchemaInspection,
  SqliteStoreScopeBindingV1,
  SqliteScopeTargetV1,
  SqliteScopeInventoryV1,
  SqliteScopeMigrationManifestV1,
  SqliteScopeMigrationReceiptV1,
  SqliteScopeMigrationResult,
  SqliteScopeRecoveryReceiptV1,
} from "./sqlite/index.js";

// PostgreSQL FrameStore - opt-in shared backend for cross-platform storage
export {
  PostgresFrameStoreAdministration,
  PostgresFrameStore,
  PostgresScopedFrameStoreBackend,
  openPostgresBehavioralStore,
  postgresBehavioralBackendIdentity,
  POSTGRES_BEHAVIORAL_STORE_SCHEMA_VERSION,
  migratePostgresBehavioralStore,
  planPostgresBehavioralStoreMigration,
  postgresBehavioralMigrationSql,
  postgresBehavioralRollbackSql,
  migratePostgresFrameStore,
  planPostgresFrameStoreMigration,
  POSTGRES_COMPATIBILITY_FRAME_STORE_SCHEMA_VERSION,
  POSTGRES_FRAME_STORE_SCHEMA_VERSION,
  QUARANTINE_RECOVERY_ADMIN_CAPABILITY,
  QUARANTINE_RECOVERY_COMPATIBILITY_ACKNOWLEDGEMENT,
  QUARANTINE_RECOVERY_CONTRACT_VERSION,
  QUARANTINE_RECOVERY_ERROR_CODES,
  QuarantineRecoveryError,
  canonicalQuarantineRecoveryJson,
  createQuarantineInventory,
  createQuarantineRecoveryManifest,
  planQuarantineRecovery,
  quarantineRecoveryDigest,
  BoundPostgresQuarantineRecoveryAdministration,
  PostgresQuarantineRecoveryAdministration,
} from "./postgres/index.js";
export type {
  PostgresFrameStoreAccessMode,
  PostgresFrameStoreMigrationPlan,
  PostgresFrameStoreOptions,
  PostgresScopedFrameStoreOptions,
  PostgresBehavioralStoreOptionsV1,
  PostgresBehavioralStoreMigrationPlanV1,
  CompatibilityQuarantineRecoveryDecisionV1,
  QuarantinedFrameEvidenceV1,
  QuarantineDestinationCollisionV1,
  QuarantineInventoryV1,
  QuarantineInventoryWarningV1,
  QuarantineRecoveryAuthorityV1,
  QuarantineRecoveryApplyOptionsV1,
  QuarantineRecoveryApplyReceiptV1,
  QuarantineRecoveryCleanupOptionsV1,
  QuarantineRecoveryCleanupReceiptV1,
  QuarantineRecoveryDecisionV1,
  QuarantineRecoveryErrorCode,
  QuarantineRecoveryManifestInputV1,
  QuarantineRecoveryManifestV1,
  QuarantineRecoveryPlanInputV1,
  QuarantineRecoveryPlanV1,
  QuarantineRecoveryStateV1,
  QuarantineSourceEvidenceV1,
  ScopedQuarantineRecoveryDecisionV1,
  PostgresQuarantineRecoveryAdministrationOptions,
} from "./postgres/index.js";

// Memory-based store implementations for testing
export { MemoryFrameStore, MemoryScopedFrameStoreBackend } from "./memory/index.js";
export type { MemoryScopedFrameStoreOptions } from "./memory/index.js";

// Import FrameStore interface and SqliteFrameStore for factory function
import type { FrameStore } from "./frame-store.js";
import { SqliteFrameStore } from "./sqlite/index.js";
import { PostgresFrameStore } from "./postgres/index.js";

import { resolveFrameStoreBackend, type FrameStoreFactoryOptions } from "./backend.js";
export { resolveFrameStoreBackend } from "./backend.js";
export type { FrameStoreBackend, FrameStoreFactoryOptions } from "./backend.js";

/**
 * Create a FrameStore using LEX_STORE=sqlite|postgres (SQLite by default).
 *
 * This factory function provides a clean interface for CLI commands to obtain
 * a FrameStore, enabling easy testing by allowing injection of alternative
 * implementations (e.g., MemoryFrameStore).
 *
 * @param dbPath - Optional database path (defaults to standard ~/.lex/frames.db)
 * @param options - Explicit access mode shared by SQLite and PostgreSQL backends.
 * @returns A FrameStore instance configured with the specified database path.
 */
export function createFrameStore(
  dbPath?: string,
  options: FrameStoreFactoryOptions = {}
): FrameStore {
  return resolveFrameStoreBackend() === "postgres"
    ? new PostgresFrameStore(process.env.LEX_DATABASE_URL, options)
    : new SqliteFrameStore(dbPath ?? getDefaultDbPath(), options);
}

export {
  saveFrame,
  getFrameById,
  searchFrames,
  getFramesByBranch,
  getFramesByJira,
  getFramesByModuleScope,
  getAllFrames,
  getFramesForExport,
  deleteFrame,
  getFrameCount,
} from "./queries.js";

export {
  saveCodeAtlasRun,
  getCodeAtlasRunById,
  getCodeAtlasRunsByRepo,
  getAllCodeAtlasRuns,
  deleteCodeAtlasRun,
  getCodeAtlasRunCount,
} from "./code-atlas-runs.js";

export type {
  CodeUnitRow,
  ListOptions,
  CodeUnitQueryOptions,
  PaginatedResult,
  BatchInsertResult,
  BatchDeleteResult,
} from "./code-unit-queries.js";

export {
  saveCodeUnit,
  updateCodeUnit,
  insertCodeUnitBatch,
  getCodeUnitById,
  queryCodeUnits,
  listCodeUnitsByRepo,
  listCodeUnitsByFile,
  listCodeUnitsByKind,
  searchCodeUnitsBySymbol,
  deleteCodeUnit,
  deleteCodeUnitsByRepo,
  getCodeUnitCount,
} from "./code-unit-queries.js";

// Receipt storage exports
export type {
  ReceiptRow,
  FailureStats,
  ModuleFailureStats,
  RecoverySuccessRate,
} from "./receipt-queries.js";

export {
  storeReceipt,
  getReceiptById,
  getReceiptsBySession,
  getMostCommonFailureMode,
  getFailureModesBySession,
  deleteReceiptsBySession,
} from "./receipt-queries.js";

// LexSona behavior rules exports
export {
  saveBehaviorRule,
  getBehaviorRuleById,
  getAllBehaviorRules,
  deleteBehaviorRule,
  getBehaviorRuleCount,
  reinforceRule,
  counterExampleRule,
  createBehaviorRule,
  getRulesByContext,
  findRuleByContext,
  // Persona CRUD
  savePersona,
  getPersona,
  listPersonas,
  deletePersona,
  upsertPersona,
  getPersonaChecksum,
} from "./lexsona-queries.js";

// LexSona types
export type {
  BehaviorRule,
  BehaviorRuleWithConfidence,
  RuleScope,
  RuleSeverity,
  RuleContext,
  Correction,
  GetRulesOptions,
  // Persona types
  PersonaRecord,
  PersonaSource,
  ListPersonasFilter,
} from "./lexsona-types.js";
export { LEXSONA_DEFAULTS } from "./lexsona-types.js";

// Singleton database instance
let dbInstance: Database.Database | null = null;
let dbPath: string | null = null;

/**
 * Get or create the database instance
 * @param customPath Optional custom database path (defaults to ~/.lex/frames.db)
 */
export function getDb(customPath?: string): Database.Database {
  const targetPath = customPath || getDefaultDbPath();

  // Create new instance if path changed or no instance exists
  if (!dbInstance || (customPath && dbPath !== customPath)) {
    // Close existing instance if path is changing
    if (dbInstance && dbPath !== targetPath) {
      dbInstance.close();
    }

    dbInstance = createDatabase(targetPath);
    dbPath = targetPath;
  }

  return dbInstance;
}

/**
 * Close the database connection gracefully
 */
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbPath = null;
  }
}

/**
 * Handle graceful shutdown on process termination
 */
function setupGracefulShutdown(): void {
  const shutdown = () => {
    closeDb();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("beforeExit", () => {
    closeDb();
  });
}

// Setup shutdown handlers when module is imported
setupGracefulShutdown();

// Export database creation for testing
export {
  createDatabase,
  openDatabaseReadOnly,
  getDefaultDbPath,
  deriveEncryptionKey,
  getEncryptionKey,
  validatePassphraseStrength,
  FRAME_STORE_SCHEMA_VERSION,
  DATABASE_SCHEMA_VERSION,
  ReadOnlyDatabaseError,
} from "./db.js";
export type { PassphraseValidationResult } from "./db.js";

// Export SQLite store implementations
export { SqliteCodeAtlasStore } from "./sqlite/index.js";

// Export AttachmentManager for external file storage (AX-011)
export { AttachmentManager } from "./attachments.js";
export type { AttachmentRef } from "./attachments.js";
