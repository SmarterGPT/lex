import type { CapabilityId } from "./ids.js";

export const RUNTIME_OPERATION_CAPABILITIES = Object.freeze({
  FRAME_READ: "frame:read" as CapabilityId,
  FRAME_WRITE: "frame:write" as CapabilityId,
  FRAME_DELETE: "frame:delete" as CapabilityId,
  FRAME_ADMIN: "frame:admin" as CapabilityId,
  BEHAVIOR_READ: "behavior:read" as CapabilityId,
  BEHAVIOR_WRITE: "behavior:write" as CapabilityId,
  BEHAVIOR_PROMOTE: "behavior:promote" as CapabilityId,
  BEHAVIOR_PROVENANCE: "behavior:provenance" as CapabilityId,
  WORKSPACE_BIND: "workspace:bind" as CapabilityId,
  WORKSPACE_INSPECT: "workspace:inspect" as CapabilityId,
  WORKSPACE_REBIND: "workspace:rebind" as CapabilityId,
  WORKSPACE_REVOKE: "workspace:revoke" as CapabilityId,
  WORKSPACE_RECOVER: "workspace:recover" as CapabilityId,
});

export type TrustedCliOperation =
  | "help"
  | "version"
  | "init"
  | "remember"
  | "destination"
  | "recall"
  | "context"
  | "check"
  | "timeline"
  | "frames:export"
  | "frames:import"
  | "db:vacuum"
  | "db:backup"
  | "db:repair"
  | "db:scope:inventory"
  | "db:scope:manifest"
  | "db:scope:migrate"
  | "db:scope:recover"
  | "db:encrypt"
  | "db:stats"
  | "policy:check"
  | "policy:generate"
  | "policy:add-module"
  | "instructions:init"
  | "instructions:generate"
  | "instructions:check"
  | "knowledge:check"
  | "knowledge:index"
  | "knowledge:context"
  | "knowledge:explain"
  | "code-atlas"
  | "turncost"
  | "dedupe"
  | "check-contradictions"
  | "epic:sync"
  | "wave:complete"
  | "introspect"
  | "hints"
  | "workspace:bind"
  | "workspace:inspect"
  | "workspace:rebind"
  | "workspace:revoke"
  | "workspace:recover";

const CLI_CAPABILITIES: Readonly<Record<TrustedCliOperation, readonly CapabilityId[]>> =
  Object.freeze({
    help: Object.freeze([]),
    version: Object.freeze([]),
    init: Object.freeze([]),
    // Authorize the intended remember operation without reading or mutating Frames.
    destination: Object.freeze([
      RUNTIME_OPERATION_CAPABILITIES.FRAME_READ,
      RUNTIME_OPERATION_CAPABILITIES.FRAME_WRITE,
    ]),
    remember: Object.freeze([
      RUNTIME_OPERATION_CAPABILITIES.FRAME_READ,
      RUNTIME_OPERATION_CAPABILITIES.FRAME_WRITE,
    ]),
    recall: Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_READ]),
    context: Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_READ]),
    check: Object.freeze([]),
    timeline: Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_READ]),
    "frames:export": Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_READ]),
    "frames:import": Object.freeze([
      RUNTIME_OPERATION_CAPABILITIES.FRAME_READ,
      RUNTIME_OPERATION_CAPABILITIES.FRAME_WRITE,
    ]),
    "db:vacuum": Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_ADMIN]),
    "db:backup": Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_ADMIN]),
    "db:repair": Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_ADMIN]),
    "db:scope:inventory": Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_ADMIN]),
    "db:scope:manifest": Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_ADMIN]),
    "db:scope:migrate": Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_ADMIN]),
    "db:scope:recover": Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_ADMIN]),
    "db:encrypt": Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_ADMIN]),
    "db:stats": Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_READ]),
    "policy:check": Object.freeze([]),
    "policy:generate": Object.freeze([]),
    "policy:add-module": Object.freeze([]),
    "instructions:init": Object.freeze([]),
    "instructions:generate": Object.freeze([]),
    "instructions:check": Object.freeze([]),
    "knowledge:check": Object.freeze([]),
    "knowledge:index": Object.freeze([]),
    "knowledge:context": Object.freeze([]),
    "knowledge:explain": Object.freeze([]),
    "code-atlas": Object.freeze([]),
    turncost: Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_READ]),
    dedupe: Object.freeze([
      RUNTIME_OPERATION_CAPABILITIES.FRAME_READ,
      RUNTIME_OPERATION_CAPABILITIES.FRAME_WRITE,
      RUNTIME_OPERATION_CAPABILITIES.FRAME_DELETE,
    ]),
    "check-contradictions": Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_READ]),
    "epic:sync": Object.freeze([]),
    "wave:complete": Object.freeze([
      RUNTIME_OPERATION_CAPABILITIES.FRAME_READ,
      RUNTIME_OPERATION_CAPABILITIES.FRAME_WRITE,
    ]),
    introspect: Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_READ]),
    hints: Object.freeze([]),
    "workspace:bind": Object.freeze([RUNTIME_OPERATION_CAPABILITIES.WORKSPACE_BIND]),
    "workspace:inspect": Object.freeze([RUNTIME_OPERATION_CAPABILITIES.WORKSPACE_INSPECT]),
    "workspace:rebind": Object.freeze([RUNTIME_OPERATION_CAPABILITIES.WORKSPACE_REBIND]),
    "workspace:revoke": Object.freeze([RUNTIME_OPERATION_CAPABILITIES.WORKSPACE_REVOKE]),
    "workspace:recover": Object.freeze([RUNTIME_OPERATION_CAPABILITIES.WORKSPACE_RECOVER]),
  });

export const TRUSTED_CLI_OPERATIONS = Object.freeze(
  Object.keys(CLI_CAPABILITIES).sort() as TrustedCliOperation[]
);
export const TRUSTED_CLI_CONTROL_OPERATIONS = Object.freeze([
  "help",
  "version",
] as const satisfies readonly TrustedCliOperation[]);

const CLI_GLOBAL_OPTIONS_WITH_VALUE = new Set(["--diagnostic-level"]);
const CLI_GLOBAL_OPTIONS = new Set(["--json", "--verbose", "--diagnostic"]);
const CLI_GROUPS = new Set([
  "frames",
  "db",
  "policy",
  "instructions",
  "knowledge",
  "epic",
  "wave",
  "workspace",
]);

export class UnknownTrustedOperationError extends Error {
  constructor(
    public readonly surface: "cli" | "mcp",
    public readonly operation: string
  ) {
    super(`Unknown trusted ${surface.toUpperCase()} operation: ${operation || "<missing>"}.`);
    this.name = "UnknownTrustedOperationError";
  }
}

function commandTokens(argv: readonly string[]): readonly string[] {
  const boundary = argv.indexOf("--");
  const runtimeArguments = boundary === -1 ? argv : argv.slice(0, boundary);
  const result: string[] = [];
  for (let index = 2; index < runtimeArguments.length; index += 1) {
    const argument = runtimeArguments[index];
    if (CLI_GLOBAL_OPTIONS.has(argument)) continue;
    if (argument.startsWith("--diagnostic-level=")) continue;
    if (CLI_GLOBAL_OPTIONS_WITH_VALUE.has(argument)) {
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) continue;
    result.push(argument);
    if (!CLI_GROUPS.has(result[0])) break;
    if (result.length === 2 && !(result[0] === "db" && result[1] === "scope")) break;
    if (result.length === 3) break;
  }
  return Object.freeze(result);
}

/** Resolve one exact CLI operation without allowing unknown commands to inherit authority. */
export function trustedCliOperationFromArgv(argv: readonly string[]): TrustedCliOperation {
  const boundary = argv.indexOf("--");
  const runtimeArguments = boundary === -1 ? argv : argv.slice(0, boundary);
  if (runtimeArguments.includes("--help") || runtimeArguments.includes("-h")) return "help";
  if (runtimeArguments.includes("--version") || runtimeArguments.includes("-V")) return "version";
  const tokens = commandTokens(argv);
  if (tokens.length === 0) return "help";
  const operation = CLI_GROUPS.has(tokens[0] ?? "") ? tokens.join(":") : tokens[0];
  if (!operation || !(operation in CLI_CAPABILITIES)) {
    throw new UnknownTrustedOperationError("cli", operation ?? "");
  }
  return operation as TrustedCliOperation;
}

export function capabilitiesForCliOperation(
  operation: TrustedCliOperation
): readonly CapabilityId[] {
  return CLI_CAPABILITIES[operation];
}

/** Apply flag-level attenuation for CLI operations with explicit dry-run modes. */
export function capabilitiesForCliInvocation(argv: readonly string[]): readonly CapabilityId[] {
  const operation = trustedCliOperationFromArgv(argv);
  const boundary = argv.indexOf("--");
  const runtimeArguments = boundary === -1 ? argv : argv.slice(0, boundary);
  if (runtimeArguments.includes("--dry-run")) {
    if (operation === "remember" || operation === "frames:import" || operation === "dedupe") {
      return Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_READ]);
    }
  }
  return capabilitiesForCliOperation(operation);
}

export const MCP_TOOL_ALIASES = Object.freeze({
  remember: "frame_create",
  lex_remember: "frame_create",
  validate_remember: "frame_validate",
  lex_validate_remember: "frame_validate",
  recall: "frame_search",
  lex_recall: "frame_search",
  get_frame: "frame_get",
  lex_get_frame: "frame_get",
  list_frames: "frame_list",
  lex_list_frames: "frame_list",
  lex_policy_check: "policy_check",
  timeline: "timeline_show",
  lex_timeline: "timeline_show",
  code_atlas: "atlas_analyze",
  lex_code_atlas: "atlas_analyze",
  introspect: "system_introspect",
  lex_introspect: "system_introspect",
  get_hints: "hints_get",
  lex_help: "help",
} as const);

export type CanonicalMcpTool =
  | "frame_create"
  | "destination_inspect"
  | "frame_validate"
  | "frame_search"
  | "frame_get"
  | "frame_list"
  | "policy_check"
  | "timeline_show"
  | "atlas_analyze"
  | "system_introspect"
  | "help"
  | "hints_get"
  | "db_stats"
  | "turncost_calculate"
  | "contradictions_scan";

const MCP_CAPABILITIES: Readonly<Record<CanonicalMcpTool, readonly CapabilityId[]>> = Object.freeze(
  {
    destination_inspect: Object.freeze([
      RUNTIME_OPERATION_CAPABILITIES.FRAME_READ,
      RUNTIME_OPERATION_CAPABILITIES.FRAME_WRITE,
    ]),
    frame_create: Object.freeze([
      RUNTIME_OPERATION_CAPABILITIES.FRAME_READ,
      RUNTIME_OPERATION_CAPABILITIES.FRAME_WRITE,
    ]),
    frame_validate: Object.freeze([]),
    frame_search: Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_READ]),
    frame_get: Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_READ]),
    frame_list: Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_READ]),
    policy_check: Object.freeze([]),
    timeline_show: Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_READ]),
    atlas_analyze: Object.freeze([]),
    system_introspect: Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_READ]),
    help: Object.freeze([]),
    hints_get: Object.freeze([]),
    db_stats: Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_READ]),
    turncost_calculate: Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_READ]),
    contradictions_scan: Object.freeze([RUNTIME_OPERATION_CAPABILITIES.FRAME_READ]),
  }
);

export const CANONICAL_MCP_TOOLS = Object.freeze(
  Object.keys(MCP_CAPABILITIES).sort() as CanonicalMcpTool[]
);

export function canonicalMcpToolName(toolName: string): CanonicalMcpTool {
  const canonical =
    (MCP_TOOL_ALIASES as Readonly<Record<string, CanonicalMcpTool>>)[toolName] ?? toolName;
  if (!(canonical in MCP_CAPABILITIES)) {
    throw new UnknownTrustedOperationError("mcp", toolName);
  }
  return canonical as CanonicalMcpTool;
}

/** Resolve exact MCP capabilities, including deprecated aliases, and fail closed on unknown tools. */
export function capabilitiesForMcpTool(toolName: string): readonly CapabilityId[] {
  return MCP_CAPABILITIES[canonicalMcpToolName(toolName)];
}
