export const PUBLIC_API_CONTRACT_VERSION = 1;

/**
 * Every package export is a public, semver-governed entry point. The anchors
 * are intentionally small: they catch empty or misdirected barrels without
 * freezing every additive export in the module.
 */
export const PUBLIC_EXPORT_CONTRACT = Object.freeze([
  {
    subpath: ".",
    purpose: "Core types, trusted scope, and compatibility store API",
    anchors: ["FRAME_SCHEMA_VERSION", "RUNTIME_SCOPE_CONTRACT_VERSION", "saveFrame"],
  },
  {
    subpath: "./context",
    purpose: "Bounded canonical session context without CLI or MCP startup",
    anchors: ["buildSessionContext", "renderSessionContextText"],
  },
  { subpath: "./cli", purpose: "Programmatic CLI construction", anchors: ["createProgram", "run"] },
  {
    subpath: "./cli-output",
    purpose: "Structured CLI output helpers",
    anchors: ["createOutput", "json"],
  },
  {
    subpath: "./types",
    purpose: "Shared Frame and policy types and validators",
    anchors: ["FRAME_SCHEMA_VERSION", "FrameSchema", "createFrame"],
  },
  {
    subpath: "./runtime-scope",
    purpose: "Trusted identity, authority, binding, and diagnostics",
    anchors: ["RUNTIME_SCOPE_CONTRACT_VERSION", "resolveRuntimeScope"],
  },
  {
    subpath: "./normative-policy",
    purpose: "Typed normative policy contracts, canonicalization, and conformance fixtures",
    anchors: [
      "NORMATIVE_POLICY_CONTRACT_VERSION",
      "PolicyDeclarationV1Schema",
      "checkPolicyDeclarationAuthorityDecisionBindingV1",
      "computePolicyDeclarationDigestV1",
      "createPolicyResolverV1",
      "EffectivePolicySnapshotV1Schema",
    ],
  },
  {
    subpath: "./errors",
    purpose: "AXError schemas, codes, and hints",
    anchors: ["AXErrorSchema", "LEX_ERROR_CODES"],
  },
  {
    subpath: "./policy",
    purpose: "Policy loading and validation",
    anchors: ["loadPolicy", "validatePolicySchema"],
  },
  {
    subpath: "./atlas",
    purpose: "Legacy compatibility barrel for Policy Neighborhood, Frame Graph, and Code Index",
    anchors: ["generateAtlasFrame", "buildPolicyGraph"],
  },
  {
    subpath: "./atlas/code-unit",
    purpose: "Code-unit schemas and validation",
    anchors: ["CodeUnitSchema", "parseCodeUnit"],
  },
  {
    subpath: "./atlas/schemas",
    purpose: "Code Index run and policy-seed schemas",
    anchors: ["CodeAtlasRunSchema", "parseCodeAtlasRun"],
  },
  {
    subpath: "./module-ids",
    purpose: "Module identifier validation",
    anchors: ["validateModuleIds"],
  },
  {
    subpath: "./aliases",
    purpose: "Module alias resolution",
    anchors: ["resolveModuleId", "clearAliasTableCache"],
  },
  {
    subpath: "./store",
    purpose: "Legacy FrameStore and authorized scoped persistence adapters",
    anchors: [
      "FRAME_STORE_SCOPE_CONTRACT_VERSION",
      "SqliteScopedFrameStoreBackend",
      "PostgresScopedFrameStoreBackend",
      "BEHAVIORAL_STORE_CONTRACT_VERSION",
      "SqliteBehavioralStoreBackend",
      "openPostgresBehavioralStore",
    ],
  },
  { subpath: "./dedup", purpose: "Frame duplicate detection", anchors: ["detectDuplicateFrames"] },
  { subpath: "./similarity", purpose: "Frame similarity scoring", anchors: ["computeSimilarity"] },
  {
    subpath: "./consolidation",
    purpose: "Frame consolidation operations",
    anchors: ["consolidateViaMerge", "consolidateViaSupersede"],
  },
  {
    subpath: "./contradictions",
    purpose: "Frame contradiction detection",
    anchors: ["detectContradiction"],
  },
  {
    subpath: "./maintenance",
    purpose: "Combined Frame maintenance API",
    anchors: ["detectDuplicateFrames", "scanForContradictions"],
  },
  { subpath: "./memory", purpose: "Frame payload validation", anchors: ["validateFramePayload"] },
  {
    subpath: "./memory/receipts",
    purpose: "Execution receipt creation and schemas",
    anchors: ["RECEIPT_SCHEMA_VERSION", "createReceipt"],
  },
  {
    subpath: "./memory/receipts/validator",
    purpose: "Receipt payload validation",
    anchors: ["validateReceiptPayload"],
  },
  { subpath: "./logger", purpose: "Structured logging", anchors: ["getLogger", "getNDJSONLogger"] },
  {
    subpath: "./prompts",
    purpose: "Prompt template loading and rendering",
    anchors: ["PROMPTS_API_VERSION", "renderPrompt"],
  },
  {
    subpath: "./lexsona",
    purpose: "Behavioral-memory integration",
    anchors: ["LEXSONA_DEFAULTS", "getRules"],
  },
  {
    subpath: "./knowledge",
    purpose: "KnowledgeFrame contract and deterministic Markdown compiler",
    anchors: [
      "KNOWLEDGE_FRAME_SCHEMA_VERSION",
      "KnowledgeFrameV1Schema",
      "compileKnowledgeSnapshot",
    ],
  },
  { subpath: "./mcp-server", purpose: "Embeddable MCP server", anchors: ["MCPServer"] },
  {
    subpath: "./schemas/cli-output.v1.schema.json",
    purpose: "Versioned CLI output JSON Schema",
    anchors: [],
  },
  {
    subpath: "./schemas/ecosystem-release-v1.schema.json",
    purpose: "Ecosystem release manifest JSON Schema",
    anchors: [],
  },
  {
    subpath: "./schemas/feature-spec-v0.json",
    purpose: "Versioned feature specification JSON Schema",
    anchors: [],
  },
  { subpath: "./schemas/profile.schema.json", purpose: "Lex profile JSON Schema", anchors: [] },
]);

export function packageSpecifier(packageName, subpath) {
  return subpath === "." ? packageName : `${packageName}${subpath.slice(1)}`;
}
