import { getLogger } from "@smartergpt/lex/logger";
import {
  createFrameStore,
  scopedFrameStoreAsLegacyView,
  SCOPED_FRAME_STORE_ERROR_CODES,
  ScopedFrameStoreError,
  SqliteFrameStore,
  type ScopedFrameStore,
  type ScopedFrameStoreBinder,
} from "../store/index.js";
import type { FrameStore, FrameSearchCriteria } from "../store/frame-store.js";
// @ts-ignore - importing from compiled dist directories
import { ImageManager } from "../store/images.js";
// @ts-ignore - importing from compiled dist directories
import type { Frame } from "../frames/types.js";
import { MCP_TOOLS, type MCPTool } from "./tools.js";
import { MCPError, MCPErrorCode, MCP_ERROR_METADATA, createModuleIdError } from "./errors.js";
import { IdempotencyCache } from "./idempotency.js";
// @ts-ignore - importing from compiled dist directories
import {
  generateAtlasFrame,
  generateAtlasFrameFromPolicy,
  formatAtlasFrame,
} from "../../shared/atlas/atlas-frame.js";
// @ts-ignore - importing from compiled dist directories
import { validateModuleIds } from "../../shared/module_ids/validator.js";
// @ts-ignore - importing from compiled dist directories
import type { ModuleIdError } from "../../shared/types/validation.js";
// @ts-ignore - importing from compiled dist directories
import {
  loadPolicy,
  loadPolicySnapshot,
  resolvePolicyPath,
  type PolicyPathResolution,
} from "../../shared/policy/loader.js";
// @ts-ignore - importing from compiled dist directories
import type { Policy } from "../../shared/types/policy.js";
// @ts-ignore - importing from compiled dist directories
import { getCurrentBranch } from "../../shared/git/branch.js";
import {
  canonicalizeContainedPath,
  readContainedFile,
  resolveConfigResolution,
  type ConfigResolution,
} from "../../shared/config/index.js";
import { alternateStoreWarning, resolveStoreIdentity } from "../../shared/config/store-identity.js";
// @ts-ignore - importing from compiled dist directories
import { validatePolicySchema } from "../../shared/policy/schema.js";
import { randomUUID } from "crypto";
import { join, dirname, isAbsolute, resolve } from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { AXErrorException, isAXErrorException } from "../../shared/errors/ax-error.js";
// @ts-ignore - importing from compiled dist directories
import { codeAtlas } from "../../shared/cli/code-atlas.js";
// @ts-ignore - importing from compiled dist directories
import {
  buildTimeline,
  filterTimeline,
  renderTimelineText,
  renderModuleScopeEvolution,
  renderBlockerTracking,
  renderTimelineJSON,
  type TimelineOptions,
} from "../renderer/timeline.js";
// @ts-ignore - importing from compiled dist directories
import { compactFrame, compactFrameList } from "../renderer/compact.js";
import {
  DIAGNOSTIC_CONTRACT_VERSION,
  CANONICAL_MCP_TOOLS,
  MCP_TOOL_ALIASES,
  authorizeTrustedRuntimeEntrypoint,
  capabilitiesForMcpTool,
  canonicalMcpToolName,
  type DiagnosticEnvelopeV1,
  type DiagnosticRequestV1,
  type CapabilityId,
  type InvocationContextV1,
  type TrustedRuntimeScopeBootstrapResultV1,
  type TrustedRuntimeScopeEntrypointGuardV1,
} from "../../shared/runtime-scope/index.js";
import {
  buildFrameWriteContract,
  createFallbackModuleAttribution,
  UNSCOPED_MODULE_ID,
  type FrameWriteContract,
  type ModuleAttribution,
} from "../../shared/cli/frame-write-contract.js";

const logger = getLogger("memory:mcp_server:server");

// Read package version once at module load
// From dist/memory/mcp_server/server.js, package.json is at ../../../package.json
const __mcpServerDir = dirname(fileURLToPath(import.meta.url));
function getPackageVersion(): string {
  try {
    const pkgPath = join(__mcpServerDir, "..", "..", "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Maximum number of frames to fetch when filtering by jira/branch/module.
 * This is a performance safeguard - the FrameStore interface doesn't have
 * specific jira/branch filter methods, so we fetch a batch and filter in JS.
 * Increase this value if you have very large frame stores.
 */
const MAX_FILTER_FETCH_LIMIT = 1000;
const SCOPE_HEALTH_PAGE_SIZE = 500;
const SCOPE_HEALTH_SUMMARY_LIMIT = 10;
const MCP_FRAME_REQUIRED_FIELDS = [
  "reference_point",
  "summary_caption",
  "status_snapshot",
  "module_scope",
] as const;
const MCP_FRAME_RECOMMENDED_FIELDS = ["branch", "jira", "keywords"] as const;

interface MCPFrameWriteContract {
  requiredFields: readonly string[];
  recommendedFields: readonly string[];
  policy: FrameWriteContract["policy"];
  inference: {
    available: boolean;
    mode: "suggestions-only";
  };
  fallback: {
    available: true;
    moduleId: typeof UNSCOPED_MODULE_ID;
    input: {
      module_scope: [typeof UNSCOPED_MODULE_ID];
    };
  };
  suggestions: FrameWriteContract["suggestions"];
}

interface ScopeHealth {
  policy: {
    state: "loaded" | "unavailable";
    source: string;
    path: string | null;
    moduleCount: number;
  };
  frames: {
    state: "available" | "unavailable";
    unscopedCount: number;
    drift: {
      state: "evaluated" | "not-evaluated";
      frameCount: number;
      moduleIdCount: number;
      modules: Array<{ moduleId: string; frameCount: number }>;
      summaryLimit: number;
      truncated: boolean;
    };
  };
}

function toMCPFrameWriteContract(contract: FrameWriteContract): MCPFrameWriteContract {
  return {
    requiredFields: MCP_FRAME_REQUIRED_FIELDS,
    recommendedFields: MCP_FRAME_RECOMMENDED_FIELDS,
    policy: contract.policy,
    inference: {
      available: contract.inference.available,
      mode: "suggestions-only",
    },
    fallback: {
      available: true,
      moduleId: contract.fallback.moduleId,
      input: {
        module_scope: [contract.fallback.moduleId],
      },
    },
    suggestions: contract.suggestions,
  };
}

function isCanonicalUnscopedScope(moduleScope: unknown): moduleScope is string[] {
  return (
    Array.isArray(moduleScope) && moduleScope.length === 1 && moduleScope[0] === UNSCOPED_MODULE_ID
  );
}

function fallbackRemediation(): {
  message: string;
  input: { module_scope: [typeof UNSCOPED_MODULE_ID] };
} {
  return {
    message: `Use the canonical fallback exactly as shown when no policy-backed module applies: {"module_scope":["${UNSCOPED_MODULE_ID}"]}`,
    input: {
      module_scope: [UNSCOPED_MODULE_ID],
    },
  };
}

interface RememberArgs {
  reference_point: string;
  summary_caption: string;
  status_snapshot: {
    next_action: string;
    blockers?: string[];
    merge_blockers?: string[];
    tests_failing?: string[];
  };
  module_scope: string[];
  branch?: string;
  jira?: string;
  keywords?: string[];
  atlas_frame_id?: string;
  images?: { data: string; mime_type: string }[];
  request_id?: string;
}

interface RecallArgs {
  reference_point?: string;
  jira?: string;
  branch?: string;
  limit?: number;
  format?: "full" | "compact";
  mode?: "all" | "any";
}

interface GetFrameArgs {
  frame_id: string;
  include_atlas?: boolean;
  format?: "full" | "compact";
}

interface ListFramesArgs {
  branch?: string;
  module?: string;
  limit?: number;
  since?: string;
  cursor?: string;
  format?: "full" | "compact";
}

interface PolicyCheckArgs {
  path?: string;
  policyPath?: string;
  strict?: boolean;
}

interface TimelineArgs {
  ticketOrBranch: string;
  since?: string;
  until?: string;
  format?: "text" | "json" | "compact";
}

interface CodeAtlasArgs {
  path?: string;
  foldRadius?: number;
  maxTokens?: number;
}

interface IntrospectArgs {
  format?: "full" | "compact";
}

interface GetHintsArgs {
  hintIds: string[];
}

export interface MCPRequest {
  method: string;
  params?: unknown;
}

export interface MCPResponse {
  protocolVersion?: string;
  capabilities?: unknown;
  serverInfo?: {
    name: string;
    version: string;
  };
  tools?: unknown[];
  content?: unknown[];
  error?: {
    message: string;
    code: string;
    context?: Record<string, unknown>; // Structured context (from AXError or MCPError metadata)
    nextActions?: string[]; // Recovery suggestions (from AXError)
  };
  // Structured data for tool responses (e.g., frame_id from remember)
  data?: Record<string, unknown>;
}

export interface ToolCallParams {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Options for creating an MCPServer instance.
 */
export interface MCPServerOptions {
  /**
   * FrameStore instance to use for frame persistence.
   * If not provided, uses the shared LEX_STORE-aware FrameStore factory.
   */
  frameStore?: FrameStore;
  /** Database path. Only used if frameStore is not provided. */
  dbPath?: string;
  /** Repository root path for policy resolution. */
  repoRoot?: string;
  /** Optional fail-closed trusted scope guard shared with the CLI entrypoint. */
  runtimeScope?: MCPRuntimeScopeGuardV1;
  /** Bind the authorized scope into a request-local store before tool dispatch. */
  frameStoreBinder?: ScopedFrameStoreBinder;
}

export interface MCPRuntimeScopeGuardV1 extends TrustedRuntimeScopeEntrypointGuardV1 {}

interface MCPDispatchWorkspaceContext {
  readonly trusted: boolean;
  readonly projectRoot: string | null;
  readonly policy: Policy | null;
  readonly policyResolution: PolicyPathResolution | null;
  readonly configResolution: ConfigResolution;
  readonly sourceRevision?: InvocationContextV1["sourceRevision"];
}

function requireDispatchFrameStore(store: FrameStore | undefined): FrameStore {
  if (!store) {
    throw new ScopedFrameStoreError(
      SCOPED_FRAME_STORE_ERROR_CODES.INVALID_SCOPE,
      "No scope-bound FrameStore is available for this tool call."
    );
  }
  return store;
}

function trustedToolProperties(tool: MCPTool): Record<string, unknown> {
  const properties = { ...tool.inputSchema.properties };
  if (tool.name === "frame_create" || tool.name === "frame_validate") {
    delete properties.images;
  }
  return properties;
}

function hasTrustedAttachmentInput(
  canonicalName: string,
  args: Readonly<Record<string, unknown>>
): boolean {
  return (
    (canonicalName === "frame_create" || canonicalName === "frame_validate") &&
    (Object.hasOwn(args, "images") || Object.hasOwn(args, "image_ids"))
  );
}

/**
 * MCP Server - handles protocol requests
 */
export class MCPServer {
  private frameStore: FrameStore | undefined;
  private imageManager: ImageManager | null;
  private policy: Policy | null; // Cached policy for validation (null if not available)
  private repoRoot: string | null; // Repository root path
  private policyResolution: PolicyPathResolution | null;
  private dbPathSource = "scope-bound";
  private configResolution: ConfigResolution | null;
  private idempotencyCache: IdempotencyCache; // Idempotency cache for mutation tools
  private readonly runtimeScope: MCPRuntimeScopeGuardV1 | undefined;
  private readonly frameStoreBinder: ScopedFrameStoreBinder | undefined;

  /**
   * Create a new MCPServer instance.
   *
   * Supports two construction patterns:
   * 1. Legacy: MCPServer(dbPath: string, repoRoot?: string) - creates SqliteFrameStore internally
   * 2. DI: MCPServer(options: MCPServerOptions) - uses provided FrameStore for testing/swapping
   *
   * @param dbPathOrOptions - Either a database path string (legacy) or MCPServerOptions object
   * @param repoRoot - Repository root path (only used with legacy constructor)
   */
  constructor(dbPathOrOptions: string | MCPServerOptions, repoRoot?: string) {
    // Handle both legacy (dbPath, repoRoot) and new (options object) signatures
    let options: MCPServerOptions;
    if (typeof dbPathOrOptions === "string") {
      // Legacy constructor: MCPServer(dbPath, repoRoot)
      options = { dbPath: dbPathOrOptions, repoRoot };
    } else {
      // New constructor: MCPServer(options)
      options = dbPathOrOptions;
    }

    this.repoRoot = options.repoRoot || null;
    this.runtimeScope = options.runtimeScope;
    this.frameStoreBinder = options.frameStoreBinder;
    this.configResolution = this.runtimeScope
      ? null
      : resolveConfigResolution({
          startPath: process.cwd(),
          explicitRoot: this.repoRoot,
        });

    // Create or use provided FrameStore
    if (options.frameStore) {
      this.frameStore = options.frameStore;
      this.dbPathSource = "frameStore";
    } else if (options.dbPath) {
      this.frameStore = createFrameStore(options.dbPath);
      this.dbPathSource =
        this.frameStore.getMetadata().backend === "postgres"
          ? "env:LEX_DATABASE_URL"
          : this.configResolution &&
              resolve(this.configResolution.config.paths.database) === resolve(options.dbPath)
            ? this.configResolution.pathSources.database
            : "constructor.dbPath";
    } else if (!this.runtimeScope) {
      if (!this.configResolution) {
        throw new Error("Legacy MCP configuration resolution is unavailable.");
      }
      this.frameStore = createFrameStore(this.configResolution.config.paths.database);
      this.dbPathSource =
        this.frameStore.getMetadata().backend === "postgres"
          ? "env:LEX_DATABASE_URL"
          : this.configResolution.pathSources.database;
    }

    // ImageManager requires raw SQLite access — only available with SqliteFrameStore
    if (this.frameStore instanceof SqliteFrameStore) {
      this.imageManager = new ImageManager((this.frameStore as SqliteFrameStore).db);
    } else {
      this.imageManager = null;
    }

    this.policyResolution = null;

    // Initialize idempotency cache (24 hour TTL by default)
    this.idempotencyCache = new IdempotencyCache();

    this.policy = null;
    if (!this.runtimeScope) {
      // Legacy unscoped servers retain their process-oriented, eager policy snapshot.
      try {
        this.policyResolution = resolvePolicyPath(undefined, {
          startPath: process.cwd(),
          workspaceRootOverride: this.repoRoot,
        });

        this.policy = this.policyResolution.path ? loadPolicy(this.policyResolution.path) : null;
      } catch (error: unknown) {
        if (process.env.LEX_DEBUG) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`[LEX] Policy not available: ${errorMessage}`);
          logger.error(`[LEX] Operating without policy enforcement`);
        }
        this.policy = null;
      }
    }
  }

  private legacyDispatchContext(): MCPDispatchWorkspaceContext {
    if (!this.configResolution) {
      throw new MCPError(
        MCPErrorCode.INTERNAL_ERROR,
        "Legacy MCP dispatch is missing its process configuration snapshot."
      );
    }
    return {
      trusted: false,
      projectRoot: this.repoRoot,
      policy: this.policy,
      policyResolution: this.policyResolution,
      configResolution: this.configResolution,
    };
  }

  private trustedDispatchContext(
    invocationContext: InvocationContextV1
  ): MCPDispatchWorkspaceContext {
    const projectRoot = invocationContext.projectRoot;
    if (!isAbsolute(projectRoot)) {
      throw new MCPError(
        MCPErrorCode.POLICY_INVALID,
        "Trusted workspace projectRoot must be absolute before MCP dispatch."
      );
    }
    let normalizedRoot: string;
    try {
      normalizedRoot = canonicalizeContainedPath(projectRoot, projectRoot);
    } catch (error) {
      throw new MCPError(
        MCPErrorCode.POLICY_INVALID,
        `Trusted workspace projectRoot could not be canonicalized: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    let configResolution: ConfigResolution;
    try {
      configResolution = resolveConfigResolution({
        trustedBoundary: {
          projectRoot: normalizedRoot,
          capturedAt: this.runtimeScope?.request.bootstrap.capturedAt ?? "",
          branch: invocationContext.sourceRevision?.branch ?? "",
          commit: invocationContext.sourceRevision?.commitSha ?? "",
        },
      });
    } catch (error) {
      throw new MCPError(
        MCPErrorCode.POLICY_INVALID,
        `Trusted workspace configuration could not be resolved: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (resolve(configResolution.workspaceRoot.path) !== normalizedRoot) {
      throw new MCPError(
        MCPErrorCode.POLICY_INVALID,
        "Trusted workspace configuration resolved for a different project root."
      );
    }

    const configuredPolicyPath =
      configResolution.pathSources.policy === "file:.lex.config.json"
        ? configResolution.config.paths.policy
        : undefined;
    const unresolvedPolicyResolution = configuredPolicyPath
      ? resolvePolicyPath(configuredPolicyPath, { includeEnvironmentOverride: false })
      : resolvePolicyPath(undefined, {
          startPath: normalizedRoot,
          workspaceRootOverride: normalizedRoot,
          includeEnvironmentOverride: false,
        });

    if (
      unresolvedPolicyResolution.workspaceRoot &&
      resolve(unresolvedPolicyResolution.workspaceRoot.path) !== normalizedRoot
    ) {
      throw new MCPError(
        MCPErrorCode.POLICY_INVALID,
        "Trusted policy resolution escaped the authorized project root."
      );
    }
    let policy: Policy | null = null;
    let policyPath: string | null = null;
    if (unresolvedPolicyResolution.path) {
      try {
        const snapshot = readContainedFile(normalizedRoot, unresolvedPolicyResolution.path);
        policyPath = snapshot.canonicalPath;
        policy = loadPolicySnapshot(snapshot.content, snapshot.canonicalPath);
      } catch (error) {
        if (isAXErrorException(error)) {
          throw new MCPError(
            error.axError.code === "POLICY_NOT_FOUND"
              ? MCPErrorCode.POLICY_NOT_FOUND
              : MCPErrorCode.POLICY_INVALID,
            error.axError.message
          );
        }
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new MCPError(
            MCPErrorCode.POLICY_NOT_FOUND,
            "Configured trusted workspace policy was not found."
          );
        }
        throw new MCPError(
          MCPErrorCode.POLICY_INVALID,
          `Trusted workspace policy snapshot could not be loaded: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    const policyResolution: PolicyPathResolution = {
      ...unresolvedPolicyResolution,
      path: policyPath,
    };

    return {
      trusted: true,
      projectRoot: normalizedRoot,
      policy,
      policyResolution,
      configResolution,
      ...(invocationContext.sourceRevision
        ? { sourceRevision: invocationContext.sourceRevision }
        : {}),
    };
  }

  private atlasFrameForContext(moduleScope: string[], context: MCPDispatchWorkspaceContext) {
    if (context.trusted) {
      if (!context.policy) {
        throw new MCPError(
          MCPErrorCode.POLICY_NOT_FOUND,
          "Policy Neighborhood enrichment is unavailable because this workspace has no policy."
        );
      }
      return generateAtlasFrameFromPolicy(moduleScope, context.policy);
    }
    return generateAtlasFrame(moduleScope);
  }

  private trustedIdempotencyNamespace(
    resolution: Extract<TrustedRuntimeScopeBootstrapResultV1, { readonly resolved: true }>,
    context: MCPDispatchWorkspaceContext
  ): string {
    const { authorizedScope, invocationContext } = resolution;
    return JSON.stringify([
      "trusted-mcp-idempotency-v1",
      authorizedScope.tenantId,
      authorizedScope.workspaceId,
      authorizedScope.principalId,
      invocationContext.binding?.bindingId ?? null,
      invocationContext.binding?.repositoryId ?? null,
      invocationContext.binding?.repositoryInstanceId ?? null,
      invocationContext.repositoryEvidence.canonicalRoot,
      context.projectRoot,
    ]);
  }

  /**
   * Handle incoming MCP request
   */
  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    const { method, params } = request;

    try {
      switch (method) {
        case "initialize":
          return this.handleInitialize();

        case "tools/list":
          return this.handleToolsList();

        case "tools/call":
          return await this.handleToolsCall(params as ToolCallParams);

        default:
          throw new MCPError(MCPErrorCode.INTERNAL_UNKNOWN_METHOD, `Unknown method: ${method}`);
      }
    } catch (error: unknown) {
      // Handle MCPError with structured response
      if (error instanceof MCPError) {
        return {
          error: {
            code: error.code,
            message: error.message,
            context: error.metadata, // Map metadata to context for consistency
          },
        };
      }

      // Handle AXErrorException with structured response
      if (isAXErrorException(error)) {
        return {
          error: {
            code: error.axError.code,
            message: error.axError.message,
            context: error.axError.context,
            nextActions: error.axError.nextActions,
          },
        };
      }

      // Handle generic errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        error: {
          message: errorMessage,
          code: MCPErrorCode.INTERNAL_ERROR,
        },
      };
    }
  }

  /**
   * Handle initialize request (MCP protocol handshake)
   */
  private handleInitialize(): MCPResponse {
    return {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: "lex-mcp",
        version: getPackageVersion(),
      },
    };
  }

  /**
   * Handle tools/list request
   * Returns tools sorted by name for deterministic ordering
   */
  private handleToolsList(): MCPResponse {
    const tools = this.runtimeScope
      ? MCP_TOOLS.map((tool) => ({
          ...tool,
          inputSchema: {
            ...tool.inputSchema,
            properties: {
              ...trustedToolProperties(tool),
              diagnostics: {
                type: "string",
                enum: ["summary", "full"],
                description:
                  "Opt-in redacted runtime-scope diagnostics. Full detail requires runtime:diagnose authority.",
              },
            },
          },
        }))
      : [...MCP_TOOLS];
    return {
      tools: tools.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /**
   * Handle tools/call request
   */
  private async handleToolsCall(params: ToolCallParams): Promise<MCPResponse> {
    let requestedCapabilities: readonly CapabilityId[];
    try {
      requestedCapabilities = capabilitiesForMcpTool(params.name);
    } catch {
      return {
        error: {
          code: MCPErrorCode.INTERNAL_UNKNOWN_TOOL,
          message: `Unknown tool: ${params.name}`,
          context: {
            requestedTool: params.name,
            availableTools: [...CANONICAL_MCP_TOOLS],
          },
        },
      };
    }
    if (
      requestedCapabilities.some((capability) => capability.startsWith("frame:")) &&
      this.runtimeScope &&
      !this.frameStoreBinder
    ) {
      return {
        error: {
          code: SCOPED_FRAME_STORE_ERROR_CODES.INVALID_SCOPE,
          message: "Trusted runtime scope is configured without a scope-bound FrameStore.",
        },
      };
    }
    let diagnostics: DiagnosticEnvelopeV1 | undefined;
    let authorizedRuntimeScope:
      Extract<TrustedRuntimeScopeBootstrapResultV1, { readonly resolved: true }> | undefined;
    const requestedLevel = params.arguments.diagnostics;
    if (requestedLevel !== undefined && requestedLevel !== "summary" && requestedLevel !== "full") {
      return {
        error: {
          code: MCPErrorCode.VALIDATION_INVALID_FORMAT,
          message: "diagnostics must be either 'summary' or 'full'.",
        },
      };
    }
    if ((requestedLevel === "summary" || requestedLevel === "full") && !this.runtimeScope) {
      return {
        error: {
          code: "LEX_WORKSPACE_UNBOUND",
          message: "Runtime-scope diagnostics require a configured trusted bootstrap.",
        },
      };
    }
    if (this.runtimeScope) {
      const diagnosticRequest: DiagnosticRequestV1 | undefined =
        requestedLevel === "summary" || requestedLevel === "full"
          ? Object.freeze({
              schemaVersion: DIAGNOSTIC_CONTRACT_VERSION,
              level: requestedLevel,
            })
          : undefined;
      const resolution = await authorizeTrustedRuntimeEntrypoint(
        this.runtimeScope,
        "mcp",
        requestedCapabilities,
        diagnosticRequest
      );
      diagnostics = resolution.diagnostics;
      if (!resolution.resolved) {
        return {
          error: {
            code: resolution.error.code,
            message: resolution.error.message,
            ...(diagnostics ? { context: { diagnostics } } : {}),
          },
        };
      }
      authorizedRuntimeScope = resolution;
    }

    const { diagnostics: _diagnostics, ...toolArguments } = params.arguments;
    const dispatchContext = authorizedRuntimeScope
      ? this.trustedDispatchContext(authorizedRuntimeScope.invocationContext)
      : this.legacyDispatchContext();
    let scopedStore: ScopedFrameStore | undefined;
    if (authorizedRuntimeScope && this.frameStoreBinder) {
      try {
        scopedStore = this.frameStoreBinder.bind(authorizedRuntimeScope.authorizedScope);
      } catch (error) {
        if (error instanceof ScopedFrameStoreError) {
          return { error: { code: error.code, message: error.message } };
        }
        throw error;
      }
    }
    const dispatchStore = scopedStore ? scopedFrameStoreAsLegacyView(scopedStore) : this.frameStore;
    if (
      !dispatchStore &&
      requestedCapabilities.some((capability) => capability.startsWith("frame:"))
    ) {
      return {
        error: {
          code: SCOPED_FRAME_STORE_ERROR_CODES.INVALID_SCOPE,
          message: "No scope-bound FrameStore is available for this tool call.",
        },
      };
    }
    let response: MCPResponse;
    try {
      response = await this.dispatchToolsCall(
        { ...params, arguments: toolArguments },
        dispatchStore,
        dispatchContext,
        authorizedRuntimeScope
          ? this.trustedIdempotencyNamespace(authorizedRuntimeScope, dispatchContext)
          : "legacy-unscoped"
      );
    } finally {
      await scopedStore?.close();
    }
    if (!diagnostics) return response;
    return {
      ...response,
      data: {
        ...response.data,
        diagnostics,
      },
    };
  }

  private async dispatchToolsCall(
    params: ToolCallParams,
    frameStore: FrameStore | undefined,
    context: MCPDispatchWorkspaceContext,
    idempotencyNamespace: string
  ): Promise<MCPResponse> {
    const { name, arguments: args } = params;
    const canonicalName = canonicalMcpToolName(name);

    if (context.trusted && hasTrustedAttachmentInput(canonicalName, args)) {
      return {
        error: {
          code: MCPErrorCode.VALIDATION_INVALID_IMAGE,
          message:
            "Trusted scoped MCP does not support image attachments until a scope-bound attachment service is configured.",
          context: { trusted: true, imagesSupported: false },
        },
      };
    }

    // Log deprecation warnings for old tool names (AX-014)
    if (name in MCP_TOOL_ALIASES) {
      logger.warn(
        `[MCP] Tool "${name}" is deprecated. Use "${MCP_TOOL_ALIASES[name as keyof typeof MCP_TOOL_ALIASES]}" instead. ` +
          `See ADR-0009 for migration guide.`
      );
    }

    switch (canonicalName) {
      case "frame_create":
        return await this.handleRemember(
          args,
          requireDispatchFrameStore(frameStore),
          context,
          idempotencyNamespace
        );

      case "frame_validate":
        return await this.handleValidateRemember(args, context);

      case "frame_search":
        return await this.handleRecall(args, requireDispatchFrameStore(frameStore), context);

      case "frame_get":
        return await this.handleGetFrame(args, requireDispatchFrameStore(frameStore), context);

      case "frame_list":
        return await this.handleListFrames(args, requireDispatchFrameStore(frameStore), context);

      case "policy_check":
        return await this.handlePolicyCheck(args, context);

      case "timeline_show":
        return await this.handleTimeline(args, requireDispatchFrameStore(frameStore));

      case "atlas_analyze":
        return await this.handleCodeAtlas(args, context);

      case "system_introspect":
        return await this.handleIntrospect(args, requireDispatchFrameStore(frameStore), context);

      case "help":
        return await this.handleHelp(args, context.trusted);

      case "hints_get":
        return await this.handleGetHints(args);

      case "db_stats":
        return await this.handleDbStats(args, requireDispatchFrameStore(frameStore));

      case "turncost_calculate":
        return await this.handleTurncostCalculate(args, requireDispatchFrameStore(frameStore));

      case "contradictions_scan":
        return await this.handleContradictionsScan(args, requireDispatchFrameStore(frameStore));

      default:
        throw new MCPError(MCPErrorCode.INTERNAL_UNKNOWN_TOOL, `Unknown tool: ${name}`, {
          requestedTool: name,
          availableTools: [...CANONICAL_MCP_TOOLS],
        });
    }
  }

  /**
   * Handle mcp_lex_frame_remember tool - create new Frame
   *
   * Validates module IDs against policy with alias resolution before creating Frame (THE CRITICAL RULE)
   */
  private async handleRemember(
    args: Record<string, unknown>,
    frameStore: FrameStore,
    context: MCPDispatchWorkspaceContext,
    idempotencyNamespace: string
  ): Promise<MCPResponse> {
    const {
      reference_point,
      summary_caption,
      status_snapshot,
      module_scope,
      branch,
      jira,
      keywords,
      atlas_frame_id,
      images,
      request_id,
    } = args as unknown as RememberArgs;

    // Check idempotency cache if request_id is provided
    const scopedRequestId = request_id
      ? JSON.stringify([idempotencyNamespace, request_id])
      : undefined;
    if (scopedRequestId) {
      const cachedResponse = this.idempotencyCache.getCached(scopedRequestId);
      if (cachedResponse) {
        logger.info(`[remember] Returning cached response for request_id: ${request_id}`);
        return cachedResponse;
      }
    }

    // Validate required fields
    if (!reference_point || !summary_caption || !status_snapshot || !module_scope) {
      const missing: string[] = [];
      if (!reference_point) missing.push("reference_point");
      if (!summary_caption) missing.push("summary_caption");
      if (!status_snapshot) missing.push("status_snapshot");
      if (!module_scope) missing.push("module_scope");

      throw new MCPError(
        MCPErrorCode.VALIDATION_REQUIRED_FIELD,
        `Missing required fields: ${missing.join(", ")}`,
        {
          missingFields: missing,
          ...(missing.includes("module_scope") ? { remediation: fallbackRemediation() } : {}),
        }
      );
    }

    if (!Array.isArray(module_scope) || module_scope.length === 0) {
      throw new MCPError(
        MCPErrorCode.VALIDATION_EMPTY_MODULE_SCOPE,
        "module_scope must be a non-empty array of module IDs",
        { remediation: fallbackRemediation() }
      );
    }

    // Validate status_snapshot structure
    if (!status_snapshot.next_action) {
      throw new MCPError(
        MCPErrorCode.VALIDATION_INVALID_STATUS,
        "status_snapshot.next_action is required"
      );
    }

    // THE CRITICAL RULE: Resolve aliases and validate module IDs against policy (if available)
    let canonicalModuleScope = module_scope;
    const fallbackScope = isCanonicalUnscopedScope(module_scope);
    const moduleAttribution: ModuleAttribution = fallbackScope
      ? createFallbackModuleAttribution("mcp:module_scope")
      : {
          mode: "explicit",
          confidence: "high",
          evidence: ["mcp:module_scope"],
        };
    if (context.policy && !fallbackScope) {
      const validationResult = await validateModuleIds(module_scope, context.policy);

      if (!validationResult.valid && validationResult.errors) {
        // Collect invalid IDs and suggestions
        const invalidIds = validationResult.errors.map((e: ModuleIdError) => e.module);
        const suggestions = validationResult.errors
          .flatMap((e: ModuleIdError) => e.suggestions)
          .filter((s, i, arr) => arr.indexOf(s) === i); // dedupe

        throw createModuleIdError(invalidIds, suggestions, Object.keys(context.policy.modules));
      }

      // Use canonical IDs for storage (never store aliases)
      if (validationResult.canonical) {
        canonicalModuleScope = validationResult.canonical;
      }
    } else if (process.env.LEX_DEBUG) {
      logger.error(`[LEX] Skipping module validation (no policy loaded)`);
    }

    // Generate Frame ID and timestamp
    const frameId = `frame-${Date.now()}-${randomUUID()}`;
    const timestamp = new Date().toISOString();

    // Get current git branch if not provided - only auto-detect when we
    // have an explicit repoRoot or an environment override. This avoids
    // leaking the runner's git branch into tests or hosted environments.
    let frameBranch: string;
    if (branch) {
      frameBranch = branch;
    } else if (context.trusted) {
      frameBranch = context.sourceRevision?.branch ?? "unknown";
    } else if (this.repoRoot || process.env.LEX_DEFAULT_BRANCH) {
      frameBranch = getCurrentBranch();
      // Log branch detection for debugging
      logger.info(`[mcp_lex_frame_remember] Auto-detected branch: ${frameBranch}`);
    } else {
      // When no repoRoot is provided and no env override, avoid auto-detecting
      // from the runner's repository; use 'unknown' to indicate no branch context.
      frameBranch = "unknown";
    }

    const frame = {
      id: frameId,
      timestamp,
      branch: frameBranch,
      jira: jira || undefined,
      module_scope: canonicalModuleScope, // Store canonical IDs only
      summary_caption,
      reference_point,
      status_snapshot,
      keywords: keywords || undefined,
      atlas_frame_id: atlas_frame_id || undefined,
      image_ids: [] as string[],
      module_attribution: moduleAttribution,
    };

    // Process image attachments if provided
    const imageIds: string[] = [];
    const imageManager = frameStore === this.frameStore ? this.imageManager : null;
    if (images && Array.isArray(images) && images.length > 0) {
      if (!imageManager) {
        throw new MCPError(
          MCPErrorCode.STORAGE_IMAGE_FAILED,
          `Image storage is not available because it is unsupported by the ${frameStore.getMetadata().backend} backend`,
          { frameId, backend: frameStore.getMetadata().backend }
        );
      }
    }

    await frameStore.saveFrame(frame);

    if (images && Array.isArray(images) && images.length > 0) {
      if (!imageManager) {
        throw new Error("Image manager became unavailable after image capability validation");
      }
      for (const img of images) {
        try {
          // Decode base64 image data
          const imageBuffer = Buffer.from(img.data, "base64");
          const imageId = imageManager.storeImage(frameId, imageBuffer, img.mime_type);
          imageIds.push(imageId);
        } catch (error: unknown) {
          // If image storage fails, clean up the Frame and rethrow
          await frameStore.deleteFrame(frameId);
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new MCPError(
            MCPErrorCode.STORAGE_IMAGE_FAILED,
            `Failed to store image: ${errorMessage}`,
            { frameId, mimeType: img.mime_type }
          );
        }
      }

      // Update frame with image IDs
      frame.image_ids = imageIds;
      await frameStore.saveFrame(frame);
    }

    // Generate Policy Neighborhood context (skip if no policy is available)
    let atlasOutput = "";
    try {
      const atlasFrame = this.atlasFrameForContext(canonicalModuleScope, context);
      atlasOutput = formatAtlasFrame(atlasFrame);
    } catch {
      // Policy Neighborhood generation requires policy — skip gracefully
      if (process.env.LEX_DEBUG) {
        logger.error(`[LEX] Skipping atlas frame generation (no policy available)`);
      }
    }

    const imageInfo = imageIds.length > 0 ? `🖼️  Images: ${imageIds.length} attached\n` : "";

    // Build structured response data (AX-002)
    const responseData: Record<string, unknown> = {
      success: true,
      frame_id: frameId,
      created_at: timestamp,
      module_scope: canonicalModuleScope,
      module_attribution: moduleAttribution,
    };

    // Include atlas_frame_id if one was provided or stored
    if (frame.atlas_frame_id) {
      responseData.atlas_frame_id = frame.atlas_frame_id;
    }

    const response: MCPResponse = {
      content: [
        {
          type: "text",
          text:
            `✅ Frame stored: ${frameId}\n` +
            `📍 Reference: ${reference_point}\n` +
            `💬 Summary: ${summary_caption}\n` +
            `📦 Modules: ${canonicalModuleScope.join(", ")}\n` +
            `🌿 Branch: ${frameBranch}\n` +
            `${jira ? `🎫 Jira: ${jira}\n` : ""}` +
            imageInfo +
            `📅 Timestamp: ${timestamp}\n` +
            atlasOutput,
        },
      ],
      data: responseData,
    };

    // Cache the response if request_id was provided
    if (scopedRequestId) {
      this.idempotencyCache.setCached(scopedRequestId, response);
    }

    return response;
  }

  /**
   * Handle validate_remember tool - validate Frame input without storage (dry-run)
   *
   * Performs the same validation as handleRemember but returns a structured validation result
   * without creating or storing a Frame. This enables agents to verify inputs incrementally.
   */
  private async handleValidateRemember(
    args: Record<string, unknown>,
    context: MCPDispatchWorkspaceContext
  ): Promise<MCPResponse> {
    const {
      reference_point,
      summary_caption,
      status_snapshot,
      module_scope,
      branch,
      jira,
      keywords: _keywords,
      atlas_frame_id: _atlas_frame_id,
      images,
    } = args as unknown as RememberArgs;

    const frameWriteContract = this.buildMCPFrameWriteContract(
      context,
      [],
      [reference_point, summary_caption, status_snapshot?.next_action].filter(Boolean).join(" "),
      branch
    );
    const remediation = fallbackRemediation();
    const errors: Array<{
      field: string;
      code: string;
      message: string;
      suggestions?: string[];
      remediation?: ReturnType<typeof fallbackRemediation>;
    }> = [];
    const warnings: Array<{ field: string; message: string }> = [];

    // Validate required fields
    if (!reference_point) {
      errors.push({
        field: "reference_point",
        code: MCPErrorCode.VALIDATION_REQUIRED_FIELD,
        message: "reference_point is required",
      });
    }
    if (!summary_caption) {
      errors.push({
        field: "summary_caption",
        code: MCPErrorCode.VALIDATION_REQUIRED_FIELD,
        message: "summary_caption is required",
      });
    }
    if (!status_snapshot) {
      errors.push({
        field: "status_snapshot",
        code: MCPErrorCode.VALIDATION_REQUIRED_FIELD,
        message: "status_snapshot is required",
      });
    } else if (!status_snapshot.next_action) {
      errors.push({
        field: "status_snapshot.next_action",
        code: MCPErrorCode.VALIDATION_INVALID_STATUS,
        message: "status_snapshot.next_action is required",
      });
    }
    if (!module_scope) {
      errors.push({
        field: "module_scope",
        code: MCPErrorCode.VALIDATION_REQUIRED_FIELD,
        message: "module_scope is required",
        remediation,
      });
    } else if (!Array.isArray(module_scope) || module_scope.length === 0) {
      errors.push({
        field: "module_scope",
        code: MCPErrorCode.VALIDATION_EMPTY_MODULE_SCOPE,
        message: "module_scope must be a non-empty array of module IDs",
        remediation,
      });
    }

    // Check for Jira ID format (warning only, not blocking)
    if (jira && typeof jira === "string") {
      // Basic check: should look like PROJECT-123 or similar
      if (!/^[A-Z][A-Z0-9]+-\d+$/i.test(jira)) {
        warnings.push({
          field: "jira",
          message: `Jira ID format not recognized. Expected format: PROJECT-123 (got: "${jira}")`,
        });
      }
    }

    // Validate module IDs against policy (if available and module_scope is valid)
    if (
      context.policy &&
      module_scope &&
      Array.isArray(module_scope) &&
      module_scope.length > 0 &&
      !isCanonicalUnscopedScope(module_scope)
    ) {
      try {
        const validationResult = await validateModuleIds(module_scope, context.policy);

        if (!validationResult.valid && validationResult.errors) {
          // Convert ModuleIdError to our error format
          for (const err of validationResult.errors) {
            errors.push({
              field: "module_scope",
              code: MCPErrorCode.VALIDATION_INVALID_MODULE_ID,
              message: err.message,
              suggestions: err.suggestions,
            });
          }
        }
      } catch (error: unknown) {
        // If module validation fails unexpectedly, add it as an error
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({
          field: "module_scope",
          code: MCPErrorCode.VALIDATION_INVALID_MODULE_ID,
          message: `Module validation failed: ${errorMessage}`,
        });
      }
    } else if (
      !context.policy &&
      module_scope &&
      Array.isArray(module_scope) &&
      module_scope.length > 0
    ) {
      // No policy loaded - add a warning
      warnings.push({
        field: "module_scope",
        message: "Policy not loaded - module IDs cannot be validated",
      });
    }

    // Check image format (basic validation without decoding)
    if (images && Array.isArray(images)) {
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (!img.data || typeof img.data !== "string") {
          errors.push({
            field: `images[${i}].data`,
            code: MCPErrorCode.VALIDATION_INVALID_IMAGE,
            message: "Image data must be a base64-encoded string",
          });
        }
        if (!img.mime_type || typeof img.mime_type !== "string") {
          errors.push({
            field: `images[${i}].mime_type`,
            code: MCPErrorCode.VALIDATION_INVALID_IMAGE,
            message: "Image mime_type is required",
          });
        } else if (
          !["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"].includes(
            img.mime_type
          )
        ) {
          warnings.push({
            field: `images[${i}].mime_type`,
            message: `Uncommon MIME type: ${img.mime_type}. Supported types: image/png, image/jpeg, image/jpg, image/gif, image/webp`,
          });
        }
      }
    }

    // Build response
    const valid = errors.length === 0;
    const moduleAttribution: ModuleAttribution | null =
      Array.isArray(module_scope) && module_scope.length > 0
        ? isCanonicalUnscopedScope(module_scope)
          ? createFallbackModuleAttribution("mcp:module_scope")
          : {
              mode: "explicit",
              confidence: "high",
              evidence: ["mcp:module_scope"],
            }
        : null;
    const responseData = {
      valid,
      errors,
      warnings,
      frameWriteContract,
      moduleAttribution,
    };

    if (valid) {
      // Success response with warnings if any
      let text = "✅ Validation passed - input is valid for remember\n";
      if (warnings.length > 0) {
        text += "\n⚠️  Warnings:\n";
        for (const warning of warnings) {
          text += `  - ${warning.field}: ${warning.message}\n`;
        }
      }

      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
        data: responseData,
      };
    } else {
      // Error response with structured errors
      let text = "❌ Validation failed\n\n";
      text += "Errors:\n";
      for (const error of errors) {
        text += `  - ${error.field}: ${error.message}\n`;
        if (error.suggestions && error.suggestions.length > 0) {
          text += `    Suggestions: ${error.suggestions.join(", ")}\n`;
        }
        if (error.remediation) {
          text += `    Remediation: ${error.remediation.message}\n`;
        }
      }

      if (warnings.length > 0) {
        text += "\nWarnings:\n";
        for (const warning of warnings) {
          text += `  - ${warning.field}: ${warning.message}\n`;
        }
      }

      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
        data: responseData,
      };
    }
  }

  /**
   * Handle mcp_lex_frame_recall tool with optional Policy Neighborhood context
   */
  private async handleRecall(
    args: Record<string, unknown>,
    frameStore: FrameStore,
    context: MCPDispatchWorkspaceContext
  ): Promise<MCPResponse> {
    const {
      reference_point,
      jira,
      branch,
      limit = 10,
      format = "full",
      mode = "all",
    } = args as unknown as RecallArgs;

    // Track search timing for metadata (AX #578)
    const searchStart = Date.now();

    if (!reference_point && !jira && !branch) {
      throw new AXErrorException(
        "MCP_RECALL_MISSING_PARAMS",
        "At least one search parameter required: reference_point, jira, or branch",
        [
          "Provide a reference_point to search by text",
          "Provide a jira ticket ID to filter by Jira ticket",
          "Provide a branch name to filter by git branch",
        ],
        { providedParams: { reference_point, jira, branch } }
      );
    }

    let frames: Frame[];
    let matchStrategy: string;
    try {
      // Build search criteria based on provided parameters
      const criteria: FrameSearchCriteria = { limit };

      if (reference_point) {
        // Use FTS5 full-text search for reference_point
        criteria.query = reference_point;
        criteria.mode = mode;
        frames = await frameStore.searchFrames(criteria);
        matchStrategy = mode === "any" ? "fts:or" : "fts";
      } else if (jira) {
        // For jira/branch filtering, we need to search all and filter
        // The FrameStore interface doesn't have specific jira/branch methods
        // We'll use listFrames and filter in JavaScript
        const result = await frameStore.listFrames({ limit: MAX_FILTER_FETCH_LIMIT });
        frames = result.frames.filter((f) => f.jira === jira).slice(0, limit);
        matchStrategy = "filter:jira";
      } else if (branch) {
        // For branch filtering, search all and filter
        const result = await frameStore.listFrames({ limit: MAX_FILTER_FETCH_LIMIT });
        frames = result.frames.filter((f) => f.branch === branch).slice(0, limit);
        matchStrategy = "filter:branch";
      } else {
        frames = [];
        matchStrategy = "none";
      }
    } catch (error: unknown) {
      // FTS5 search can fail with special characters (e.g., "zzz-nonexistent-query-zzz")
      // Treat search errors as empty results rather than propagating the error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = error as any;
      if (err.code === "SQLITE_ERROR" || err.message?.includes("no such column")) {
        frames = [];
        matchStrategy = "fts";
      } else {
        throw error;
      }
    }

    // Calculate search timing and get total frame count (AX #578)
    const searchTimeMs = Date.now() - searchStart;
    const totalFrames = await this.getFrameCount(frameStore);

    // Build search metadata (AX #578)
    const meta = {
      query: {
        reference_point: reference_point || null,
        jira: jira || null,
        branch: branch || null,
        limit,
      },
      searchTimeMs,
      totalFrames,
      matchStrategy,
      matchCount: frames.length,
      status: frames.length > 0 ? "success" : "no_matches",
    };

    if (frames.length === 0) {
      return {
        content: [
          {
            type: "text",
            text:
              "🔍 No matching Frames found.\n" +
              "Try broader search terms or check your query parameters.",
          },
        ],
        data: { meta },
      };
    }

    // Handle compact format
    if (format === "compact") {
      const compactResult = compactFrameList(frames);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(compactResult, null, 2),
          },
        ],
        data: {
          frames: compactResult.frames,
          count: compactResult.count,
          ...(compactResult._truncated && { _truncated: true }),
          meta,
        },
      };
    }

    // Format results with a Policy Neighborhood for each (full format)
    const results = frames
      .map((f: Frame, idx: number) => {
        const nextAction = f.status_snapshot?.next_action || "None specified";
        const blockers = f.status_snapshot?.blockers || [];
        const mergeBlockers = f.status_snapshot?.merge_blockers || [];
        const testsFailing = f.status_snapshot?.tests_failing || [];

        // Generate a Policy Neighborhood for this Frame's modules (skip without policy)
        let atlasOutput = "";
        try {
          const atlasFrame = this.atlasFrameForContext(f.module_scope, context);
          atlasOutput = formatAtlasFrame(atlasFrame);
        } catch {
          /* no policy available */
        }

        return (
          `\n--- Frame ${idx + 1}/${frames.length} ---\n` +
          `ID: ${f.id}\n` +
          `📍 Reference: ${f.reference_point}\n` +
          `💬 Summary: ${f.summary_caption}\n` +
          `📦 Modules: ${f.module_scope.join(", ")}\n` +
          `🌿 Branch: ${f.branch}\n` +
          `${f.jira ? `🎫 Jira: ${f.jira}\n` : ""}` +
          `📅 Timestamp: ${f.timestamp}\n` +
          `\nStatus:\n` +
          `  ⏭️  Next Action: ${nextAction}\n` +
          `  🚫 Blockers (${blockers.length}): ${blockers.join(", ") || "none"}\n` +
          `  ⛔ Merge Blockers (${mergeBlockers.length}): ${mergeBlockers.join(", ") || "none"}\n` +
          `  ❌ Tests Failing (${testsFailing.length}): ${testsFailing.join(", ") || "none"}\n` +
          `${f.keywords ? `🏷️  Keywords: ${f.keywords.join(", ")}\n` : ""}` +
          `${f.atlas_frame_id ? `🗺️  Atlas: ${f.atlas_frame_id}\n` : ""}` +
          atlasOutput
        );
      })
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `🎯 Found ${frames.length} Frame(s):\n${results}`,
        },
      ],
      data: { meta },
    };
  }

  /**
   * Handle get_frame tool - retrieve a specific frame by ID
   */
  private async handleGetFrame(
    args: Record<string, unknown>,
    frameStore: FrameStore,
    context: MCPDispatchWorkspaceContext
  ): Promise<MCPResponse> {
    const { frame_id, include_atlas = true, format = "full" } = args as unknown as GetFrameArgs;

    // Validate required field
    if (!frame_id) {
      throw new MCPError(
        MCPErrorCode.VALIDATION_REQUIRED_FIELD,
        "Missing required field: frame_id",
        { missingFields: ["frame_id"] }
      );
    }

    // Retrieve the frame by ID
    const frame = await frameStore.getFrameById(frame_id);

    if (!frame) {
      throw new MCPError(MCPErrorCode.STORAGE_FRAME_NOT_FOUND, `Frame not found: ${frame_id}`, {
        frameId: frame_id,
      });
    }

    // Handle compact format
    if (format === "compact") {
      const compactResult = compactFrame(frame);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(compactResult, null, 2),
          },
        ],
        data: compactResult as unknown as Record<string, unknown>,
      };
    }

    // Format the frame data (full format)
    const nextAction = frame.status_snapshot?.next_action || "None specified";
    const blockers = frame.status_snapshot?.blockers || [];
    const mergeBlockers = frame.status_snapshot?.merge_blockers || [];
    const testsFailing = frame.status_snapshot?.tests_failing || [];

    let result =
      `✅ Frame retrieved: ${frame.id}\n` +
      `📍 Reference: ${frame.reference_point}\n` +
      `💬 Summary: ${frame.summary_caption}\n` +
      `📦 Modules: ${frame.module_scope.join(", ")}\n` +
      `🌿 Branch: ${frame.branch}\n` +
      `${frame.jira ? `🎫 Jira: ${frame.jira}\n` : ""}` +
      `📅 Timestamp: ${frame.timestamp}\n` +
      `\nStatus:\n` +
      `  ⏭️  Next Action: ${nextAction}\n` +
      `  🚫 Blockers (${blockers.length}): ${blockers.join(", ") || "none"}\n` +
      `  ⛔ Merge Blockers (${mergeBlockers.length}): ${mergeBlockers.join(", ") || "none"}\n` +
      `  ❌ Tests Failing (${testsFailing.length}): ${testsFailing.join(", ") || "none"}\n` +
      `${frame.keywords ? `🏷️  Keywords: ${frame.keywords.join(", ")}\n` : ""}` +
      `${frame.atlas_frame_id ? `🗺️  Atlas: ${frame.atlas_frame_id}\n` : ""}`;

    // Include Policy Neighborhood context if requested (skip without policy)
    if (include_atlas) {
      try {
        const atlasFrame = this.atlasFrameForContext(frame.module_scope, context);
        const atlasOutput = formatAtlasFrame(atlasFrame);
        result += `\n${atlasOutput}`;
      } catch {
        /* no policy available */
      }
    }

    return {
      content: [
        {
          type: "text",
          text: result,
        },
      ],
      data: {
        frame_id: frame.id,
        timestamp: frame.timestamp,
        module_scope: frame.module_scope,
        module_attribution: frame.module_attribution ?? null,
      },
    };
  }

  /**
   * Handle mcp_lex_frame_list tool - list recent Frames
   */
  private async handleListFrames(
    args: Record<string, unknown>,
    frameStore: FrameStore,
    context: MCPDispatchWorkspaceContext
  ): Promise<MCPResponse> {
    const {
      branch,
      module,
      limit = 10,
      since,
      cursor,
      format = "full",
    } = args as unknown as ListFramesArgs;

    // Get frames using frameStore.listFrames with new pagination API
    // Note: When filters are applied (branch, module, since), we need to fetch more
    // frames than the limit to account for filtering. However, cursor pagination
    // doesn't work well with post-fetch filtering. For now, we'll fetch a large
    // batch when filters are present.
    const needsFiltering = branch || module || since;
    const fetchLimit = needsFiltering ? MAX_FILTER_FETCH_LIMIT : limit;

    const result = await frameStore.listFrames({
      limit: fetchLimit,
      cursor: cursor,
    });

    let frames = result.frames;

    // Filter by branch if specified
    if (branch) {
      frames = frames.filter((f: Frame) => f.branch === branch);
    }

    // Filter by module if specified
    if (module) {
      frames = frames.filter((f: Frame) => f.module_scope.includes(module));
    }

    // Filter by timestamp if since is specified
    if (since) {
      const sinceDate = new Date(since);
      frames = frames.filter((f: Frame) => new Date(f.timestamp) >= sinceDate);
    }

    // Apply limit after filtering (if we fetched more due to filters)
    if (needsFiltering) {
      frames = frames.slice(0, limit);
    }

    if (frames.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "📋 No Frames found matching criteria.",
          },
        ],
        data: {
          page: {
            limit: result.page.limit,
            nextCursor: null,
            hasMore: false,
          },
          order: result.order,
        },
      };
    }

    // Handle compact format
    if (format === "compact") {
      const compactResult = compactFrameList(frames);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(compactResult, null, 2),
          },
        ],
        data: {
          frames: compactResult.frames,
          count: compactResult.count,
          ...(compactResult._truncated && { _truncated: true }),
          page: needsFiltering
            ? {
                limit: result.page.limit,
                nextCursor: null,
                hasMore: false,
              }
            : result.page,
          order: result.order,
        },
      };
    }

    // Format results with Policy Neighborhood context for each (full format)
    const results = frames
      .map((f: Frame, idx: number) => {
        let atlasOutput = "";
        try {
          const atlasFrame = this.atlasFrameForContext(f.module_scope, context);
          atlasOutput = formatAtlasFrame(atlasFrame);
        } catch {
          /* no policy available */
        }

        return (
          `\n${idx + 1}. ${f.reference_point}\n` +
          `   ID: ${f.id}\n` +
          `   📦 Modules: ${f.module_scope.join(", ")}\n` +
          `   🌿 Branch: ${f.branch}\n` +
          `   📅 ${f.timestamp}\n` +
          atlasOutput
        );
      })
      .join("\n");

    // Add pagination info to the output
    let paginationInfo = `\n\n📄 Pagination:\n`;
    paginationInfo += `   Limit: ${result.page.limit}\n`;
    paginationInfo += `   Has More: ${result.page.hasMore}\n`;
    if (result.page.nextCursor) {
      paginationInfo += `   Next Cursor: ${result.page.nextCursor}\n`;
    }
    paginationInfo += `   Order: ${result.order.by} ${result.order.direction}`;

    return {
      content: [
        {
          type: "text",
          text: `📋 Recent Frames (${frames.length}):\n${results}${paginationInfo}`,
        },
      ],
      data: {
        // Note: Cursor pagination is disabled when filters (branch, module, since) are applied
        // because post-fetch filtering makes it impossible to generate accurate nextCursor values.
        // In this case, all matching results are fetched and sliced client-side.
        page: needsFiltering
          ? {
              limit: result.page.limit,
              nextCursor: null,
              hasMore: false,
            }
          : result.page,
        order: result.order,
      },
    };
  }

  /**
   * Handle mcp_lex_policy_check tool - validate policy file
   */
  private async handlePolicyCheck(
    args: Record<string, unknown>,
    context: MCPDispatchWorkspaceContext
  ): Promise<MCPResponse> {
    const { path: checkPath, policyPath, strict = false } = args as unknown as PolicyCheckArgs;

    try {
      // Resolve policy path - if checkPath is provided, resolve policyPath relative to it
      let resolvedPolicyPath: string | undefined = policyPath;
      if (checkPath && policyPath) {
        const { resolve, isAbsolute } = await import("path");
        if (!isAbsolute(policyPath)) {
          resolvedPolicyPath = resolve(checkPath, policyPath);
        }
      }

      if (context.trusted) {
        const projectRoot = context.projectRoot;
        if (!projectRoot) {
          throw new MCPError(
            MCPErrorCode.POLICY_INVALID,
            "Trusted policy dispatch is missing its authorized project root."
          );
        }
        let basePath: string;
        try {
          basePath = canonicalizeContainedPath(
            projectRoot,
            checkPath ? resolve(projectRoot, checkPath) : projectRoot
          );
        } catch {
          throw new MCPError(
            MCPErrorCode.VALIDATION_INVALID_PATH,
            "policy_check path must remain within the authorized project root."
          );
        }
        if (policyPath) {
          const requestedPolicyPath = isAbsolute(policyPath)
            ? policyPath
            : resolve(basePath, policyPath);
          resolvedPolicyPath = requestedPolicyPath;
        }
      }

      // Load policy file
      let policy: Policy;
      if (context.trusted) {
        if (!resolvedPolicyPath) {
          if (!context.policy) {
            throw new MCPError(MCPErrorCode.POLICY_NOT_FOUND, "Trusted policy is unavailable.");
          }
          policy = context.policy;
        } else {
          if (!context.projectRoot) {
            throw new MCPError(
              MCPErrorCode.POLICY_INVALID,
              "Trusted policy dispatch is missing its authorized project root."
            );
          }
          try {
            const snapshot = readContainedFile(context.projectRoot, resolvedPolicyPath);
            resolvedPolicyPath = snapshot.canonicalPath;
            policy = loadPolicySnapshot(snapshot.content, snapshot.canonicalPath);
          } catch (error) {
            if (error instanceof MCPError) throw error;
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              throw new MCPError(MCPErrorCode.POLICY_NOT_FOUND, "Policy file not found.");
            }
            throw new MCPError(
              MCPErrorCode.POLICY_INVALID,
              `Policy snapshot could not be loaded: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      } else {
        policy = loadPolicy(resolvedPolicyPath);
      }

      // Validate schema
      const validation = validatePolicySchema(policy);

      // Prepare result
      const valid = strict
        ? validation.valid && validation.warnings.length === 0
        : validation.valid;

      // Format output
      let output = "";

      if (valid) {
        output += `✅ Policy valid: ${validation.moduleCount} modules defined\n`;
      } else {
        output += `❌ Policy invalid: ${validation.errors.length} error(s) found\n`;
      }

      // Add errors
      if (validation.errors.length > 0) {
        output += "\nErrors:\n";
        for (const error of validation.errors) {
          output += `  ❌ ${error.path}: ${error.message}\n`;
        }
      }

      // Add warnings
      if (validation.warnings.length > 0) {
        output += "\nWarnings:\n";
        for (const warning of validation.warnings) {
          output += `  ⚠️  ${warning.path}: ${warning.message}\n`;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: output,
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // If it's already an MCPError, rethrow it
      if (error instanceof MCPError) {
        throw error;
      }

      // Check if it's a file not found error
      if (errorMessage.includes("ENOENT") || errorMessage.includes("not found")) {
        throw new MCPError(
          MCPErrorCode.POLICY_NOT_FOUND,
          `Policy file not found: ${errorMessage}`,
          { policyPath }
        );
      }

      // Otherwise, it's an invalid policy
      throw new MCPError(MCPErrorCode.POLICY_INVALID, `Policy validation failed: ${errorMessage}`, {
        policyPath,
      });
    }
  }

  /**
   * Handle mcp_lex_frame_timeline tool - show timeline of Frame evolution
   */
  private async handleTimeline(
    args: Record<string, unknown>,
    frameStore: FrameStore
  ): Promise<MCPResponse> {
    const { ticketOrBranch, since, until, format = "text" } = args as unknown as TimelineArgs;

    // Validate required parameter
    if (!ticketOrBranch) {
      throw new MCPError(
        MCPErrorCode.VALIDATION_REQUIRED_FIELD,
        "Missing required field: ticketOrBranch",
        { missingFields: ["ticketOrBranch"] }
      );
    }

    try {
      // Get all frames and filter by Jira ticket or branch
      const listResult = await frameStore.listFrames();

      let frames: Frame[] = [];
      let title: string;

      // Try to find frames by Jira ticket first
      const framesByJira = listResult.frames.filter((f) => f.jira === ticketOrBranch);
      if (framesByJira.length > 0) {
        frames = framesByJira;
        title = `${ticketOrBranch}: Timeline`;
      } else {
        // Try by branch name
        const framesByBranch = listResult.frames.filter((f) => f.branch === ticketOrBranch);
        if (framesByBranch.length > 0) {
          frames = framesByBranch;
          title = `Branch ${ticketOrBranch}: Timeline`;
        } else {
          // No frames found
          title = `${ticketOrBranch}: Timeline`;
        }
      }

      if (frames.length === 0) {
        return {
          content: [
            {
              type: "text",
              text:
                `🔍 No frames found for: "${ticketOrBranch}"\n\n` +
                "Try using a Jira ticket ID (e.g., TICKET-123) or a branch name.\n" +
                "Run 'mcp_lex_frame_remember' to create a frame first.",
            },
          ],
        };
      }

      // Build timeline
      let timelineData = buildTimeline(frames);

      // Apply filters
      const timelineOptions: TimelineOptions = {
        format: format as "text" | "json",
      };

      if (since) {
        timelineOptions.since = new Date(since);
      }

      if (until) {
        timelineOptions.until = new Date(until);
      }

      if (timelineOptions.since || timelineOptions.until) {
        timelineData = filterTimeline(timelineData, timelineOptions);

        if (timelineData.length === 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  "🔍 No frames found in the specified date range.\n\n" +
                  "Try widening the date range or remove date filters.",
              },
            ],
          };
        }
      }

      // Render timeline based on format
      let result: string;

      switch (format) {
        case "compact": {
          // Compact format: return compact frames with timeline metadata
          const compactResult = compactFrameList(frames);
          const timelineMetadata = {
            title,
            count: frames.length,
            firstTimestamp: frames[frames.length - 1]?.timestamp,
            lastTimestamp: frames[0]?.timestamp,
          };
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    frames: compactResult.frames,
                    count: compactResult.count,
                    ...(compactResult._truncated && { _truncated: true }),
                    timeline: timelineMetadata,
                  },
                  null,
                  2
                ),
              },
            ],
            data: {
              frames: compactResult.frames,
              count: compactResult.count,
              ...(compactResult._truncated && { _truncated: true }),
              timeline: timelineMetadata,
            },
          };
        }
        case "json":
          result = renderTimelineJSON(timelineData);
          break;
        case "text":
        default:
          result = renderTimelineText(timelineData, title);
          result += renderModuleScopeEvolution(timelineData);
          result += renderBlockerTracking(timelineData);
          break;
      }

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new MCPError(
        MCPErrorCode.INTERNAL_ERROR,
        `Failed to generate timeline: ${errorMessage}`,
        { ticketOrBranch, error: errorMessage }
      );
    }
  }

  /**
   * Handle mcp_lex_atlas_analyze tool - analyze code structure and dependencies
   */
  private async handleCodeAtlas(
    args: Record<string, unknown>,
    context: MCPDispatchWorkspaceContext
  ): Promise<MCPResponse> {
    const {
      path: requestPath,
      foldRadius: _foldRadius,
      maxTokens: _maxTokens,
    } = args as unknown as CodeAtlasArgs;

    // Trusted dispatch is always anchored to the authorized invocation root.
    let repoPath = requestPath || this.repoRoot || process.cwd();
    if (context.trusted) {
      if (!context.projectRoot) {
        throw new MCPError(
          MCPErrorCode.VALIDATION_INVALID_PATH,
          "atlas_analyze is missing its authorized project root."
        );
      }
      try {
        repoPath = canonicalizeContainedPath(
          context.projectRoot,
          resolve(context.projectRoot, requestPath ?? ".")
        );
      } catch {
        throw new MCPError(
          MCPErrorCode.VALIDATION_INVALID_PATH,
          "atlas_analyze path must remain within the authorized project root."
        );
      }
    }

    try {
      const result = await codeAtlas({
        repo: repoPath,
        json: true,
        emitOutput: false,
        ...(context.trusted ? { trustedProjectRoot: repoPath } : {}),
      });
      if (!result.success || !result.output) {
        throw new MCPError(
          MCPErrorCode.INTERNAL_ERROR,
          `Code Index generation failed: ${result.error ?? "unknown error"}`,
          { path: repoPath }
        );
      }
      const output = result.output;
      const { run, units } = output;

      // Format the output for MCP response
      const summary =
        `🗺️  Code Index Generated\n` +
        `📍 Repository: ${run.repoId}\n` +
        `📁 Files scanned: ${run.filesScanned.length}${
          run.truncated ? ` (truncated from ${run.filesRequested.length})` : ""
        }\n` +
        `🔍 Units extracted: ${run.unitsEmitted}\n` +
        `⚙️  Strategy: ${run.strategy}\n` +
        `📅 Created: ${run.createdAt}\n\n`;

      // Group units by file for better readability
      const unitsByFile = new Map<string, typeof units>();
      for (const unit of units) {
        const existing = unitsByFile.get(unit.filePath) || [];
        existing.push(unit);
        unitsByFile.set(unit.filePath, existing);
      }

      let unitsOutput = "📦 Extracted Units:\n";
      let fileCount = 0;
      for (const [filePath, fileUnits] of unitsByFile) {
        fileCount++;
        unitsOutput += `\n${fileCount}. ${filePath} (${fileUnits.length} units)\n`;
        for (const unit of fileUnits) {
          unitsOutput += `   - ${unit.kind}: ${unit.name} (lines ${unit.span.startLine}-${unit.span.endLine})\n`;
        }
        // Limit output to avoid overwhelming the response
        if (fileCount >= 20) {
          const remainingFiles = unitsByFile.size - fileCount;
          if (remainingFiles > 0) {
            unitsOutput += `\n... and ${remainingFiles} more files\n`;
          }
          break;
        }
      }

      // Include raw data as JSON for programmatic access
      const jsonOutput = `\n📄 Full Output (JSON):\n\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\``;

      return {
        content: [
          {
            type: "text",
            text: summary + unitsOutput + jsonOutput,
          },
        ],
      };
    } catch (error: unknown) {
      // Handle errors from Code Index generation
      if (error instanceof MCPError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new MCPError(
        MCPErrorCode.INTERNAL_ERROR,
        `Failed to generate Code Index: ${errorMessage}`,
        { path: requestPath, error: errorMessage }
      );
    }
  }

  private buildMCPFrameWriteContract(
    context: MCPDispatchWorkspaceContext,
    recentFrames: Frame[] = [],
    query?: string,
    branch: string | undefined = context.sourceRevision?.branch
  ): MCPFrameWriteContract {
    const contract = buildFrameWriteContract({
      policy: context.policy,
      projectRoot: context.projectRoot ?? context.configResolution.workspaceRoot.path,
      branch,
      query,
      recentFrames,
    });
    return toMCPFrameWriteContract(contract);
  }

  private async inspectScopeHealth(
    frameStore: FrameStore,
    context: MCPDispatchWorkspaceContext,
    storeHealthy: boolean
  ): Promise<{ scopeHealth: ScopeHealth; recentFrames: Frame[] }> {
    const policyModules = new Set(Object.keys(context.policy?.modules ?? {}));
    const policyHealth: ScopeHealth["policy"] = {
      state: context.policy ? "loaded" : "unavailable",
      source: context.policyResolution?.source ?? "not-found",
      path: context.policyResolution?.path ?? null,
      moduleCount: policyModules.size,
    };

    if (!storeHealthy) {
      return {
        scopeHealth: {
          policy: policyHealth,
          frames: {
            state: "unavailable",
            unscopedCount: 0,
            drift: {
              state: "not-evaluated",
              frameCount: 0,
              moduleIdCount: 0,
              modules: [],
              summaryLimit: SCOPE_HEALTH_SUMMARY_LIMIT,
              truncated: false,
            },
          },
        },
        recentFrames: [],
      };
    }

    let cursor: string | undefined;
    let unscopedCount = 0;
    let driftedFrameCount = 0;
    const unknownModules = new Map<string, number>();
    const seenCursors = new Set<string>();
    const recentFrames: Frame[] = [];

    do {
      const result = await frameStore.listFrames({
        limit: SCOPE_HEALTH_PAGE_SIZE,
        cursor,
      });
      recentFrames.push(...result.frames.slice(0, Math.max(0, 10 - recentFrames.length)));

      for (const frame of result.frames) {
        const moduleIds = new Set(frame.module_scope);
        if (moduleIds.has(UNSCOPED_MODULE_ID)) {
          unscopedCount += 1;
        }
        if (!context.policy) continue;

        const unknownForFrame = [...moduleIds].filter(
          (moduleId) => moduleId !== UNSCOPED_MODULE_ID && !policyModules.has(moduleId)
        );
        if (unknownForFrame.length > 0) {
          driftedFrameCount += 1;
        }
        for (const moduleId of unknownForFrame) {
          unknownModules.set(moduleId, (unknownModules.get(moduleId) ?? 0) + 1);
        }
      }

      const nextCursor = result.page.nextCursor ?? undefined;
      if (!nextCursor) break;
      if (seenCursors.has(nextCursor)) {
        throw new Error("FrameStore pagination repeated a cursor during scope-health inspection.");
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor);

    const sortedUnknownModules = [...unknownModules.entries()]
      .sort(([leftId, leftCount], [rightId, rightCount]) => {
        return rightCount - leftCount || leftId.localeCompare(rightId);
      })
      .map(([moduleId, frameCount]) => ({ moduleId, frameCount }));

    return {
      scopeHealth: {
        policy: policyHealth,
        frames: {
          state: "available",
          unscopedCount,
          drift: {
            state: context.policy ? "evaluated" : "not-evaluated",
            frameCount: context.policy ? driftedFrameCount : 0,
            moduleIdCount: context.policy ? sortedUnknownModules.length : 0,
            modules: context.policy
              ? sortedUnknownModules.slice(0, SCOPE_HEALTH_SUMMARY_LIMIT)
              : [],
            summaryLimit: SCOPE_HEALTH_SUMMARY_LIMIT,
            truncated: context.policy
              ? sortedUnknownModules.length > SCOPE_HEALTH_SUMMARY_LIMIT
              : false,
          },
        },
      },
      recentFrames,
    };
  }

  /**
   * Handle introspect tool - discover current Lex state
   */
  private async handleIntrospect(
    args: Record<string, unknown>,
    frameStore: FrameStore,
    context: MCPDispatchWorkspaceContext
  ): Promise<MCPResponse> {
    const { format = "full" } = args as unknown as IntrospectArgs;

    try {
      // Get version from package.json (relative to module location, not cwd)
      const version = getPackageVersion();

      // Get policy information
      const policyData: { modules: string[]; moduleCount: number } | null = context.policy
        ? {
            modules: Object.keys(context.policy.modules).sort(),
            moduleCount: Object.keys(context.policy.modules).length,
          }
        : null;

      // Get state information through a backend-neutral health probe.
      const storeHealth = await frameStore.getHealth();
      const frameCount = storeHealth.healthy ? await this.getFrameCount(frameStore) : 0;
      const { scopeHealth, recentFrames } = await this.inspectScopeHealth(
        frameStore,
        context,
        storeHealth.healthy
      );
      const latestFrame = recentFrames.length > 0 ? recentFrames[0].timestamp : null;

      // Get current branch (if available)
      let currentBranch = "unknown";
      let branchSource = "unknown";
      if (context.trusted) {
        currentBranch = context.sourceRevision?.branch ?? "unknown";
        branchSource = context.sourceRevision?.branch ? "authorized-invocation" : "unknown";
      } else if (process.env.LEX_DEFAULT_BRANCH) {
        currentBranch = getCurrentBranch();
        branchSource = "env:LEX_DEFAULT_BRANCH";
      } else {
        try {
          if (this.repoRoot) {
            currentBranch = getCurrentBranch();
            if (currentBranch !== "unknown") {
              branchSource = "git";
            }
          }
        } catch {
          // If we can't get branch, keep "unknown"
        }
      }
      const frameWriteContract = this.buildMCPFrameWriteContract(
        context,
        recentFrames,
        undefined,
        currentBranch
      );

      const workspaceResolution = {
        path: context.configResolution.workspaceRoot.path,
        source: context.trusted
          ? "authorized-invocation"
          : context.configResolution.workspaceRoot.source === "explicit"
            ? this.repoRoot
              ? "server-option"
              : process.env.LEX_WORKSPACE_ROOT
                ? "env:LEX_WORKSPACE_ROOT"
                : process.env.LEX_APP_ROOT
                  ? "env:LEX_APP_ROOT"
                  : "explicit"
            : context.configResolution.workspaceRoot.source,
      };

      const metadata = frameStore.getMetadata();
      const sqliteIdentity =
        metadata.backend === "sqlite" && !context.trusted
          ? resolveStoreIdentity(metadata.location, this.dbPathSource, workspaceResolution.path)
          : null;
      const storeWarning = sqliteIdentity ? alternateStoreWarning(sqliteIdentity) : null;
      const warnings: Array<{ code: string; message: string }> = [];
      if (storeWarning) {
        warnings.push({ code: "ALTERNATE_STORES_FOUND", message: storeWarning });
      }
      if (!storeHealth.healthy) {
        warnings.push({
          code: "STORE_UNAVAILABLE",
          message: storeHealth.message ?? "The configured FrameStore is unavailable.",
        });
      }
      const runtimeResolution = {
        workspaceRoot: workspaceResolution,
        configFile: context.configResolution.configFile,
        database: {
          backend: metadata.backend,
          path: metadata.location,
          canonicalPath: metadata.canonicalLocation,
          identity: metadata.identity,
          source: this.dbPathSource,
          candidates: sqliteIdentity?.candidates ?? [],
          health: storeHealth,
        },
        policy: {
          path: context.policyResolution?.path ?? null,
          source: context.policyResolution?.source ?? "not-found",
          loaded: context.policy !== null,
        },
        branch: {
          name: currentBranch,
          source: branchSource,
        },
      };

      // Capabilities
      const capabilities = {
        // SQLite database with better-sqlite3-multiple-ciphers supports encryption
        // (though encryption may not be active for all databases)
        encryption: metadata.capabilities.encryption,
        images: metadata.capabilities.images,
      };

      // Error codes - get all MCPErrorCode values and sort for deterministic ordering
      const errorCodes = Object.values(MCPErrorCode).sort();

      // Build error code metadata map for introspection
      const errorCodeMetadata: Record<string, { category: string; retryable: boolean }> = {};
      for (const code of errorCodes) {
        errorCodeMetadata[code] = MCP_ERROR_METADATA[code as MCPErrorCode];
      }

      // Schema version for contract stability
      const schemaVersion = "1.1.0";

      if (format === "compact") {
        // Compact format for small-context agents
        const compactResponse = {
          schemaVersion,
          v: version,
          caps: [] as string[],
          state: {
            frames: frameCount,
            branch: currentBranch,
          },
          ctx: runtimeResolution,
          mods: policyData ? policyData.moduleCount : 0,
          frameWriteContract,
          scopeHealth,
          // Abbreviate error codes and re-sort (abbreviation changes alphabetical order)
          errs: errorCodes.map((code) => this.abbreviateErrorCode(code)).sort(),
          warnings,
        };

        // Add capability abbreviations in deterministic order
        if (capabilities.encryption) compactResponse.caps.push("enc");
        if (capabilities.images) compactResponse.caps.push("img");
        compactResponse.caps.sort();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(compactResponse, null, 2),
            },
          ],
          data: compactResponse,
        };
      } else {
        // Full format
        const fullResponse = {
          schemaVersion,
          version,
          policy: policyData
            ? {
                modules: policyData.modules,
                moduleCount: policyData.moduleCount,
              }
            : null,
          frameWriteContract,
          scopeHealth,
          state: {
            frameCount,
            latestFrame,
            currentBranch,
          },
          resolution: runtimeResolution,
          capabilities,
          errorCodes,
          errorCodeMetadata,
          warnings,
        };

        // Format human-readable output
        let text = `🔍 Lex Introspection\n\n`;
        text += `📐 Schema Version: ${schemaVersion}\n`;
        text += `📦 Version: ${version}\n\n`;

        if (policyData) {
          text += `📋 Policy:\n`;
          text += `  Modules: ${policyData.moduleCount}\n`;
          text += `  Module IDs: ${policyData.modules.join(", ")}\n\n`;
        } else {
          text += `📋 Policy: Not loaded\n\n`;
        }

        text += `✍️  Frame Write Contract:\n`;
        text += `  Required MCP fields: ${frameWriteContract.requiredFields.join(", ")}\n`;
        text += `  Fallback module: ${frameWriteContract.fallback.moduleId}\n`;
        text += `  Fallback input: ${JSON.stringify(frameWriteContract.fallback.input)}\n\n`;

        text += `🩺 Scope Health:\n`;
        text += `  Policy: ${scopeHealth.policy.state} (${scopeHealth.policy.source})\n`;
        text += `  Unscoped Frames: ${scopeHealth.frames.unscopedCount}\n`;
        text += `  Policy-drift Frames: ${scopeHealth.frames.drift.frameCount}\n`;
        text += `  Unknown Module IDs: ${scopeHealth.frames.drift.moduleIdCount}\n`;
        if (scopeHealth.frames.drift.modules.length > 0) {
          text += `  Drift Summary: ${scopeHealth.frames.drift.modules
            .map((item) => `${item.moduleId} (${item.frameCount})`)
            .join(", ")}\n`;
        }
        text += "\n";

        text += `📊 State:\n`;
        text += `  Frames: ${frameCount}\n`;
        text += `  Latest Frame: ${latestFrame || "none"}\n`;
        text += `  Branch: ${currentBranch}\n\n`;

        text += `🧭 Resolution:\n`;
        text += `  Workspace Root: ${runtimeResolution.workspaceRoot.path} (${runtimeResolution.workspaceRoot.source})\n`;
        text += `  Config File: ${runtimeResolution.configFile.path || "none"} (${runtimeResolution.configFile.source})\n`;
        text += `  Database: ${runtimeResolution.database.path} (${runtimeResolution.database.source})\n`;
        text += `  Policy: ${runtimeResolution.policy.path || "none"} (${runtimeResolution.policy.source})\n`;
        text += `  Branch Source: ${runtimeResolution.branch.source}\n\n`;

        for (const warning of warnings) {
          text += `⚠️  ${warning.code}: ${warning.message}\n`;
        }
        if (warnings.length > 0) text += "\n";

        text += `⚙️  Capabilities:\n`;
        text += `  Encryption: ${capabilities.encryption ? "✅" : "❌"}\n`;
        text += `  Images: ${capabilities.images ? "✅" : "❌"}\n\n`;

        text += `🚨 Error Codes (${errorCodes.length}):\n`;
        // Group by category for better readability
        const byCategory: Record<string, string[]> = {
          validation: [],
          storage: [],
          policy: [],
          internal: [],
        };
        for (const code of errorCodes) {
          const metadata = errorCodeMetadata[code];
          byCategory[metadata.category].push(code);
        }
        for (const [category, codes] of Object.entries(byCategory)) {
          if (codes.length > 0) {
            const retryableCount = codes.filter((c) => errorCodeMetadata[c].retryable).length;
            text += `  ${category.toUpperCase()} (${codes.length}, ${retryableCount} retryable):\n`;
            text += `    ${codes.join(", ")}\n`;
          }
        }

        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
          data: fullResponse,
        };
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new MCPError(MCPErrorCode.INTERNAL_ERROR, `Failed to introspect: ${errorMessage}`, {
        error: errorMessage,
      });
    }
  }

  /**
   * Abbreviate error code for compact format
   * Uses a deterministic mapping to avoid collisions
   * Example: VALIDATION_REQUIRED_FIELD -> VAL_REQ_FIE
   */
  private abbreviateErrorCode(code: string): string {
    const parts = code.split("_");
    if (parts.length === 1) return code.substring(0, 3).toUpperCase();
    if (parts.length === 2) {
      // Two parts: use first 3 of each
      return `${parts[0].substring(0, 3)}_${parts[1].substring(0, 3)}`.toUpperCase();
    }
    // Three or more parts: use first, second, and last for consistency
    const first = parts[0].substring(0, 3).toUpperCase();
    const second = parts[1].substring(0, 3).toUpperCase();
    const last = parts[parts.length - 1].substring(0, 3).toUpperCase();
    return `${first}_${second}_${last}`;
  }

  /**
   * Handle help tool - self-documentation for Lex MCP tools (AX #577)
   *
   * Returns structured help including:
   * - Tool descriptions and required fields
   * - Executable examples
   * - Related tools for common workflows
   * - Common workflow patterns
   * - Naming convention guidance (AX-014)
   */
  private async handleHelp(args: Record<string, unknown>, trusted = false): Promise<MCPResponse> {
    const {
      tool: requestedTool,
      examples = true,
      format = "full",
    } = args as {
      tool?: string;
      examples?: boolean;
      format?: string;
    };

    const tool =
      requestedTool && Object.hasOwn(MCP_TOOL_ALIASES, requestedTool)
        ? MCP_TOOL_ALIASES[requestedTool as keyof typeof MCP_TOOL_ALIASES]
        : requestedTool;

    // Define tool help data (using standardized names per ADR-0009)
    const toolHelp: Record<
      string,
      {
        description: string;
        requiredFields: string[];
        optionalFields: string[];
        examples: Array<{ description: string; input: Record<string, unknown> }>;
        microExamples?: Record<string, { in: string; out: string }>;
        relatedTools: string[];
        workflows: string[];
        deprecatedAliases?: string[];
      }
    > = {
      frame_create: {
        description:
          "Store a Frame (episodic memory snapshot) capturing your current work context.",
        requiredFields: ["reference_point", "summary_caption", "status_snapshot", "module_scope"],
        optionalFields: ["branch", "jira", "keywords", "atlas_frame_id", "images"],
        examples: [
          {
            description: "Store work session for authentication refactoring",
            input: {
              reference_point: "Refactoring UserAuth module",
              summary_caption: "Extracted password validation to separate function",
              status_snapshot: {
                next_action: "Add unit tests for new function",
                blockers: [],
                tests_failing: [],
              },
              module_scope: ["memory/store"],
              jira: "AUTH-123",
              keywords: ["refactoring", "authentication"],
            },
          },
          {
            description: "Store debugging session with blockers",
            input: {
              reference_point: "Debugging memory leak in Frame store",
              summary_caption: "Identified leak in SQLite connection pool",
              status_snapshot: {
                next_action: "Review connection cleanup logic",
                blockers: ["Need access to production logs"],
                merge_blockers: ["Waiting for security review"],
              },
              module_scope: ["memory/store", "memory/frames"],
            },
          },
        ],
        microExamples: {
          "store-work": {
            in: "{ref:'Refactoring auth',cap:'Extracted validation',status:{next:'Add tests'},mods:['memory/store']}",
            out: "{ok:true,id:'frame_abc123'}",
          },
          "with-blocker": {
            in: "{ref:'Debug leak',cap:'Found in pool',status:{next:'Review cleanup',blockers:['Need prod logs']},mods:['memory/store']}",
            out: "{ok:true,id:'frame_xyz789'}",
          },
        },
        relatedTools: ["frame_search", "frame_list", "frame_validate"],
        workflows: ["store-then-recall", "timeline-tracking", "validate-before-store"],
        deprecatedAliases: ["remember"],
      },
      frame_validate: {
        description:
          "Validate frame input without storing (dry-run). Use to check inputs before committing.",
        requiredFields: ["reference_point", "summary_caption", "status_snapshot", "module_scope"],
        optionalFields: ["branch", "jira", "keywords", "atlas_frame_id", "images"],
        examples: [
          {
            description: "Validate input before storing",
            input: {
              reference_point: "Test reference",
              summary_caption: "Test summary",
              status_snapshot: { next_action: "Continue testing" },
              module_scope: ["memory/store"],
            },
          },
        ],
        microExamples: {
          validate: {
            in: "{ref:'Test ref',cap:'Test summary',status:{next:'Continue testing'},mods:['memory/store']}",
            out: "{ok:true,valid:true}",
          },
        },
        relatedTools: ["frame_create"],
        workflows: ["validate-before-store"],
        deprecatedAliases: ["validate_remember"],
      },
      frame_search: {
        description:
          "Search Frames by reference point, branch, or Jira ticket. Returns matching Frames with optional Policy Neighborhoods.",
        requiredFields: [],
        optionalFields: ["reference_point", "jira", "branch", "limit"],
        examples: [
          {
            description: "Search by topic",
            input: { reference_point: "authentication refactoring" },
          },
          {
            description: "Filter by Jira ticket",
            input: { jira: "AUTH-123" },
          },
          {
            description: "Filter by branch with limit",
            input: { branch: "feature/auth-refactor", limit: 5 },
          },
        ],
        microExamples: {
          "by-topic": {
            in: "{ref:'authentication refactoring'}",
            out: "{frames:[{id:'f1',ref:'Refactoring auth',cap:'Done'}]}",
          },
          "by-jira": {
            in: "{jira:'AUTH-123'}",
            out: "{frames:[{id:'f2',jira:'AUTH-123'}]}",
          },
          "by-branch": {
            in: "{branch:'feature/auth',limit:5}",
            out: "{frames:[{id:'f3',branch:'feature/auth'}]}",
          },
        },
        relatedTools: ["frame_create", "frame_list", "frame_get"],
        workflows: ["store-then-recall", "context-recovery"],
        deprecatedAliases: ["recall"],
      },
      frame_get: {
        description:
          "Retrieve a specific frame by ID. Use when you know the exact frame ID from a previous response.",
        requiredFields: ["frame_id"],
        optionalFields: ["include_atlas"],
        examples: [
          {
            description: "Get frame by ID",
            input: { frame_id: "frame-abc123" },
          },
          {
            description: "Get frame without Policy Neighborhood context",
            input: { frame_id: "frame-abc123", include_atlas: false },
          },
        ],
        microExamples: {
          "get-by-id": {
            in: "{frame_id:'frame-abc123'}",
            out: "{frame:{id:'frame-abc123',ref:'Auth work',cap:'Done'}}",
          },
          "no-atlas": {
            in: "{frame_id:'frame-abc123',include_atlas:false}",
            out: "{frame:{id:'frame-abc123',ref:'Auth work'}}",
          },
        },
        relatedTools: ["frame_search", "frame_list"],
        workflows: ["direct-frame-access"],
        deprecatedAliases: ["get_frame"],
      },
      frame_list: {
        description:
          "List recent Frames, optionally filtered by branch or module. Good for getting an overview.",
        requiredFields: [],
        optionalFields: ["branch", "module", "limit", "since"],
        examples: [
          {
            description: "List recent frames",
            input: { limit: 10 },
          },
          {
            description: "List frames for a specific branch",
            input: { branch: "main", limit: 5 },
          },
          {
            description: "List frames since a date",
            input: { since: "2024-01-01T00:00:00Z" },
          },
        ],
        microExamples: {
          recent: {
            in: "{limit:10}",
            out: "{frames:[{id:'f1',ref:'Recent work'}]}",
          },
          "by-branch": {
            in: "{branch:'main',limit:5}",
            out: "{frames:[{id:'f2',branch:'main'}]}",
          },
          "by-date": {
            in: "{since:'2024-01-01T00:00:00Z'}",
            out: "{frames:[{id:'f3',created:'2024-01-15'}]}",
          },
        },
        relatedTools: ["frame_search", "timeline_show"],
        workflows: ["timeline-tracking", "context-recovery"],
        deprecatedAliases: ["list_frames"],
      },
      policy_check: {
        description:
          "Validate code against policy rules from lexmap.policy.json. Checks module boundaries and dependencies.",
        requiredFields: [],
        optionalFields: ["path", "policyPath", "strict"],
        examples: [
          {
            description: "Check current directory",
            input: {},
          },
          {
            description: "Check specific path with strict mode",
            input: { path: "./src", strict: true },
          },
        ],
        microExamples: {
          "check-current": {
            in: "{}",
            out: "{ok:true,violations:[]}",
          },
          "check-path": {
            in: "{path:'./src',strict:true}",
            out: "{ok:true,violations:[]}",
          },
        },
        relatedTools: ["system_introspect", "atlas_analyze"],
        workflows: ["pre-commit-check", "ci-validation"],
        deprecatedAliases: [],
      },
      timeline_show: {
        description:
          "Show visual timeline of Frame evolution for a ticket or branch. Great for understanding work history.",
        requiredFields: ["ticketOrBranch"],
        optionalFields: ["since", "until", "format"],
        examples: [
          {
            description: "Show timeline for a Jira ticket",
            input: { ticketOrBranch: "AUTH-123" },
          },
          {
            description: "Show timeline for a branch with date range",
            input: {
              ticketOrBranch: "feature/auth-refactor",
              since: "2024-01-01T00:00:00Z",
              format: "json",
            },
          },
        ],
        microExamples: {
          "by-jira": {
            in: "{ticketOrBranch:'AUTH-123'}",
            out: "{timeline:[{at:'2024-01-15',ref:'Started'}]}",
          },
          "by-branch": {
            in: "{ticketOrBranch:'feature/auth',since:'2024-01-01T00:00:00Z',format:'json'}",
            out: "{timeline:[{at:'2024-01-15',status:'In progress'}]}",
          },
        },
        relatedTools: ["frame_list", "frame_search"],
        workflows: ["timeline-tracking", "context-recovery"],
        deprecatedAliases: ["timeline"],
      },
      atlas_analyze: {
        description:
          "Analyze code structure and dependencies across modules. Visualizes the dependency graph.",
        requiredFields: [],
        optionalFields: ["seedModules", "foldRadius"],
        examples: [
          {
            description: "Analyze memory module dependencies",
            input: { seedModules: ["memory/store"], foldRadius: 2 },
          },
          {
            description: "Analyze multiple modules",
            input: { seedModules: ["memory/store", "memory/mcp"], foldRadius: 1 },
          },
        ],
        microExamples: {
          "single-module": {
            in: "{seedModules:['memory/store'],foldRadius:2}",
            out: "{graph:{nodes:['memory/store'],edges:[]}}",
          },
          "multi-module": {
            in: "{seedModules:['memory/store','memory/mcp'],foldRadius:1}",
            out: "{graph:{nodes:['memory/store','memory/mcp']}}",
          },
        },
        relatedTools: ["policy_check", "system_introspect"],
        workflows: ["dependency-analysis", "refactoring-planning"],
        deprecatedAliases: ["code_atlas"],
      },
      system_introspect: {
        description:
          "Discover the current state of Lex including available modules, policy, frame count, and error codes.",
        requiredFields: [],
        optionalFields: ["format"],
        examples: [
          {
            description: "Get full introspection",
            input: {},
          },
          {
            description: "Get compact format for small-context agents",
            input: { format: "compact" },
          },
        ],
        microExamples: {
          full: {
            in: "{}",
            out: "{modules:['memory','policy'],frameCount:42}",
          },
          compact: {
            in: "{format:'compact'}",
            out: "{mods:['memory','policy'],frames:42}",
          },
        },
        relatedTools: ["help", "policy_check"],
        workflows: ["initial-discovery", "error-handling"],
        deprecatedAliases: ["introspect"],
      },
      help: {
        description:
          "Get usage help for Lex MCP tools including examples, required fields, and workflows.",
        requiredFields: [],
        optionalFields: ["tool", "examples", "format"],
        examples: [
          {
            description: "Get help for all tools",
            input: {},
          },
          {
            description: "Get help for a specific tool",
            input: { tool: "frame_create" },
          },
          {
            description: "Get help without examples",
            input: { tool: "frame_search", examples: false },
          },
        ],
        microExamples: {
          "all-tools": {
            in: "{}",
            out: "{tools:{frame_create:{desc:'Store frame'}}}",
          },
          "single-tool": {
            in: "{tool:'frame_create'}",
            out: "{tool:'frame_create',desc:'Store frame'}",
          },
          "no-examples": {
            in: "{tool:'frame_search',examples:false}",
            out: "{tool:'frame_search',desc:'Search frames'}",
          },
          micro: {
            in: "{tool:'frame_create',format:'micro'}",
            out: "{microExamples:{'store-work':{in:'...',out:'...'}}}",
          },
        },
        relatedTools: ["system_introspect"],
        workflows: ["initial-discovery"],
        deprecatedAliases: [],
      },
      hints_get: {
        description: "Retrieve hint details by hint ID for error recovery guidance.",
        requiredFields: ["hintIds"],
        optionalFields: [],
        examples: [
          {
            description: "Get hints by IDs",
            input: { hintIds: ["hint_mod_invalid_001"] },
          },
        ],
        microExamples: {
          "get-hints": {
            in: "{hintIds:['hint_mod_invalid_001']}",
            out: "{hints:{'hint_mod_invalid_001':{text:'...',actions:[...]}}}",
          },
        },
        relatedTools: ["system_introspect"],
        workflows: ["error-handling"],
        deprecatedAliases: ["get_hints"],
      },
    };

    for (const definition of MCP_TOOLS) {
      if (Object.hasOwn(toolHelp, definition.name)) continue;
      const requiredFields = definition.inputSchema.required ?? [];
      toolHelp[definition.name] = {
        description: definition.description,
        requiredFields,
        optionalFields: Object.keys(definition.inputSchema.properties).filter(
          (field) => !requiredFields.includes(field)
        ),
        examples: [{ description: "Use default options", input: {} }],
        relatedTools: ["help"],
        workflows: [],
      };
    }

    // Define workflow descriptions (updated tool names)
    const workflows: Record<
      string,
      {
        description: string;
        steps: string[];
        tools: string[];
      }
    > = {
      "store-then-recall": {
        description: "Store work context and retrieve it later",
        steps: [
          "Use `frame_create` to store your current work context",
          "Use `frame_search` with reference_point to find it later",
          "Optionally use `frame_get` if you have the exact frame ID",
        ],
        tools: ["frame_create", "frame_search", "frame_get"],
      },
      "timeline-tracking": {
        description: "Track work evolution over time for a ticket or branch",
        steps: [
          "Use `frame_create` regularly to capture work progress",
          "Use `timeline_show` to visualize the evolution",
          "Use `frame_list` to see recent work",
        ],
        tools: ["frame_create", "timeline_show", "frame_list"],
      },
      "validate-before-store": {
        description: "Validate inputs before committing to storage",
        steps: [
          "Use `frame_validate` to check your inputs",
          "Fix any validation errors",
          "Use `frame_create` to store the validated frame",
        ],
        tools: ["frame_validate", "frame_create"],
      },
      "context-recovery": {
        description: "Recover context when resuming work",
        steps: [
          "Use `frame_search` to search for relevant frames",
          "Use `timeline_show` to see work history",
          "Use `frame_get` to get detailed frame content",
        ],
        tools: ["frame_search", "timeline_show", "frame_get"],
      },
      "initial-discovery": {
        description: "Discover Lex capabilities when starting",
        steps: [
          "Use `help` to understand available tools",
          "Use `system_introspect` to see system state and available modules",
          "Use `frame_search` or `frame_list` to see existing memory",
        ],
        tools: ["help", "system_introspect", "frame_search", "frame_list"],
      },
      "dependency-analysis": {
        description: "Understand code structure and dependencies",
        steps: [
          "Use `system_introspect` to see available modules",
          "Use legacy-named `atlas_analyze` to extract the experimental Code Index",
          "Use `policy_check` to validate boundaries",
        ],
        tools: ["system_introspect", "atlas_analyze", "policy_check"],
      },
      "pre-commit-check": {
        description: "Validate code before committing",
        steps: [
          "Use `policy_check` to validate module boundaries",
          "Fix any policy violations",
          "Use `frame_create` to capture the work context",
        ],
        tools: ["policy_check", "frame_create"],
      },
    };

    // Build response based on requested tool
    if (tool) {
      // Get help for a specific tool
      const helpData = Object.hasOwn(toolHelp, tool) ? toolHelp[tool] : undefined;
      if (!helpData) {
        throw new MCPError(MCPErrorCode.VALIDATION_INVALID_FORMAT, `Unknown tool: ${tool}`, {
          requestedTool: tool,
          availableTools: Object.keys(toolHelp),
        });
      }
      const optionalFields =
        trusted && (tool === "frame_create" || tool === "frame_validate")
          ? helpData.optionalFields.filter((field) => field !== "images")
          : helpData.optionalFields;

      const response: Record<string, unknown> = {
        tool,
        description: helpData.description,
        requiredFields: helpData.requiredFields,
        optionalFields,
        relatedTools: helpData.relatedTools,
        workflows: helpData.workflows.map((w) => ({
          name: w,
          description: workflows[w]?.description || w,
        })),
      };
      const hasFrameWriteContract = tool === "frame_create" || tool === "frame_validate";
      if (hasFrameWriteContract) {
        response.frameWriteContract = {
          requiredFields: MCP_FRAME_REQUIRED_FIELDS,
          policyState: "discover-via-system_introspect",
          fallback: {
            moduleId: UNSCOPED_MODULE_ID,
            input: fallbackRemediation().input,
          },
        };
      }

      if (examples) {
        if (format === "micro" && helpData.microExamples) {
          response.microExamples = helpData.microExamples;
        } else {
          response.examples = helpData.examples;
        }
      }

      // Format text output
      const textOutput = [`# ${tool}`, "", helpData.description, ""];

      // Add deprecated alias notice if applicable (AX-014)
      if (helpData.deprecatedAliases && helpData.deprecatedAliases.length > 0) {
        textOutput.push(
          "## Deprecated Aliases",
          helpData.deprecatedAliases
            .map((alias) => `  - \`${alias}\` (use \`${tool}\` instead)`)
            .join("\n"),
          "",
          "See ADR-0009 for the naming convention migration guide.",
          ""
        );
      }

      textOutput.push(
        "## Required Fields",
        helpData.requiredFields.length > 0
          ? helpData.requiredFields.map((f) => `  - ${f}`).join("\n")
          : "  (none)",
        "",
        "## Optional Fields",
        optionalFields.length > 0 ? optionalFields.map((f) => `  - ${f}`).join("\n") : "  (none)",
        "",
        "## Related Tools",
        helpData.relatedTools.map((t) => `  - ${t}`).join("\n"),
        "",
        "## Workflows",
        helpData.workflows.map((w) => `  - ${w}: ${workflows[w]?.description || ""}`).join("\n")
      );

      if (hasFrameWriteContract) {
        textOutput.push(
          "",
          "## Frame Write Fallback",
          `  Module: ${UNSCOPED_MODULE_ID}`,
          `  Exact input: ${JSON.stringify(fallbackRemediation().input)}`,
          "  Use this explicit fallback only when no policy-backed module applies."
        );
      }

      if (examples) {
        if (format === "micro" && helpData.microExamples) {
          textOutput.push(
            "",
            "## Micro Examples",
            ...Object.entries(helpData.microExamples)
              .map(([name, example]) => [
                `**${name}**`,
                `  in:  ${example.in}`,
                `  out: ${example.out}`,
              ])
              .flat()
          );
        } else if (helpData.examples.length > 0) {
          textOutput.push(
            "",
            "## Examples",
            ...helpData.examples
              .map((ex, i) => [
                `### Example ${i + 1}: ${ex.description}`,
                "```json",
                JSON.stringify(ex.input, null, 2),
                "```",
              ])
              .flat()
          );
        }
      }

      return {
        content: [
          {
            type: "text",
            text: textOutput.join("\n"),
          },
        ],
        data: response,
      };
    } else {
      // Get help for all tools
      const response: Record<string, unknown> = {
        tools: Object.fromEntries(
          Object.entries(toolHelp).map(([name, data]) => {
            const toolData: Record<string, unknown> = {
              description: data.description,
              requiredFields: data.requiredFields,
              relatedTools: data.relatedTools,
            };
            if (name === "frame_create" || name === "frame_validate") {
              toolData.frameWriteContract = {
                fallback: {
                  moduleId: UNSCOPED_MODULE_ID,
                  input: fallbackRemediation().input,
                },
              };
            }
            if (examples && data.examples.length > 0) {
              toolData.examples = data.examples;
            }
            return [name, toolData];
          })
        ),
        workflows: Object.fromEntries(
          Object.entries(workflows).map(([name, data]) => [
            name,
            { description: data.description, tools: data.tools },
          ])
        ),
      };

      // Format text output
      const textOutput = [
        "# Lex MCP Tools Help",
        "",
        "## Naming Convention (ADR-0009)",
        "",
        "All tools follow the **resource_action** pattern for predictability:",
        "  - `frame_create` (create a frame)",
        "  - `frame_search` (search frames)",
        "  - `frame_list` (list frames)",
        "  - `frame_get` (get a specific frame)",
        "",
        "Old names (remember, recall, etc.) are deprecated but still work.",
        "You'll see deprecation warnings when using old names.",
        "",
        "## Available Tools",
        ...Object.entries(toolHelp).map(
          ([name, data]) => `  - **${name}**: ${data.description.split(".")[0]}`
        ),
        "",
        "## Common Workflows",
        ...Object.entries(workflows).map(([name, data]) => `  - **${name}**: ${data.description}`),
        "",
        'Use `help(tool: "<name>")` for detailed help on a specific tool.',
      ];

      return {
        content: [
          {
            type: "text",
            text: textOutput.join("\n"),
          },
        ],
        data: response,
      };
    }
  }

  /**
   * Get total frame count from database.
   * Uses FrameStore.getFrameCount() interface method.
   */
  private async getFrameCount(frameStore: FrameStore): Promise<number> {
    try {
      return await frameStore.getFrameCount();
    } catch {
      return 0;
    }
  }

  /**
   * Handle get_hints tool - retrieve hint details by hint IDs
   *
   * Per AX-012, provides cacheable advice snippets for error recovery.
   * Agents can fetch hints once and cache them to minimize token usage.
   */
  private async handleGetHints(args: Record<string, unknown>): Promise<MCPResponse> {
    const typedArgs = args as Partial<GetHintsArgs>;
    const { hintIds } = typedArgs;

    if (!hintIds || !Array.isArray(hintIds)) {
      throw new MCPError(MCPErrorCode.VALIDATION_REQUIRED_FIELD, "hintIds array is required", {
        field: "hintIds",
      });
    }

    if (hintIds.length === 0) {
      throw new MCPError(MCPErrorCode.VALIDATION_INVALID_FORMAT, "hintIds array cannot be empty", {
        field: "hintIds",
      });
    }

    // Import hint registry utilities
    const { getHints } = await import("../../shared/errors/hint-registry.js");

    const hints = getHints(hintIds);

    // Check which hints were not found
    const notFound = hintIds.filter((id) => !(id in hints));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              hints,
              ...(notFound.length > 0 && { notFound }),
            },
            null,
            2
          ),
        },
      ],
      data: {
        hints,
        ...(notFound.length > 0 && { notFound }),
      },
    };
  }

  /**
   * Handle db_stats tool - get database statistics
   */
  private async handleDbStats(
    args: Record<string, unknown>,
    frameStore: FrameStore
  ): Promise<MCPResponse> {
    const { detailed = false } = args as { detailed?: boolean };

    // Get store statistics through the FrameStore interface (no raw db access)
    const storeStats = await frameStore.getStats(detailed);

    const result: Record<string, unknown> = {
      store: frameStore.getMetadata(),
      health: await frameStore.getHealth(),
      frames: {
        total: storeStats.totalFrames,
        thisWeek: storeStats.thisWeek,
        thisMonth: storeStats.thisMonth,
        dateRange: {
          oldest: storeStats.oldestDate,
          newest: storeStats.newestDate,
        },
      },
    };

    // Add database file info when backed by SQLite
    if (frameStore instanceof SqliteFrameStore) {
      const { existsSync, statSync } = await import("fs");
      const dbPath = frameStore.db.name;
      if (existsSync(dbPath)) {
        const fileStats = statSync(dbPath);
        const sizeBytes = fileStats.size;
        const sizeMB = parseFloat((sizeBytes / (1024 * 1024)).toFixed(2));
        result.database = { path: dbPath, sizeBytes, sizeMB };
      }
    }

    // Add module distribution if detailed and available
    if (storeStats.moduleDistribution) {
      result.moduleDistribution = storeStats.moduleDistribution;
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      data: result,
    };
  }

  /**
   * Handle turncost_calculate tool - calculate turn cost metrics
   */
  private async handleTurncostCalculate(
    args: Record<string, unknown>,
    frameStore: FrameStore
  ): Promise<MCPResponse> {
    const { period = "24h" } = args as { period?: string };

    // Parse period to ISO timestamp
    let sinceTimestamp: string;

    if (period.match(/^\d{4}-\d{2}-\d{2}T/)) {
      // Already an ISO timestamp
      sinceTimestamp = period;
    } else {
      // Parse duration strings (e.g., "24h", "7d", "30d")
      const match = period.match(/^(\d+)(h|d|w|m)$/);
      if (!match) {
        throw new MCPError(
          MCPErrorCode.VALIDATION_INVALID_FORMAT,
          `Invalid period format: ${period}. Use format like "24h", "7d", "30d" or ISO 8601 timestamp`,
          { field: "period", provided: period }
        );
      }

      const value = parseInt(match[1], 10);
      const unit = match[2];
      const now = new Date();

      switch (unit) {
        case "h":
          now.setHours(now.getHours() - value);
          break;
        case "d":
          now.setDate(now.getDate() - value);
          break;
        case "w":
          now.setDate(now.getDate() - value * 7);
          break;
        case "m":
          now.setMonth(now.getMonth() - value);
          break;
      }

      sinceTimestamp = now.toISOString();
    }

    // Use the FrameStore interface for turn cost metrics (no raw db access)
    const metrics = await frameStore.getTurnCostMetrics(sinceTimestamp);

    const result = {
      period,
      since: sinceTimestamp,
      turnCost: {
        frames: metrics.frameCount,
        estimatedTokens: metrics.estimatedTokens,
        prompts: metrics.prompts,
      },
      derived: {
        avgTokensPerFrame:
          metrics.frameCount > 0 ? Math.round(metrics.estimatedTokens / metrics.frameCount) : 0,
      },
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      data: result,
    };
  }

  /**
   * Handle contradictions_scan tool - scan for frame contradictions
   */
  private async handleContradictionsScan(
    args: Record<string, unknown>,
    frameStore: FrameStore
  ): Promise<MCPResponse> {
    const { module, limit = 10000 } = args as { module?: string; limit?: number };

    // Get frames from store
    const result = await frameStore.listFrames({ limit });
    const frames = result.frames;

    if (frames.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { contradictions: [], totalFrames: 0, moduleFilter: module },
              null,
              2
            ),
          },
        ],
        data: { contradictions: [], totalFrames: 0, moduleFilter: module },
      };
    }

    // Import contradiction scanning
    const { scanForContradictions } = await import("../contradictions.js");

    const contradictions = scanForContradictions(frames, module);

    const scanResult = {
      totalFrames: frames.length,
      moduleFilter: module || null,
      contradictionsFound: contradictions.length,
      contradictions: contradictions.map((c) => {
        const frameA = frames.find((f) => f.id === c.frameA);
        const frameB = frames.find((f) => f.id === c.frameB);
        return {
          frameA: {
            id: frameA?.id,
            timestamp: frameA?.timestamp,
            summary: frameA?.summary_caption,
            modules: frameA?.module_scope,
          },
          frameB: {
            id: frameB?.id,
            timestamp: frameB?.timestamp,
            summary: frameB?.summary_caption,
            modules: frameB?.module_scope,
          },
          signal: c.signal,
          moduleOverlap: c.moduleOverlap,
        };
      }),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(scanResult, null, 2) }],
      data: scanResult,
    };
  }

  /**
   * Close the server and release resources.
   * Properly closes the FrameStore on shutdown.
   */
  async close(): Promise<void> {
    await this.frameStore?.close();
  }
}
