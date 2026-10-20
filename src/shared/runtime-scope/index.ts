export type {
  TenantId,
  PrincipalId,
  WorkspaceId,
  WorkspaceInstanceId,
  RepositoryId,
  RepositoryInstanceId,
  RuntimeId,
  ExecutionSurfaceId,
  RegistryInstanceId,
  BindingId,
  BindingReceiptId,
  AuthorityGrantId,
  TraceId,
  TenantSlug,
  WorkspaceSlug,
  RepositorySlug,
  CapabilityId,
  ContentDigest,
  AuthorityVersion,
  ScopeVersion,
  AuthenticationRef,
  SecretHandleRef,
} from "./ids.js";

export {
  AUTHORITY_DIRECTORY_CONTRACT_VERSION,
  type CanonicalRecordState,
  type PrincipalIdentityV1,
  type TenantRecordV1,
  type WorkspaceRecordV1,
  type RepositoryRecordV1,
  type TenantSelectorV1,
  type WorkspaceSelectorV1,
  type RepositorySelectorV1,
  type PrincipalResolutionRequestV1,
  type WorkspaceAuthorizationRequestV1,
  type RepositoryAuthorizationRequestV1,
  type AuthorizedWorkspaceGrantV1,
  type WorkspaceAuthorizationDenialReason,
  type WorkspaceAuthorizationDecisionV1,
  type AuthorityDirectory,
  type RepositoryScopedAuthorityDirectory,
  type ConsistentAuthorityDirectory,
  isRepositoryScopedAuthorityDirectory,
  isConsistentAuthorityDirectory,
  type PrincipalIdentity,
  type TenantRecord,
  type WorkspaceRecord,
  type RepositoryRecord,
  type AuthorizedWorkspaceGrant,
} from "./authority.js";

export {
  LOCAL_BINDING_CONTRACT_VERSION,
  type NativePlatform,
  type ExecutionSurfaceKind,
  type LaunchOrigin,
  type ExecutionSurfaceEvidenceV1,
  type RuntimeSurfaceIdentityV1,
  type PreferredWorkspaceHintV1,
  type RepositoryDeclarationV1,
  type ProviderRepositoryEvidenceV1,
  type RepositoryInstanceEvidenceV1,
  type CachedAuthorityEvidenceV1,
  type LocalBindingState,
  type RepositoryInstanceBindingV1,
  type FindRepositoryInstancesRequestV1,
  type RegisterBindingRequestV1,
  type BindingReceiptV1,
  type VerifyBindingRequestV1,
  type BindingVerificationStatus,
  type BindingVerificationV1,
  type RevokeBindingRequestV1,
  type LocalBindingRegistry,
  type RuntimeSurfaceIdentity,
  type RepositoryDeclaration,
  type RepositoryInstanceEvidence,
  type CachedAuthorityEvidence,
  type RepositoryInstanceBinding,
  type BindingReceipt,
  type BindingVerification,
} from "./bindings.js";

export {
  RUNTIME_SCOPE_CONTRACT_VERSION,
  type ConfigurationSourceKind,
  type ConfigurationSourceEvidenceV1,
  type StoreBackendConfigurationV1,
  type ModuleRefV1,
  type ResolvedRuntimeConfigV1,
  type SourceRevisionEvidenceV1,
  type InvocationContextV1,
  type AuthorizedScopeV1,
  type ResolvedRuntimeConfig,
  type InvocationContext,
  type AuthorizedScope,
} from "./runtime.js";

export {
  DIAGNOSTIC_CONTRACT_VERSION,
  type DiagnosticLevel,
  type DiagnosticSection,
  type DiagnosticRequestV1,
  type DiagnosticJsonValue,
  type DiagnosticDecisionV1,
  type DiagnosticWarningV1,
  type DiagnosticRedactionV1,
  type RedactedConfigurationDiagnosticV1,
  type RedactedAuthorityDiagnosticV1,
  type BindingDiagnosticV1,
  type SelectionDiagnosticV1,
  type ProjectionDiagnosticV1,
  type DiagnosticEnvelopeV1,
  type DiagnosticRequest,
  type DiagnosticEnvelope,
} from "./diagnostics.js";

export {
  RUNTIME_SCOPE_CONFORMANCE_VERSION,
  RUNTIME_SCOPE_CONFORMANCE_FIXTURES,
  type RuntimeScopeConformanceFixtureId,
  type ConformanceCanonicalIdentityV1,
  type ConformanceLocalIdentityV1,
  type ConformanceSurfaceV1,
  type ConformanceResolutionResult,
  type ConformanceIdentityRelation,
  type RuntimeScopeConformanceExpectationV1,
  type RuntimeScopeConformanceFixtureV1,
} from "./conformance.js";

export {
  RUNTIME_SCOPE_IMPLEMENTATION_VERSION,
  nativePlatformFromNode,
  normalizeExecutionSurfaceIdentityPath,
  detectExecutionSurface,
  resolveLocalRegistryLocation,
  type BootstrapInputSnapshotV1,
  type ExecutionSurfaceDetectionInputV1,
  type RegistryLocationSource,
  type RegistryLocationInputV1,
  type ResolvedRegistryLocationV1,
  type BootstrapInputSnapshot,
  type ResolvedRegistryLocation,
} from "./surface.js";

export {
  LOCAL_REGISTRY_SCHEMA_VERSION,
  LOCAL_REGISTRY_APPLICATION_ID,
  LocalRegistryError,
  SqliteLocalBindingRegistry,
  computeRepositoryEvidenceDigest,
  type LocalRegistryAccessMode,
  type LocalRegistryErrorCode,
  type LocalRegistryIdFactoryV1,
  type InitializeLocalRegistryOptionsV1,
  type OpenLocalRegistryOptionsV1,
  type InspectBindingsRequestV1,
  type RebindBindingRequestV1,
  type BindingLifecycleAction,
  type BindingLifecycleReceiptV1,
  type BindingLifecycleReceipt,
} from "./registry.js";

export {
  InMemoryAuthorityDirectory,
  type InMemoryAuthenticationBindingV1,
  type InMemoryAuthorityGrantV1,
  type InMemoryAuthoritySeedV1,
} from "./in-memory-authority.js";

export {
  PostgresAuthorityDirectory,
  computeAuthenticationRefDigest,
  type PostgresAuthorityDirectoryOptionsV1,
} from "./postgres-authority.js";

export { createPostgresSchemaTarget, type PostgresSchemaTargetV1 } from "./postgres-schema.js";

export {
  POSTGRES_AUTHORITY_SCHEMA_VERSION,
  POSTGRES_AUTHORITY_TABLES,
  postgresAuthorityMigrationSql,
} from "./postgres-authority-migrations.js";

export {
  POSTGRES_AUTHORITY_ADMIN_CONTRACT_VERSION,
  PostgresAuthorityAdministration,
  type AuthorityPrincipalSeedV1,
  type AuthorityAuthenticationSeedV1,
  type AuthorityTenantSeedV1,
  type AuthorityWorkspaceSeedV1,
  type AuthorityRepositorySeedV1,
  type AuthorityWorkspaceRepositorySeedV1,
  type AuthorityTenantMembershipSeedV1,
  type AuthorityWorkspaceGrantSeedV1,
  type PostgresAuthorityTopologyV1,
  type PostgresAuthorityMigrationReceiptV1,
  type PostgresAuthoritySeedReceiptV1,
  type PostgresAuthorityInspectionV1,
  type PostgresAuthorityAdministrationV1,
  type PostgresAuthorityAdministrationOptionsV1,
} from "./postgres-authority-admin.js";

export {
  createLex3DogfoodAuthorityTopology,
  LEX3_DOGFOOD_CANONICAL_IDS,
} from "./dogfood-topology.js";

export {
  createPostgresTrustedRuntimeHost,
  type TrustedCanonicalFrameStoreBinderV1,
  type TrustedCanonicalScopedStoreV1,
  type PostgresTrustedRuntimeHostOptionsV1,
  type PostgresTrustedRuntimeHostV1,
} from "./trusted-postgres-host.js";

export {
  resolveRuntimeScope,
  runtimeScopeFailureFromRegistryError,
  type RuntimeScopeResolutionRequestV1,
  type RuntimeScopeResolverDependenciesV1,
  type RuntimeScopeResolutionErrorV1,
  type RuntimeScopeResolutionResultV1,
  type RuntimeScopeResolutionRequest,
  type RuntimeScopeResolutionResult,
} from "./resolver.js";

export {
  TRUSTED_RUNTIME_BOOTSTRAP_VERSION,
  RUNTIME_DIAGNOSTIC_CAPABILITY,
  RUNTIME_SCOPE_COMPATIBILITY_ENVIRONMENT,
  captureTrustedBootstrapInput,
  registryLocationFromBootstrap,
  createTrustedRuntimeScopeBootstrap,
  createTrustedRuntimeScopeEntrypointGuard,
  authorizeTrustedRuntimeEntrypoint,
  type TrustedRuntimeEntrypoint,
  type RuntimeAuthorityMode,
  type TrustedProcessCaptureV1,
  type RuntimeScopeDiscoveryV1,
  type RuntimeScopeDiscoveryAdapterV1,
  type RuntimeScopeRegistryHandleV1,
  type RuntimeScopeRegistryFactoryV1,
  type TrustedRuntimeScopeBootstrapDependenciesV1,
  type TrustedRuntimeScopeBootstrapRequestV1,
  type TrustedRuntimeScopeBootstrapResultV1,
  type TrustedRuntimeScopeBootstrapV1,
  type TrustedRuntimeScopeInvocationRequestV1,
  type TrustedRuntimeScopeEntrypointGuardV1,
  type TrustedRuntimeScopeEntrypointGuardOptionsV1,
} from "./bootstrap.js";

export {
  WORKSPACE_AUTHORITY_ERROR_CODES,
  type WorkspaceAuthorityErrorCode,
} from "../errors/error-codes.js";

export {
  RUNTIME_OPERATION_CAPABILITIES,
  MCP_TOOL_ALIASES,
  TRUSTED_CLI_OPERATIONS,
  TRUSTED_CLI_CONTROL_OPERATIONS,
  CANONICAL_MCP_TOOLS,
  UnknownTrustedOperationError,
  trustedCliOperationFromArgv,
  capabilitiesForCliOperation,
  capabilitiesForCliInvocation,
  canonicalMcpToolName,
  capabilitiesForMcpTool,
  type CanonicalMcpTool,
  type TrustedCliOperation,
} from "./capabilities.js";

export {
  REPOSITORY_DECLARATION_FILE,
  NodeNativeGitEvidenceProvider,
  NodeRuntimeScopeDiscoveryAdapter,
  type TrustedRuntimeSelectionV1,
  type TrustedRuntimeSelectionProviderV1,
  type NativeGitEvidenceV1,
  type NativeGitEvidenceProviderV1,
  type NodeRuntimeScopeDiscoveryOptionsV1,
} from "./discovery.js";

export {
  WORKSPACE_ADMIN_CONTRACT_VERSION,
  WorkspaceBindingAdminService,
  type WorkspaceAdminInvocationV1,
  type WorkspaceBindRequestV1,
  type WorkspaceBindingReferenceRequestV1,
  type WorkspaceBindingInspectionV1,
  type WorkspaceRegistryRecoveryV1,
  type WorkspaceBindingAdminServiceV1,
  type WorkspaceBindingAdminDependenciesV1,
} from "./workspace-admin.js";

export {
  verifiedBackendIdentity,
  UNVERIFIED_BACKEND_IDENTITY,
  createDestinationSnapshot,
  assertExpectedDestination,
  DestinationBindingError,
  type VerifiedBackendIdentityV1,
  type BackendIdentityV1,
  type DestinationBackendV1,
  type DestinationSnapshotV1,
} from "./destination.js";
