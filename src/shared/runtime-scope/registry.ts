import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

import type Database from "better-sqlite3-multiple-ciphers";

import type { WorkspaceSelectorV1 } from "./authority.js";
import {
  LOCAL_BINDING_CONTRACT_VERSION,
  type BindingReceiptV1,
  type BindingVerificationStatus,
  type BindingVerificationV1,
  type CachedAuthorityEvidenceV1,
  type ExecutionSurfaceEvidenceV1,
  type FindRepositoryInstancesRequestV1,
  type LocalBindingRegistry,
  type RegisterBindingRequestV1,
  type RepositoryDeclarationV1,
  type RepositoryInstanceBindingV1,
  type RepositoryInstanceEvidenceV1,
  type RevokeBindingRequestV1,
  type VerifyBindingRequestV1,
} from "./bindings.js";
import type {
  BindingId,
  BindingReceiptId,
  ContentDigest,
  ExecutionSurfaceId,
  PrincipalId,
  RegistryInstanceId,
} from "./ids.js";
import {
  createLocalRegistrySchemaV1,
  insertLocalRegistryBinding,
  insertLocalRegistryEvent,
  insertLocalRegistryIdentity,
  insertLocalRegistryMigration,
  listActiveLocalRegistryBindings,
  listLocalRegistryBindings,
  listLocalRegistryEvents,
  listLocalRegistryTableNames,
  readLocalRegistryApplicationId,
  readLocalRegistryBinding,
  readLocalRegistryIdentity,
  readLocalRegistryMigrationVersion,
  revokeLocalRegistryBinding,
  setLocalRegistrySchemaIdentity,
  updateLocalRegistryBinding,
  type BindingEventRow,
  type BindingRow,
  type RegistryIdentityRow,
} from "./registry-queries.js";
import {
  executionSurfacePathsAreRelated,
  normalizeExecutionSurfaceIdentityPath,
} from "./surface.js";

export const LOCAL_REGISTRY_SCHEMA_VERSION = 1 as const;
export const LOCAL_REGISTRY_APPLICATION_ID = 0x4c585231 as const;

export type LocalRegistryAccessMode = "read-only" | "administrative";
export type LocalRegistryErrorCode =
  | "REGISTRY_NOT_FOUND"
  | "REGISTRY_SCHEMA_INCOMPATIBLE"
  | "REGISTRY_SURFACE_MISMATCH"
  | "REGISTRY_READ_ONLY"
  | "REGISTRY_INVALID_INPUT"
  | "REGISTRY_CONFLICT";

export class LocalRegistryError extends Error {
  constructor(
    public readonly code: LocalRegistryErrorCode,
    message: string
  ) {
    super(message);
    this.name = "LocalRegistryError";
  }
}

export interface LocalRegistryIdFactoryV1 {
  readonly bindingId: () => BindingId;
  readonly receiptId: () => BindingReceiptId;
}

export interface InitializeLocalRegistryOptionsV1 {
  readonly databasePath: string;
  readonly registryInstanceId: RegistryInstanceId;
  readonly executionSurfaceId: ExecutionSurfaceId;
  readonly executionSurface: ExecutionSurfaceEvidenceV1;
  readonly createdAt?: string;
  readonly now?: () => string;
  readonly idFactory?: LocalRegistryIdFactoryV1;
}

export interface OpenLocalRegistryOptionsV1 {
  readonly databasePath: string;
  readonly executionSurface: ExecutionSurfaceEvidenceV1;
  readonly access?: LocalRegistryAccessMode;
  readonly expectedRegistryInstanceId?: RegistryInstanceId;
  readonly expectedExecutionSurfaceId?: ExecutionSurfaceId;
  readonly now?: () => string;
  readonly idFactory?: LocalRegistryIdFactoryV1;
}

export interface InspectBindingsRequestV1 {
  readonly bindingId?: BindingId;
  readonly state?: "active" | "revoked";
}

export interface RebindBindingRequestV1 {
  readonly bindingId: BindingId;
  readonly declaration?: RepositoryDeclarationV1;
  readonly evidence: RepositoryInstanceEvidenceV1;
  readonly authorityEvidence: CachedAuthorityEvidenceV1;
  readonly reboundByPrincipalId: PrincipalId;
  readonly reboundAt: string;
  readonly reason: string;
}

export type BindingLifecycleAction = "register" | "rebind" | "revoke";

export interface BindingLifecycleReceiptV1 extends BindingReceiptV1 {
  readonly action: BindingLifecycleAction;
  readonly reason?: string;
}

type DatabaseConstructor = new (filename: string, options?: Database.Options) => Database.Database;

const require = createRequire(import.meta.url);
let cachedDatabaseConstructor: DatabaseConstructor | undefined;

function openSqlite(filename: string, options?: Database.Options): Database.Database {
  cachedDatabaseConstructor ??= require("better-sqlite3-multiple-ciphers") as DatabaseConstructor;
  return new cachedDatabaseConstructor(filename, options);
}

function defaultIdFactory(): LocalRegistryIdFactoryV1 {
  return {
    bindingId: () => randomUUID() as BindingId,
    receiptId: () => randomUUID() as BindingReceiptId,
  };
}

function requireNonEmpty(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new LocalRegistryError("REGISTRY_INVALID_INPUT", `${name} cannot be empty.`);
  }
  return value;
}

function timestamp(value: string, name: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new LocalRegistryError(
      "REGISTRY_INVALID_INPUT",
      `${name} must be an ISO-compatible timestamp.`
    );
  }
  return parsed;
}

function assertSchemaVersion(
  value: { readonly schemaVersion: number },
  expected: number,
  name: string
): void {
  if (value.schemaVersion !== expected) {
    throw new LocalRegistryError(
      "REGISTRY_INVALID_INPUT",
      `${name} schema ${String(value.schemaVersion)} is not supported by schema ${expected}.`
    );
  }
}

function assertExecutionSurfaceVersion(surface: ExecutionSurfaceEvidenceV1): void {
  assertSchemaVersion(surface, LOCAL_BINDING_CONTRACT_VERSION, "execution surface");
}

function assertEvidenceVersion(evidence: RepositoryInstanceEvidenceV1): void {
  assertSchemaVersion(evidence, LOCAL_BINDING_CONTRACT_VERSION, "repository evidence");
}

function assertDeclarationVersion(declaration: RepositoryDeclarationV1 | undefined): void {
  if (declaration) {
    assertSchemaVersion(declaration, LOCAL_BINDING_CONTRACT_VERSION, "repository declaration");
  }
}

function assertAuthorityVersion(authority: CachedAuthorityEvidenceV1): void {
  assertSchemaVersion(authority, LOCAL_BINDING_CONTRACT_VERSION, "cached authority");
}

function assertBindingVersions(binding: RepositoryInstanceBindingV1): void {
  assertSchemaVersion(binding, LOCAL_BINDING_CONTRACT_VERSION, "repository binding");
  assertEvidenceVersion(binding.evidence);
  if (binding.cachedAuthority) assertAuthorityVersion(binding.cachedAuthority);
}

function digestFields(fields: readonly (string | undefined)[]): ContentDigest {
  const hash = createHash("sha256");
  for (const field of fields) {
    const value = field ?? "";
    hash.update(String(Buffer.byteLength(value, "utf8")));
    hash.update(":");
    hash.update(value);
    hash.update(";");
  }
  return `sha256:${hash.digest("hex")}` as ContentDigest;
}

function normalizeRoot(root: string, surface: ExecutionSurfaceEvidenceV1): string {
  try {
    return normalizeExecutionSurfaceIdentityPath(root, surface, "repository canonical root");
  } catch (error) {
    throw new LocalRegistryError(
      "REGISTRY_INVALID_INPUT",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function assertRelatedRoots(
  projectRoot: string,
  canonicalRoot: string,
  surface: ExecutionSurfaceEvidenceV1
): void {
  try {
    if (!executionSurfacePathsAreRelated(projectRoot, canonicalRoot, surface)) {
      throw new LocalRegistryError(
        "REGISTRY_INVALID_INPUT",
        "projectRoot must identify the repository root or a path nested with it."
      );
    }
  } catch (error) {
    if (error instanceof LocalRegistryError) throw error;
    throw new LocalRegistryError(
      "REGISTRY_INVALID_INPUT",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function normalizeEvidence(
  evidence: RepositoryInstanceEvidenceV1,
  surface: ExecutionSurfaceEvidenceV1
): RepositoryInstanceEvidenceV1 {
  assertEvidenceVersion(evidence);
  return Object.freeze({
    ...evidence,
    canonicalRoot: normalizeRoot(evidence.canonicalRoot, surface),
    ...(evidence.provider
      ? {
          provider: Object.freeze({
            ...evidence.provider,
            provider: requireNonEmpty(evidence.provider.provider, "provider"),
            providerRepositoryId: requireNonEmpty(
              evidence.provider.providerRepositoryId,
              "providerRepositoryId"
            ),
          }),
        }
      : {}),
  });
}

export function computeRepositoryEvidenceDigest(
  evidence: RepositoryInstanceEvidenceV1,
  surface: ExecutionSurfaceEvidenceV1
): ContentDigest {
  assertExecutionSurfaceVersion(surface);
  const normalized = normalizeEvidence(evidence, surface);
  return digestFields([
    String(normalized.schemaVersion),
    normalized.canonicalRoot,
    normalized.manifestDigest,
    normalized.gitCommonDirectoryDigest,
    normalized.filesystemEvidenceDigest,
    normalized.provider?.provider,
    normalized.provider?.providerRepositoryId,
    normalized.provider?.remoteDigest,
  ]);
}

function authorityStatus(
  authority: CachedAuthorityEvidenceV1,
  at: string
): "usable" | "expired" | "revoked" {
  assertAuthorityVersion(authority);
  const atTime = timestamp(at, "authority verification time");
  const expiresAt = timestamp(authority.expiresAt, "authority expiresAt");
  timestamp(authority.verifiedAt, "authority verifiedAt");
  if (authority.revokedAt) {
    timestamp(authority.revokedAt, "authority revokedAt");
    return "revoked";
  }
  return expiresAt <= atTime ? "expired" : "usable";
}

function assertAuthorityUsable(authority: CachedAuthorityEvidenceV1, at: string): void {
  const status = authorityStatus(authority, at);
  if (status !== "usable") {
    throw new LocalRegistryError(
      "REGISTRY_INVALID_INPUT",
      `Cached authority is ${status} and cannot authorize a local binding lifecycle change.`
    );
  }
}

function applySchemaV1(
  db: Database.Database,
  options: InitializeLocalRegistryOptionsV1,
  appliedAt: string
): void {
  createLocalRegistrySchemaV1(db);
  insertLocalRegistryIdentity(db, {
    registry_instance_id: options.registryInstanceId,
    execution_surface_id: options.executionSurfaceId,
    surface_evidence_digest: options.executionSurface.evidenceDigest,
    native_platform: options.executionSurface.nativePlatform,
    surface_kind: options.executionSurface.kind,
    wsl_distribution:
      options.executionSurface.kind === "wsl"
        ? (options.executionSurface.wslDistribution ?? null)
        : null,
    created_at: options.createdAt ?? appliedAt,
  });
  insertLocalRegistryMigration(db, LOCAL_REGISTRY_SCHEMA_VERSION, appliedAt);
  setLocalRegistrySchemaIdentity(db, LOCAL_REGISTRY_APPLICATION_ID, LOCAL_REGISTRY_SCHEMA_VERSION);
}

function initializeSchema(
  db: Database.Database,
  options: InitializeLocalRegistryOptionsV1,
  appliedAt: string
): void {
  const tables = listLocalRegistryTableNames(db);
  const version = readLocalRegistryMigrationVersion(db);

  if (version === null) {
    if (tables.length > 0) {
      throw new LocalRegistryError(
        "REGISTRY_SCHEMA_INCOMPATIBLE",
        "Refusing to initialize a local binding registry inside an existing non-registry SQLite database."
      );
    }
    const migrate = db.transaction(() => applySchemaV1(db, options, appliedAt));
    migrate();
    return;
  }

  if (version !== LOCAL_REGISTRY_SCHEMA_VERSION) {
    throw new LocalRegistryError(
      "REGISTRY_SCHEMA_INCOMPATIBLE",
      `Local registry schema ${version} is not supported by schema ${LOCAL_REGISTRY_SCHEMA_VERSION}.`
    );
  }
}

function readIdentity(db: Database.Database): RegistryIdentityRow {
  const identity = readLocalRegistryIdentity(db);
  if (!identity) {
    throw new LocalRegistryError(
      "REGISTRY_SCHEMA_INCOMPATIBLE",
      "The local registry identity record is missing."
    );
  }
  return identity;
}

function validateSchemaAndIdentity(
  db: Database.Database,
  executionSurface: ExecutionSurfaceEvidenceV1,
  expectedRegistryInstanceId?: RegistryInstanceId,
  expectedExecutionSurfaceId?: ExecutionSurfaceId
): RegistryIdentityRow {
  const applicationId = readLocalRegistryApplicationId(db);
  const version = readLocalRegistryMigrationVersion(db);
  if (
    applicationId !== LOCAL_REGISTRY_APPLICATION_ID ||
    version !== LOCAL_REGISTRY_SCHEMA_VERSION
  ) {
    throw new LocalRegistryError(
      "REGISTRY_SCHEMA_INCOMPATIBLE",
      "The selected database is not a supported Lex local binding registry."
    );
  }

  const identity = readIdentity(db);
  if (
    identity.surface_evidence_digest !== executionSurface.evidenceDigest ||
    identity.native_platform !== executionSurface.nativePlatform ||
    identity.surface_kind !== executionSurface.kind ||
    identity.wsl_distribution !==
      (executionSurface.kind === "wsl" ? (executionSurface.wslDistribution ?? null) : null) ||
    (expectedRegistryInstanceId !== undefined &&
      identity.registry_instance_id !== expectedRegistryInstanceId) ||
    (expectedExecutionSurfaceId !== undefined &&
      identity.execution_surface_id !== expectedExecutionSurfaceId)
  ) {
    throw new LocalRegistryError(
      "REGISTRY_SURFACE_MISMATCH",
      "The local registry belongs to a different native execution surface or installation."
    );
  }
  return identity;
}

function rowEvidence(row: BindingRow): RepositoryInstanceEvidenceV1 {
  return Object.freeze({
    schemaVersion: LOCAL_BINDING_CONTRACT_VERSION,
    canonicalRoot: row.canonical_root,
    ...(row.manifest_digest ? { manifestDigest: row.manifest_digest as ContentDigest } : {}),
    ...(row.git_common_directory_digest
      ? { gitCommonDirectoryDigest: row.git_common_directory_digest as ContentDigest }
      : {}),
    ...(row.filesystem_evidence_digest
      ? { filesystemEvidenceDigest: row.filesystem_evidence_digest as ContentDigest }
      : {}),
    ...(row.provider && row.provider_repository_id
      ? {
          provider: Object.freeze({
            provider: row.provider,
            providerRepositoryId: row.provider_repository_id,
            ...(row.provider_remote_digest
              ? { remoteDigest: row.provider_remote_digest as ContentDigest }
              : {}),
          }),
        }
      : {}),
  });
}

function rowBinding(row: BindingRow): RepositoryInstanceBindingV1 {
  return Object.freeze({
    schemaVersion: LOCAL_BINDING_CONTRACT_VERSION,
    bindingId: row.binding_id as BindingId,
    registryInstanceId: row.registry_instance_id as RegistryInstanceId,
    executionSurfaceId: row.execution_surface_id as ExecutionSurfaceId,
    workspaceInstanceId:
      row.workspace_instance_id as RepositoryInstanceBindingV1["workspaceInstanceId"],
    repositoryInstanceId:
      row.repository_instance_id as RepositoryInstanceBindingV1["repositoryInstanceId"],
    tenantId: row.tenant_id as RepositoryInstanceBindingV1["tenantId"],
    workspaceId: row.workspace_id as RepositoryInstanceBindingV1["workspaceId"],
    repositoryId: row.repository_id as RepositoryInstanceBindingV1["repositoryId"],
    evidence: rowEvidence(row),
    cachedAuthority: Object.freeze({
      schemaVersion: LOCAL_BINDING_CONTRACT_VERSION,
      authoritySource: row.authority_source,
      authorityVersion: row.authority_version as CachedAuthorityEvidenceV1["authorityVersion"],
      authorityDigest: row.authority_digest as ContentDigest,
      verifiedAt: row.authority_verified_at,
      expiresAt: row.authority_expires_at,
      ...(row.authority_revoked_at ? { revokedAt: row.authority_revoked_at } : {}),
    }),
    state: row.state,
    createdAt: row.created_at,
    ...(row.last_verified_at ? { lastVerifiedAt: row.last_verified_at } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
  });
}

function eventReceipt(row: BindingEventRow): BindingLifecycleReceiptV1 {
  return Object.freeze({
    schemaVersion: LOCAL_BINDING_CONTRACT_VERSION,
    receiptId: row.receipt_id as BindingReceiptId,
    bindingId: row.binding_id as BindingId,
    registryInstanceId: row.registry_instance_id as RegistryInstanceId,
    executionSurfaceId: row.execution_surface_id as ExecutionSurfaceId,
    repositoryInstanceId:
      row.repository_instance_id as BindingLifecycleReceiptV1["repositoryInstanceId"],
    workspaceInstanceId:
      row.workspace_instance_id as BindingLifecycleReceiptV1["workspaceInstanceId"],
    evidenceDigest: row.evidence_digest as ContentDigest,
    authorityDigest: row.authority_digest as ContentDigest,
    registeredByPrincipalId: row.actor_principal_id as PrincipalId,
    createdAt: row.created_at,
    action: row.action,
    ...(row.reason ? { reason: row.reason } : {}),
  });
}

function bindingReceipt(row: BindingEventRow): BindingReceiptV1 {
  const lifecycle = eventReceipt(row);
  return Object.freeze({
    schemaVersion: lifecycle.schemaVersion,
    receiptId: lifecycle.receiptId,
    bindingId: lifecycle.bindingId,
    registryInstanceId: lifecycle.registryInstanceId,
    executionSurfaceId: lifecycle.executionSurfaceId,
    repositoryInstanceId: lifecycle.repositoryInstanceId,
    workspaceInstanceId: lifecycle.workspaceInstanceId,
    evidenceDigest: lifecycle.evidenceDigest,
    authorityDigest: lifecycle.authorityDigest,
    registeredByPrincipalId: lifecycle.registeredByPrincipalId,
    createdAt: lifecycle.createdAt,
  });
}

function sameOptional(left: string | undefined, right: string | undefined): boolean {
  return left === right;
}

function sameProvider(
  left: RepositoryInstanceEvidenceV1["provider"],
  right: RepositoryInstanceEvidenceV1["provider"]
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    left.provider === right.provider &&
    left.providerRepositoryId === right.providerRepositoryId &&
    sameOptional(left.remoteDigest, right.remoteDigest)
  );
}

function selectorMatchesBinding(
  selector: WorkspaceSelectorV1 | undefined,
  binding: RepositoryInstanceBindingV1
): boolean {
  return (
    selector === undefined ||
    !("workspaceId" in selector) ||
    selector.workspaceId === binding.workspaceId
  );
}

function candidateMatchesRequest(
  request: FindRepositoryInstancesRequestV1,
  binding: RepositoryInstanceBindingV1,
  surface: ExecutionSurfaceEvidenceV1
): boolean {
  if (!selectorMatchesBinding(request.requestedWorkspace, binding)) return false;
  const incoming = normalizeEvidence(request.evidence, surface);
  const projectRoot = normalizeRoot(request.projectRoot, surface);
  const rootMatches =
    binding.evidence.canonicalRoot === projectRoot ||
    binding.evidence.canonicalRoot === incoming.canonicalRoot;
  const declarationMatches = request.repositoryDeclaration?.repositoryId === binding.repositoryId;
  const manifestMatches =
    incoming.manifestDigest !== undefined &&
    incoming.manifestDigest === binding.evidence.manifestDigest;
  const gitMatches =
    incoming.gitCommonDirectoryDigest !== undefined &&
    incoming.gitCommonDirectoryDigest === binding.evidence.gitCommonDirectoryDigest;
  const filesystemMatches =
    incoming.filesystemEvidenceDigest !== undefined &&
    incoming.filesystemEvidenceDigest === binding.evidence.filesystemEvidenceDigest;
  const providerMatches =
    incoming.provider !== undefined && sameProvider(incoming.provider, binding.evidence.provider);

  return (
    rootMatches ||
    declarationMatches ||
    manifestMatches ||
    gitMatches ||
    filesystemMatches ||
    providerMatches
  );
}

function verificationReasons(
  binding: RepositoryInstanceBindingV1,
  declaration: RepositoryDeclarationV1 | undefined,
  incoming: RepositoryInstanceEvidenceV1,
  allowRootChange: boolean
): readonly string[] {
  const reasons: string[] = [];
  if (binding.state !== "active") reasons.push("binding-revoked");
  if (!allowRootChange && binding.evidence.canonicalRoot !== incoming.canonicalRoot) {
    reasons.push("canonical-root-mismatch");
  }
  if (declaration && declaration.repositoryId !== binding.repositoryId) {
    reasons.push("repository-declaration-mismatch");
  }
  if (!sameOptional(binding.evidence.manifestDigest, incoming.manifestDigest)) {
    reasons.push("manifest-evidence-mismatch");
  }
  if (!sameOptional(binding.evidence.gitCommonDirectoryDigest, incoming.gitCommonDirectoryDigest)) {
    reasons.push("git-common-directory-mismatch");
  }
  if (!sameOptional(binding.evidence.filesystemEvidenceDigest, incoming.filesystemEvidenceDigest)) {
    reasons.push("filesystem-evidence-mismatch");
  }
  if (!sameProvider(binding.evidence.provider, incoming.provider)) {
    reasons.push("provider-evidence-mismatch");
  }
  return Object.freeze(reasons);
}

function hasStableRebindEvidence(
  binding: RepositoryInstanceBindingV1,
  _declaration: RepositoryDeclarationV1 | undefined,
  evidence: RepositoryInstanceEvidenceV1
): boolean {
  return (
    (binding.evidence.gitCommonDirectoryDigest !== undefined &&
      binding.evidence.gitCommonDirectoryDigest === evidence.gitCommonDirectoryDigest) ||
    (binding.evidence.filesystemEvidenceDigest !== undefined &&
      binding.evidence.filesystemEvidenceDigest === evidence.filesystemEvidenceDigest) ||
    (binding.evidence.provider !== undefined &&
      sameProvider(binding.evidence.provider, evidence.provider))
  );
}

export class SqliteLocalBindingRegistry implements LocalBindingRegistry {
  readonly registryInstanceId: RegistryInstanceId;
  readonly executionSurfaceId: ExecutionSurfaceId;
  readonly executionSurface: ExecutionSurfaceEvidenceV1;
  readonly databasePath: string;
  readonly access: LocalRegistryAccessMode;

  private constructor(
    private readonly db: Database.Database,
    identity: RegistryIdentityRow,
    options: {
      databasePath: string;
      executionSurface: ExecutionSurfaceEvidenceV1;
      access: LocalRegistryAccessMode;
      now?: () => string;
      idFactory?: LocalRegistryIdFactoryV1;
    }
  ) {
    this.registryInstanceId = identity.registry_instance_id as RegistryInstanceId;
    this.executionSurfaceId = identity.execution_surface_id as ExecutionSurfaceId;
    this.executionSurface = options.executionSurface;
    this.databasePath = options.databasePath;
    this.access = options.access;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? defaultIdFactory();
  }

  private readonly now: () => string;
  private readonly idFactory: LocalRegistryIdFactoryV1;

  static initialize(options: InitializeLocalRegistryOptionsV1): SqliteLocalBindingRegistry {
    assertExecutionSurfaceVersion(options.executionSurface);
    requireNonEmpty(options.databasePath, "databasePath");
    const isMemory = options.databasePath === ":memory:";
    const existed = !isMemory && existsSync(options.databasePath);
    if (!isMemory && !existed) {
      mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
    }

    const db = openSqlite(options.databasePath);
    try {
      db.pragma("busy_timeout = 5000");
      db.pragma("foreign_keys = ON");
      const appliedAt = options.createdAt ?? options.now?.() ?? new Date().toISOString();
      timestamp(appliedAt, "registry createdAt");
      initializeSchema(db, options, appliedAt);
      const identity = validateSchemaAndIdentity(
        db,
        options.executionSurface,
        options.registryInstanceId,
        options.executionSurfaceId
      );
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = FULL");
      if (!isMemory) chmodSync(options.databasePath, 0o600);
      return new SqliteLocalBindingRegistry(db, identity, {
        databasePath: options.databasePath,
        executionSurface: options.executionSurface,
        access: "administrative",
        now: options.now,
        idFactory: options.idFactory,
      });
    } catch (error) {
      db.close();
      throw error;
    }
  }

  static open(options: OpenLocalRegistryOptionsV1): SqliteLocalBindingRegistry {
    assertExecutionSurfaceVersion(options.executionSurface);
    requireNonEmpty(options.databasePath, "databasePath");
    if (options.databasePath === ":memory:" || !existsSync(options.databasePath)) {
      throw new LocalRegistryError(
        "REGISTRY_NOT_FOUND",
        `The local binding registry does not exist: ${options.databasePath}.`
      );
    }
    const access = options.access ?? "read-only";
    const db = openSqlite(options.databasePath, {
      readonly: access === "read-only",
      fileMustExist: true,
    });
    try {
      db.pragma("busy_timeout = 5000");
      db.pragma("foreign_keys = ON");
      if (access === "read-only") db.pragma("query_only = ON");
      const identity = validateSchemaAndIdentity(
        db,
        options.executionSurface,
        options.expectedRegistryInstanceId,
        options.expectedExecutionSurfaceId
      );
      return new SqliteLocalBindingRegistry(db, identity, {
        databasePath: options.databasePath,
        executionSurface: options.executionSurface,
        access,
        now: options.now,
        idFactory: options.idFactory,
      });
    } catch (error) {
      db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  private assertAdministrative(): void {
    if (this.access !== "administrative") {
      throw new LocalRegistryError(
        "REGISTRY_READ_ONLY",
        "This local registry was opened read-only; use an explicit administrative operation."
      );
    }
  }

  private bindingRow(bindingId: BindingId): BindingRow | undefined {
    return readLocalRegistryBinding(this.db, bindingId);
  }

  private insertEvent(event: BindingEventRow): void {
    insertLocalRegistryEvent(this.db, event);
  }

  async inspectBindings(
    request: InspectBindingsRequestV1 = {}
  ): Promise<readonly RepositoryInstanceBindingV1[]> {
    const rows = listLocalRegistryBindings(
      this.db,
      request.bindingId ?? null,
      request.state ?? null
    );
    return Object.freeze(rows.map(rowBinding));
  }

  async inspectReceipts(bindingId?: BindingId): Promise<readonly BindingLifecycleReceiptV1[]> {
    const rows = listLocalRegistryEvents(this.db, bindingId ?? null);
    return Object.freeze(rows.map(eventReceipt));
  }

  async findRepositoryInstances(
    request: FindRepositoryInstancesRequestV1
  ): Promise<readonly RepositoryInstanceBindingV1[]> {
    assertEvidenceVersion(request.evidence);
    assertDeclarationVersion(request.repositoryDeclaration);
    assertRelatedRoots(request.projectRoot, request.evidence.canonicalRoot, this.executionSurface);
    const rows = listActiveLocalRegistryBindings(this.db);
    const matches = rows
      .map(rowBinding)
      .filter((binding) => candidateMatchesRequest(request, binding, this.executionSurface));
    return Object.freeze(matches);
  }

  async registerBinding(request: RegisterBindingRequestV1): Promise<BindingReceiptV1> {
    this.assertAdministrative();
    const createdAt = this.now();
    timestamp(createdAt, "binding createdAt");
    assertAuthorityUsable(request.authorityEvidence, createdAt);
    const evidence = normalizeEvidence(request.evidence, this.executionSurface);
    const evidenceDigest = computeRepositoryEvidenceDigest(evidence, this.executionSurface);
    const bindingId = this.idFactory.bindingId();
    const receiptId = this.idFactory.receiptId();
    const event: BindingEventRow = {
      receipt_id: receiptId,
      binding_id: bindingId,
      action: "register",
      registry_instance_id: this.registryInstanceId,
      execution_surface_id: this.executionSurfaceId,
      repository_instance_id: request.repositoryInstanceId,
      workspace_instance_id: request.workspaceInstanceId,
      evidence_digest: evidenceDigest,
      authority_digest: request.authorityEvidence.authorityDigest,
      actor_principal_id: request.registeredByPrincipalId,
      created_at: createdAt,
      reason: null,
    };

    const insert = this.db.transaction(() => {
      insertLocalRegistryBinding(this.db, {
        binding_id: bindingId,
        registry_instance_id: this.registryInstanceId,
        execution_surface_id: this.executionSurfaceId,
        workspace_instance_id: request.workspaceInstanceId,
        repository_instance_id: request.repositoryInstanceId,
        tenant_id: request.tenantId,
        workspace_id: request.workspaceId,
        repository_id: request.repositoryId,
        canonical_root: evidence.canonicalRoot,
        manifest_digest: evidence.manifestDigest ?? null,
        git_common_directory_digest: evidence.gitCommonDirectoryDigest ?? null,
        filesystem_evidence_digest: evidence.filesystemEvidenceDigest ?? null,
        provider: evidence.provider?.provider ?? null,
        provider_repository_id: evidence.provider?.providerRepositoryId ?? null,
        provider_remote_digest: evidence.provider?.remoteDigest ?? null,
        authority_source: request.authorityEvidence.authoritySource,
        authority_version: request.authorityEvidence.authorityVersion,
        authority_digest: request.authorityEvidence.authorityDigest,
        authority_verified_at: request.authorityEvidence.verifiedAt,
        authority_expires_at: request.authorityEvidence.expiresAt,
        authority_revoked_at: request.authorityEvidence.revokedAt ?? null,
        state: "active",
        created_at: createdAt,
        last_verified_at: request.authorityEvidence.verifiedAt,
        revoked_at: null,
        registered_by_principal_id: request.registeredByPrincipalId,
      });
      this.insertEvent(event);
    });

    try {
      insert();
    } catch (error) {
      if (error instanceof LocalRegistryError) throw error;
      throw new LocalRegistryError(
        "REGISTRY_CONFLICT",
        `The binding could not be registered: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return bindingReceipt(event);
  }

  async verifyBinding(request: VerifyBindingRequestV1): Promise<BindingVerificationV1> {
    assertBindingVersions(request.binding);
    assertDeclarationVersion(request.declaration);
    assertEvidenceVersion(request.evidence);
    assertAuthorityVersion(request.authorityEvidence);
    const verifiedAt = request.verifiedAt;
    timestamp(verifiedAt, "binding verifiedAt");
    const evidence = normalizeEvidence(request.evidence, this.executionSurface);
    const evidenceDigest = computeRepositoryEvidenceDigest(evidence, this.executionSurface);
    const authority = authorityStatus(request.authorityEvidence, verifiedAt);
    let status: BindingVerificationStatus;
    let reasons: readonly string[];

    if (authority === "expired") {
      status = "authority-expired";
      reasons = Object.freeze(["authority-cache-expired"]);
    } else if (
      authority === "revoked" ||
      (request.binding.cachedAuthority?.revokedAt !== undefined &&
        request.binding.cachedAuthority.authorityDigest ===
          request.authorityEvidence.authorityDigest)
    ) {
      status = "authority-revoked";
      reasons = Object.freeze(["authority-grant-revoked"]);
    } else if (
      request.binding.cachedAuthority &&
      (request.binding.cachedAuthority.authorityVersion !==
        request.authorityEvidence.authorityVersion ||
        request.binding.cachedAuthority.authorityDigest !==
          request.authorityEvidence.authorityDigest)
    ) {
      status = "mismatch";
      reasons = Object.freeze(["authority-cache-stale"]);
    } else if (
      request.binding.registryInstanceId !== this.registryInstanceId ||
      request.binding.executionSurfaceId !== this.executionSurfaceId
    ) {
      status = "mismatch";
      reasons = Object.freeze(["registry-surface-mismatch"]);
    } else {
      reasons = verificationReasons(request.binding, request.declaration, evidence, false);
      status = reasons.length === 0 ? "verified" : "mismatch";
    }

    return Object.freeze({
      schemaVersion: LOCAL_BINDING_CONTRACT_VERSION,
      status,
      bindingId: request.binding.bindingId,
      evidenceDigest,
      authorityDigest: request.authorityEvidence.authorityDigest,
      verifiedAt,
      reasons,
    });
  }

  async rebindBinding(request: RebindBindingRequestV1): Promise<BindingLifecycleReceiptV1> {
    this.assertAdministrative();
    assertDeclarationVersion(request.declaration);
    assertEvidenceVersion(request.evidence);
    assertAuthorityVersion(request.authorityEvidence);
    requireNonEmpty(request.reason, "rebind reason");
    timestamp(request.reboundAt, "reboundAt");
    assertAuthorityUsable(request.authorityEvidence, request.reboundAt);
    const evidence = normalizeEvidence(request.evidence, this.executionSurface);
    const evidenceDigest = computeRepositoryEvidenceDigest(evidence, this.executionSurface);
    const rebind = this.db.transaction((): BindingEventRow => {
      const row = this.bindingRow(request.bindingId);
      if (!row) {
        throw new LocalRegistryError(
          "REGISTRY_INVALID_INPUT",
          "The binding to rebind was not found."
        );
      }
      const binding = rowBinding(row);
      if (binding.state !== "active") {
        throw new LocalRegistryError("REGISTRY_CONFLICT", "A revoked binding cannot be rebound.");
      }
      if (!hasStableRebindEvidence(binding, request.declaration, evidence)) {
        throw new LocalRegistryError(
          "REGISTRY_INVALID_INPUT",
          "Rebinding requires stable provider, Git common-directory, or filesystem evidence in addition to any declaration."
        );
      }
      const continuityReasons = verificationReasons(
        binding,
        request.declaration,
        evidence,
        true
      ).filter((reason) => reason !== "manifest-evidence-mismatch");
      if (continuityReasons.length > 0) {
        throw new LocalRegistryError(
          "REGISTRY_CONFLICT",
          `Repository evidence does not preserve binding identity: ${continuityReasons.join(", ")}.`
        );
      }
      const event: BindingEventRow = {
        receipt_id: this.idFactory.receiptId(),
        binding_id: binding.bindingId,
        action: "rebind",
        registry_instance_id: this.registryInstanceId,
        execution_surface_id: this.executionSurfaceId,
        repository_instance_id: binding.repositoryInstanceId,
        workspace_instance_id: binding.workspaceInstanceId,
        evidence_digest: evidenceDigest,
        authority_digest: request.authorityEvidence.authorityDigest,
        actor_principal_id: request.reboundByPrincipalId,
        created_at: request.reboundAt,
        reason: request.reason,
      };
      const changes = updateLocalRegistryBinding(this.db, {
        binding_id: binding.bindingId,
        canonical_root: evidence.canonicalRoot,
        manifest_digest: evidence.manifestDigest ?? null,
        git_common_directory_digest: evidence.gitCommonDirectoryDigest ?? null,
        filesystem_evidence_digest: evidence.filesystemEvidenceDigest ?? null,
        provider: evidence.provider?.provider ?? null,
        provider_repository_id: evidence.provider?.providerRepositoryId ?? null,
        provider_remote_digest: evidence.provider?.remoteDigest ?? null,
        authority_source: request.authorityEvidence.authoritySource,
        authority_version: request.authorityEvidence.authorityVersion,
        authority_digest: request.authorityEvidence.authorityDigest,
        authority_verified_at: request.authorityEvidence.verifiedAt,
        authority_expires_at: request.authorityEvidence.expiresAt,
        authority_revoked_at: request.authorityEvidence.revokedAt ?? null,
        last_verified_at: request.reboundAt,
      });
      if (changes !== 1) {
        throw new LocalRegistryError(
          "REGISTRY_CONFLICT",
          "The binding changed before the rebind could be committed."
        );
      }
      this.insertEvent(event);
      return event;
    });
    try {
      return eventReceipt(rebind.immediate());
    } catch (error) {
      if (error instanceof LocalRegistryError) throw error;
      throw new LocalRegistryError(
        "REGISTRY_CONFLICT",
        `The binding could not be rebound: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async revokeBinding(request: RevokeBindingRequestV1): Promise<void> {
    this.assertAdministrative();
    requireNonEmpty(request.reason, "revocation reason");
    timestamp(request.revokedAt, "revokedAt");
    const revoke = this.db.transaction((): BindingEventRow | null => {
      const row = this.bindingRow(request.bindingId);
      if (!row) {
        throw new LocalRegistryError(
          "REGISTRY_INVALID_INPUT",
          "The binding to revoke was not found."
        );
      }
      if (row.state === "revoked") return null;
      const binding = rowBinding(row);
      const evidenceDigest = computeRepositoryEvidenceDigest(
        binding.evidence,
        this.executionSurface
      );
      const event: BindingEventRow = {
        receipt_id: this.idFactory.receiptId(),
        binding_id: binding.bindingId,
        action: "revoke",
        registry_instance_id: this.registryInstanceId,
        execution_surface_id: this.executionSurfaceId,
        repository_instance_id: binding.repositoryInstanceId,
        workspace_instance_id: binding.workspaceInstanceId,
        evidence_digest: evidenceDigest,
        authority_digest:
          binding.cachedAuthority?.authorityDigest ?? ("sha256:none" as ContentDigest),
        actor_principal_id: request.revokedByPrincipalId,
        created_at: request.revokedAt,
        reason: request.reason,
      };
      const changes = revokeLocalRegistryBinding(this.db, request.bindingId, request.revokedAt);
      if (changes !== 1) {
        throw new LocalRegistryError(
          "REGISTRY_CONFLICT",
          "The binding changed before the revocation could be committed."
        );
      }
      this.insertEvent(event);
      return event;
    });
    try {
      revoke.immediate();
    } catch (error) {
      if (error instanceof LocalRegistryError) throw error;
      throw new LocalRegistryError(
        "REGISTRY_CONFLICT",
        `The binding could not be revoked: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

export type BindingLifecycleReceipt = BindingLifecycleReceiptV1;
