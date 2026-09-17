import { CANONICAL_MCP_TOOLS, MCP_TOOL_ALIASES } from "../../shared/runtime-scope/capabilities.js";

/**
 * MCP Tools for Frame Memory
 *
 * Defines the tools exposed via Model Context Protocol for AI assistants.
 * Frame tools can include an optional Policy Neighborhood through legacy AtlasFrame fields.
 */

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    required?: string[];
    properties: Record<string, unknown>;
  };
}

/**
 * Tool definitions for MCP protocol
 *
 * Following ADR-0009, tools use the resource_action naming convention.
 * Old names (remember, recall, etc.) are maintained as aliases in server.ts.
 */
export const MCP_TOOLS: MCPTool[] = [
  {
    name: "frame_create",
    description: "Store a Frame (episodic memory snapshot). Alias: remember (deprecated)",
    inputSchema: {
      type: "object",
      required: ["reference_point", "summary_caption", "status_snapshot", "module_scope"],
      properties: {
        reference_point: {
          type: "string",
          description: 'What you were working on (e.g., "refactoring UserAuth module")',
        },
        summary_caption: {
          type: "string",
          description:
            'One-line summary of progress (e.g., "Extracted password validation to separate function")',
        },
        status_snapshot: {
          type: "object",
          description:
            "Current state: {next_action: string, blockers?: [], merge_blockers?: [], tests_failing?: []}",
          properties: {
            next_action: { type: "string" },
            blockers: { type: "array", items: { type: "string" } },
            merge_blockers: { type: "array", items: { type: "string" } },
            tests_failing: { type: "array", items: { type: "string" } },
          },
          required: ["next_action"],
        },
        module_scope: {
          type: "array",
          items: { type: "string" },
          description:
            'Module IDs from lexmap.policy.json. If no policy-backed module applies, use the exact fallback ["workspace/unscoped"].',
        },
        branch: {
          type: "string",
          description: "Git branch (defaults to current branch)",
        },
        jira: {
          type: "string",
          description: 'Optional Jira/issue ticket (e.g., "PROJ-123")',
        },
        keywords: {
          type: "array",
          items: { type: "string" },
          description: 'Optional search tags (e.g., ["refactoring", "authentication"])',
        },
        atlas_frame_id: {
          type: "string",
          description: "Legacy reference to a Policy Neighborhood snapshot",
        },
        images: {
          type: "array",
          items: {
            type: "object",
            properties: {
              data: {
                type: "string",
                description: "Base64-encoded image data",
              },
              mime_type: {
                type: "string",
                description: 'MIME type (e.g., "image/png", "image/jpeg")',
              },
            },
            required: ["data", "mime_type"],
          },
          description: "Optional array of image attachments (base64-encoded with MIME type)",
        },
        request_id: {
          type: "string",
          description:
            "Optional idempotency key. If provided, duplicate calls with the same request_id will return the cached response instead of creating a new frame. Useful for safely retrying tool calls.",
        },
      },
    },
  },
  {
    name: "frame_validate",
    description:
      "Validate frame input without storing (dry-run validation). Alias: validate_remember (deprecated)",
    inputSchema: {
      type: "object",
      required: ["reference_point", "summary_caption", "status_snapshot", "module_scope"],
      properties: {
        reference_point: {
          type: "string",
          description: 'What you were working on (e.g., "refactoring UserAuth module")',
        },
        summary_caption: {
          type: "string",
          description:
            'One-line summary of progress (e.g., "Extracted password validation to separate function")',
        },
        status_snapshot: {
          type: "object",
          description:
            "Current state: {next_action: string, blockers?: [], merge_blockers?: [], tests_failing?: []}",
          properties: {
            next_action: { type: "string" },
            blockers: { type: "array", items: { type: "string" } },
            merge_blockers: { type: "array", items: { type: "string" } },
            tests_failing: { type: "array", items: { type: "string" } },
          },
          required: ["next_action"],
        },
        module_scope: {
          type: "array",
          items: { type: "string" },
          description:
            'Module IDs from lexmap.policy.json. If no policy-backed module applies, use the exact fallback ["workspace/unscoped"].',
        },
        branch: {
          type: "string",
          description: "Git branch (defaults to current branch)",
        },
        jira: {
          type: "string",
          description: 'Optional Jira/issue ticket (e.g., "PROJ-123")',
        },
        keywords: {
          type: "array",
          items: { type: "string" },
          description: 'Optional search tags (e.g., ["refactoring", "authentication"])',
        },
        atlas_frame_id: {
          type: "string",
          description: "Legacy reference to a Policy Neighborhood snapshot",
        },
        images: {
          type: "array",
          items: {
            type: "object",
            properties: {
              data: {
                type: "string",
                description: "Base64-encoded image data",
              },
              mime_type: {
                type: "string",
                description: 'MIME type (e.g., "image/png", "image/jpeg")',
              },
            },
            required: ["data", "mime_type"],
          },
          description: "Optional array of image attachments (base64-encoded with MIME type)",
        },
      },
    },
  },
  {
    name: "frame_search",
    description:
      "Search Frames by reference point, branch, or Jira ticket. Returns a Frame plus optional Policy Neighborhood. Alias: recall (deprecated)",
    inputSchema: {
      type: "object",
      properties: {
        reference_point: {
          type: "string",
          description: "Fuzzy search on what you were working on",
        },
        jira: {
          type: "string",
          description: "Exact match on Jira ticket",
        },
        branch: {
          type: "string",
          description: "Filter by git branch",
        },
        limit: {
          type: "number",
          description: "Max results to return (default: 10)",
          default: 10,
        },
        mode: {
          type: "string",
          enum: ["all", "any"],
          description:
            "Search mode: 'all' (AND - all terms must match, default) or 'any' (OR - any term can match)",
          default: "all",
        },
        format: {
          type: "string",
          enum: ["full", "compact"],
          description: "Output format: 'full' (default) or 'compact' for small-context agents",
          default: "full",
        },
      },
    },
  },
  {
    name: "frame_get",
    description:
      "Retrieve a specific frame by ID. Use when you know the exact frame ID. Alias: get_frame (deprecated)",
    inputSchema: {
      type: "object",
      required: ["frame_id"],
      properties: {
        frame_id: {
          type: "string",
          description: "Frame ID to retrieve (e.g., from remember response or passed context)",
        },
        include_atlas: {
          type: "boolean",
          description: "Include Policy Neighborhood context (legacy field; default: true)",
          default: true,
        },
        format: {
          type: "string",
          enum: ["full", "compact"],
          description: "Output format: 'full' (default) or 'compact' for small-context agents",
          default: "full",
        },
      },
    },
  },
  {
    name: "frame_list",
    description:
      "List recent Frames, optionally filtered by branch or module. Returns each Frame plus optional Policy Neighborhood. Alias: list_frames (deprecated)",
    inputSchema: {
      type: "object",
      properties: {
        branch: {
          type: "string",
          description: "Filter by git branch",
        },
        module: {
          type: "string",
          description: "Filter by module ID in module_scope",
        },
        limit: {
          type: "number",
          description: "Max results to return (default: 10)",
          default: 10,
        },
        since: {
          type: "string",
          description: "ISO 8601 timestamp - only return Frames after this time",
        },
        cursor: {
          type: "string",
          description:
            "Opaque cursor for pagination - use nextCursor from previous response to get next page",
        },
        format: {
          type: "string",
          enum: ["full", "compact"],
          description: "Output format: 'full' (default) or 'compact' for small-context agents",
          default: "full",
        },
      },
    },
  },
  {
    name: "policy_check",
    description: "Validate code against policy rules from lexmap.policy.json",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to check (defaults to current directory)",
        },
        policyPath: {
          type: "string",
          description: "Path to policy file (defaults to lexmap.policy.json)",
        },
        strict: {
          type: "boolean",
          description: "Fail on warnings (default: false)",
        },
      },
    },
  },
  {
    name: "timeline_show",
    description:
      "Show visual timeline of Frame evolution for a ticket or branch. Alias: timeline (deprecated)",
    inputSchema: {
      type: "object",
      required: ["ticketOrBranch"],
      properties: {
        ticketOrBranch: {
          type: "string",
          description: "Ticket ID or branch name to show timeline for",
        },
        since: {
          type: "string",
          description: "Filter frames since this date (ISO 8601)",
        },
        until: {
          type: "string",
          description: "Filter frames until this date (ISO 8601)",
        },
        format: {
          type: "string",
          enum: ["text", "json", "compact"],
          description:
            "Output format (default: text). 'compact' returns JSON with abbreviated fields for small-context agents.",
          default: "text",
        },
      },
    },
  },
  {
    name: "atlas_analyze",
    description: "Extract the experimental Code Index. Legacy name; alias: code_atlas (deprecated)",
    inputSchema: {
      type: "object",
      properties: {
        seedModules: {
          type: "array",
          items: { type: "string" },
          description: "List of module IDs to analyze",
        },
        foldRadius: {
          type: "number",
          description: "Neighborhood depth (default: 1)",
        },
      },
    },
  },
  {
    name: "system_introspect",
    description:
      "Discover the current state of Lex (available modules, policy, frame count, capabilities, error codes with metadata). Returns error code categories (validation, storage, policy, internal) and retryability hints for autonomous error handling. Alias: introspect (deprecated)",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["full", "compact"],
          description: "Output format: 'full' (default) or 'compact' for small-context agents",
          default: "full",
        },
      },
    },
  },
  {
    name: "help",
    description:
      "Get usage help for Lex MCP tools including examples, required fields, related tools, and common workflows. Use this to understand how to use Lex tools effectively.",
    inputSchema: {
      type: "object",
      properties: {
        tool: {
          type: "string",
          description: `Tool name to get help for (optional - returns all tools if omitted). Canonical names: ${CANONICAL_MCP_TOOLS.join(", ")}. Deprecated aliases are also accepted: ${Object.keys(MCP_TOOL_ALIASES).join(", ")}.`,
        },
        examples: {
          type: "boolean",
          description: "Include executable examples in the response (default: true)",
          default: true,
        },
        format: {
          type: "string",
          enum: ["full", "micro"],
          description: "Output format: 'full' (default) or 'micro' for ultra-compact examples",
          default: "full",
        },
      },
    },
  },
  {
    name: "hints_get",
    description:
      "Retrieve hint details by hint ID. Hints are stable, cacheable advice snippets for error recovery. Hint IDs are provided in compact error responses (hintId field). Fetch hints once and cache them to minimize token usage. Alias: get_hints (deprecated)",
    inputSchema: {
      type: "object",
      required: ["hintIds"],
      properties: {
        hintIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of hint IDs to retrieve (e.g., ['hint_mod_invalid_001'])",
        },
      },
    },
  },
  {
    name: "db_stats",
    description:
      "Get database statistics including frame count, storage size, and activity metrics. Useful for understanding memory usage and recent activity.",
    inputSchema: {
      type: "object",
      properties: {
        detailed: {
          type: "boolean",
          description: "Include detailed module distribution (default: false)",
          default: false,
        },
      },
    },
  },
  {
    name: "turncost_calculate",
    description:
      "Calculate Turn Cost governance metrics for a time period. Returns frame count, estimated tokens, and prompt count to help measure coordination overhead.",
    inputSchema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          description:
            "Time period for metrics. Format: duration string (e.g., '24h', '7d', '30d') or ISO 8601 timestamp. Default: '24h'",
          default: "24h",
        },
      },
    },
  },
  {
    name: "contradictions_scan",
    description:
      "Scan frames for potential contradictions (conflicting information across frames). Returns pairs of frames with detected conflicts and confidence scores.",
    inputSchema: {
      type: "object",
      properties: {
        module: {
          type: "string",
          description: "Optional module ID filter to limit scan to specific module",
        },
        limit: {
          type: "number",
          description: "Maximum number of frames to scan (default: 10000)",
          default: 10000,
        },
      },
    },
  },
];
