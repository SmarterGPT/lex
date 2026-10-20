import { createHash } from "node:crypto";
import type { AuthorizedScopeV1, InvocationContextV1 } from "./runtime.js";
import type { ExecutionSurfaceEvidenceV1 } from "./bindings.js";
import { normalizeExecutionSurfaceIdentityPath } from "./surface.js";

/** Secret-free physical backend evidence supplied only by a trusted composition host. */
export interface VerifiedBackendIdentityV1 {
  readonly identity: string;
  readonly verifiedAt: string;
  /** Classification of the configured endpoint, not proof of physical server placement. */
  readonly connectionClass: "loopback" | "remote" | "unknown";
}

export type BackendIdentityV1 =
  | (VerifiedBackendIdentityV1 & { readonly verification: "trusted-host" })
  | {
      readonly verification: "unverified";
      readonly identity: null;
      readonly connectionClass: "unknown";
    };

export interface DestinationBackendV1 {
  readonly kind: "memory" | "sqlite" | "postgres";
  readonly identity: BackendIdentityV1;
  /** Physical store namespace (for PostgreSQL, the explicitly selected schema). */
  readonly namespace?: string;
}

/** An operation-entry snapshot, not persistent consent or an atomic revocation guarantee. */
export interface DestinationSnapshotV1 {
  readonly schemaVersion: 1;
  readonly kind: "workspace-scoped";
  /** Null when the host has not verified the physical backend. */
  readonly identity: string | null;
  readonly projectRoot: string;
  readonly backend: DestinationBackendV1;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly bindingId: string;
  readonly principalId: string;
  readonly capabilities: readonly string[];
  readonly grantId: string;
  readonly authorityVersion: string;
  readonly authorityDigest: string;
  readonly scopeVersion: string;
  readonly verifiedAt: string;
  readonly expiresAt?: string;
}

export class DestinationBindingError extends Error {
  readonly code = "LEX_DESTINATION_MISMATCH";

  constructor(message: string) {
    super(message);
    this.name = "DestinationBindingError";
  }
}

/** Do not accept connection strings, credentials, or caller-provided frame metadata here. */
export function verifiedBackendIdentity(value: VerifiedBackendIdentityV1): BackendIdentityV1 {
  if (
    !/^[a-z][a-z0-9-]*:sha256:[a-f0-9]{64}$/.test(value.identity) ||
    !Number.isFinite(Date.parse(value.verifiedAt)) ||
    new Date(value.verifiedAt).toISOString() !== value.verifiedAt ||
    !["loopback", "remote", "unknown"].includes(value.connectionClass)
  ) {
    throw new TypeError("Invalid trusted backend identity evidence.");
  }
  return Object.freeze({
    verification: "trusted-host",
    identity: value.identity,
    verifiedAt: value.verifiedAt,
    connectionClass: value.connectionClass,
  });
}

export const UNVERIFIED_BACKEND_IDENTITY: BackendIdentityV1 = Object.freeze({
  verification: "unverified",
  identity: null,
  connectionClass: "unknown",
});

/**
 * Constructed after canonical authorization; no environment or payload authority is read.
 * The optional execution surface must come from trusted bootstrap capture. Without it,
 * retain conservative raw-root comparison for existing three-argument callers.
 */
export function createDestinationSnapshot(
  invocation: InvocationContextV1,
  scope: AuthorizedScopeV1,
  backend: DestinationBackendV1,
  executionSurface?: ExecutionSurfaceEvidenceV1
): DestinationSnapshotV1 {
  const binding = invocation.binding;
  let projectRoot = invocation.projectRoot;
  let canonicalRoot = invocation.repositoryEvidence.canonicalRoot;
  let bindingRoot = binding?.evidence.canonicalRoot;
  if (executionSurface) {
    try {
      projectRoot = normalizeExecutionSurfaceIdentityPath(
        projectRoot,
        executionSurface,
        "project root"
      );
      canonicalRoot = normalizeExecutionSurfaceIdentityPath(
        canonicalRoot,
        executionSurface,
        "repository canonical root"
      );
      bindingRoot = normalizeExecutionSurfaceIdentityPath(
        bindingRoot,
        executionSurface,
        "binding canonical root"
      );
    } catch {
      throw new DestinationBindingError("A matching authorized repository binding is required.");
    }
  }

  if (
    !binding ||
    binding.state !== "active" ||
    binding.tenantId !== scope.tenantId ||
    binding.workspaceId !== scope.workspaceId ||
    bindingRoot !== canonicalRoot
  ) {
    throw new DestinationBindingError("A matching authorized repository binding is required.");
  }
  const capabilities = Object.freeze([...new Set(scope.capabilities)].sort());
  const backendIdentity =
    backend.identity.verification === "trusted-host"
      ? verifiedBackendIdentity(backend.identity)
      : UNVERIFIED_BACKEND_IDENTITY;
  const tuple = [
    "lex-destination-v1",
    backend.kind,
    backendIdentity.identity,
    backend.namespace ?? null,
    projectRoot,
    canonicalRoot,
    scope.tenantId,
    scope.workspaceId,
    binding.repositoryId,
    binding.bindingId,
    binding.repositoryInstanceId,
    binding.workspaceInstanceId,
    binding.registryInstanceId,
    binding.executionSurfaceId,
    scope.principalId,
    capabilities,
    scope.grantId,
    scope.authorityVersion,
    scope.authorityDigest,
    scope.scopeVersion,
  ];
  return Object.freeze({
    schemaVersion: 1,
    kind: "workspace-scoped",
    identity:
      backendIdentity.verification === "trusted-host"
        ? `lex-destination-v1:sha256:${createHash("sha256").update(JSON.stringify(tuple)).digest("hex")}`
        : null,
    projectRoot,
    backend: Object.freeze({
      kind: backend.kind,
      identity: backendIdentity,
      ...(backend.namespace ? { namespace: backend.namespace } : {}),
    }),
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    repositoryId: binding.repositoryId,
    bindingId: binding.bindingId,
    principalId: scope.principalId,
    capabilities,
    grantId: scope.grantId,
    authorityVersion: scope.authorityVersion,
    authorityDigest: scope.authorityDigest,
    scopeVersion: scope.scopeVersion,
    verifiedAt: scope.verifiedAt,
    ...(scope.expiresAt ? { expiresAt: scope.expiresAt } : {}),
  });
}

/** An expected identity restricts a write; it never supplies or broadens authorization. */
export function assertExpectedDestination(
  snapshot: DestinationSnapshotV1 | undefined,
  expected: unknown,
  now = new Date()
): void {
  if (
    snapshot?.expiresAt &&
    (!Number.isFinite(Date.parse(snapshot.expiresAt)) ||
      Date.parse(snapshot.expiresAt) <= now.getTime())
  ) {
    throw new DestinationBindingError("The authorized destination snapshot has expired.");
  }
  if (expected === undefined) return;
  if (
    typeof expected !== "string" ||
    !/^lex-destination-v1:sha256:[a-f0-9]{64}$/.test(expected) ||
    !snapshot?.identity ||
    snapshot.backend.identity.verification !== "trusted-host" ||
    snapshot.identity !== expected
  ) {
    throw new DestinationBindingError(
      "Expected destination does not match a verified authorized destination."
    );
  }
}
