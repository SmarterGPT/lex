/**
 * CLI Command: lex remember
 *
 * Prompts user for Frame metadata, validates module_scope, creates Frame.
 *
 * Per AX v0.1 Contract:
 * - Supports --json for structured output
 * - Uses AXError for structured error handling
 */

import {
  assertExpectedDestination,
  DestinationBindingError,
  type DestinationSnapshotV1,
} from "../runtime-scope/destination.js";
import inquirer from "inquirer";
import { v4 as uuidv4 } from "uuid";
import type { CallerProvenance, Frame } from "../types/frame.js";
import { validateModuleIds } from "../module_ids/index.js";
import { loadPolicyIfAvailable } from "../policy/loader.js";
import { createFrameStore, type FrameStore } from "../../memory/store/index.js";
import { getCurrentBranch } from "../git/branch.js";
import { createOutput } from "./output.js";
import { createAXError, type AXError } from "../errors/ax-error.js";
import {
  buildFrameWriteContract,
  resolveModuleAttribution,
  type ModuleAttribution,
} from "./frame-write-contract.js";

export interface RememberOptions {
  jira?: string;
  referencePoint?: string;
  summary?: string;
  next?: string;
  modules?: string[];
  blockers?: string[];
  mergeBlockers?: string[];
  testsFailing?: string[];
  keywords?: string[];
  featureFlags?: string[];
  permissions?: string[];
  provenanceJson?: string;
  interactive?: boolean;
  json?: boolean;
  strict?: boolean;
  noSubstring?: boolean;
  noPolicy?: boolean;
  dryRun?: boolean;
  expectedDestination?: string;
}

export const MAX_CALLER_PROVENANCE_BYTES = 64 * 1024;

type ProvenanceParseResult =
  { ok: true; provenance?: CallerProvenance } | { ok: false; message: string; bytes: number };

function parseCallerProvenance(value: string | undefined): ProvenanceParseResult {
  if (value === undefined) return { ok: true };

  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > MAX_CALLER_PROVENANCE_BYTES) {
    return {
      ok: false,
      message: `--provenance-json exceeds the ${MAX_CALLER_PROVENANCE_BYTES}-byte limit.`,
      bytes,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { ok: false, message: "--provenance-json must be valid JSON.", bytes };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      message: "--provenance-json must contain a non-null JSON object.",
      bytes,
    };
  }

  return { ok: true, provenance: parsed as CallerProvenance };
}

/**
 * Execute the 'lex remember' command
 * Creates a new Frame with user input
 *
 * Per AX v0.1 Contract:
 * - --json outputs structured CliEvent with frame data
 * - Errors return AXError shape with nextActions
 *
 * @param options - Command options
 * @param frameStore - Optional FrameStore for dependency injection (defaults to SqliteFrameStore)
 */
export async function remember(
  options: RememberOptions = {},
  frameStore?: FrameStore,
  destinationSnapshot?: DestinationSnapshotV1
): Promise<void> {
  // Create output writer for this command
  // When --json is set, use JSONL mode for structured output (AX v0.1 compliance)
  const out = createOutput({
    scope: "cli:remember",
    mode: options.json ? "jsonl" : "plain",
  });

  // Caller provenance is opaque historical data. Validate it before opening or mutating a store.
  const provenanceResult = parseCallerProvenance(options.provenanceJson);
  if (!provenanceResult.ok) {
    const axError = createAXError(
      "INVALID_PROVENANCE_JSON",
      provenanceResult.message,
      [
        "Pass a valid non-null JSON object to --provenance-json",
        `Keep its UTF-8 representation at or below ${MAX_CALLER_PROVENANCE_BYTES} bytes`,
        "Remove --provenance-json when no caller provenance is available",
      ],
      { bytes: provenanceResult.bytes, maxBytes: MAX_CALLER_PROVENANCE_BYTES }
    );
    if (options.json) {
      out.json({ level: "error", message: axError.message, data: axError, code: axError.code });
    } else {
      out.error(axError.message, axError, axError.code);
    }
    process.exitCode = 1;
    return;
  }
  const callerProvenance = provenanceResult.provenance;

  // If no store is provided, create a default one (which we'll need to close)
  let store: FrameStore | undefined;
  const ownsStore = frameStore === undefined;

  try {
    if (options.dryRun && options.expectedDestination !== undefined) {
      throw new DestinationBindingError(
        "--expected-destination binds writes; omit it for --dry-run or inspect the destination separately."
      );
    }
    // Expected identity can only restrict the host-authorized destination. Check before history reads.
    assertExpectedDestination(destinationSnapshot, options.expectedDestination);
    store = frameStore ?? createFrameStore();
    // Get current git branch
    const branch = await getCurrentBranch();
    const policy = options.noPolicy ? null : loadPolicyIfAvailable();
    let recentFrames: Frame[] = [];
    try {
      recentFrames = (await store.listFrames({ limit: 10 })).frames;
    } catch {
      // A write may still succeed against stores that do not support useful history reads.
    }
    const writeContract = buildFrameWriteContract({
      policy,
      projectRoot: process.cwd(),
      branch,
      query: [options.summary, options.next, options.referencePoint].filter(Boolean).join(" "),
      recentFrames,
    });

    // AX Level 3: In JSON mode, NEVER prompt — fail-fast with structured guidance
    if (options.json) {
      const missingRequired: string[] = [];
      if (!options.summary) missingRequired.push("--summary");
      if (!options.modules || options.modules.length === 0) missingRequired.push("--modules");

      if (missingRequired.length > 0) {
        const axError: AXError = createAXError(
          "MISSING_REQUIRED_PARAMS",
          `Missing required parameters: ${missingRequired.join(", ")}`,
          [
            ...missingRequired.map((p) => `Add ${p} parameter`),
            "Use --modules auto for bounded policy-backed inference",
            "Use --modules unscoped for an explicit workspace/unscoped fallback",
            "Example: lex remember --summary 'What happened' --modules auto",
            "Use --interactive for guided input",
          ],
          {
            missingParams: missingRequired,
            frameWriteContract: writeContract,
            providedParams: Object.keys(options).filter(
              (k) => options[k as keyof RememberOptions] !== undefined
            ),
          }
        );
        out.json({ level: "error", message: axError.message, data: axError, code: axError.code });
        process.exitCode = 1;
        return;
      }
    }

    // If interactive mode or missing required fields (non-JSON), prompt for input
    const answers =
      options.interactive || !options.summary || !options.modules
        ? await promptForFrameData(options, branch)
        : applyDefaults(options);

    // Resolve explicit, inferred, or fallback module attribution before validation.
    const moduleResolution = resolveModuleAttribution(answers.modules || [], writeContract);
    let resolvedModules: string[];
    let moduleAttribution: ModuleAttribution = moduleResolution.attribution;

    if (!policy || moduleAttribution.mode === "fallback") {
      // No policy available - emit warning and use modules as-is
      if (!options.json) {
        const reason =
          moduleAttribution.mode === "fallback"
            ? "Explicit workspace/unscoped module attribution"
            : options.noPolicy
              ? "Policy validation disabled (--skip-policy flag)"
              : "No policy file found";
        out.warn(
          `${reason}. Module validation skipped.`,
          undefined,
          "POLICY_SKIPPED",
          options.noPolicy || moduleAttribution.mode === "fallback"
            ? undefined
            : "To enable validation, create a policy file or set LEX_POLICY_PATH."
        );
      }
      resolvedModules = moduleResolution.modules;
    } else {
      // Policy exists - validate modules
      const validationResult = await validateModuleIds(moduleResolution.modules, policy);

      if (!validationResult.valid) {
        // Get valid modules from policy for helpful error recovery
        const validModules = Object.keys(policy.modules || {});
        const providedModules = moduleResolution.modules;

        // Build specific next actions based on what went wrong
        const nextActions: string[] = [];

        // For each invalid module, suggest the closest valid one if available
        for (const error of validationResult.errors || []) {
          if (error.suggestions && error.suggestions.length > 0) {
            nextActions.push(`Replace '${error.module}' with '${error.suggestions[0]}'`);
          }
        }

        // Always include the valid modules list
        nextActions.push(
          `Available modules: ${validModules.slice(0, 10).join(", ")}${validModules.length > 10 ? ` (and ${validModules.length - 10} more)` : ""}`
        );

        // Escape hatches - prefer using existing modules over adding new ones
        nextActions.push("Prefer using an existing module from the list above");
        nextActions.push(
          "Use --skip-policy to bypass validation (if module truly doesn't exist yet)"
        );

        if (options.json) {
          const axError: AXError = createAXError(
            "MODULE_VALIDATION_FAILED",
            "Module validation failed",
            nextActions,
            {
              errors: validationResult.errors?.map((e) => e.message),
              providedModules,
              validModules,
            }
          );
          out.json({ level: "error", message: axError.message, data: axError, code: axError.code });
        } else {
          // AX3: Show errors AND actionable next steps in plain text mode
          out.error("Module validation failed");
          for (const error of validationResult.errors || []) {
            out.error(`  - ${error.message}`);
          }
          out.info("");
          out.info("Next steps:");
          for (const action of nextActions) {
            out.info(`  → ${action}`);
          }
        }
        process.exitCode = 1;
        return;
      }

      // Use canonical (resolved) module IDs from validation
      resolvedModules = validationResult.canonical || [];
    }

    if (moduleAttribution.mode === "inferred" && resolvedModules.length > 0) {
      moduleAttribution = {
        ...moduleAttribution,
        evidence: [...moduleAttribution.evidence, `resolved:${resolvedModules.join(",")}`],
      };
    }

    // Build Frame object
    const frame: Frame = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      branch: branch,
      module_scope: resolvedModules, // Use resolved (potentially auto-corrected) module IDs
      summary_caption: answers.summary || "",
      reference_point: answers.referencePoint || deriveReferencePoint(answers.summary || ""),
      status_snapshot: {
        next_action: answers.next || "",
        blockers: answers.blockers,
        merge_blockers: answers.mergeBlockers,
        tests_failing: answers.testsFailing,
        ...(callerProvenance ? { provenance: callerProvenance } : {}),
      },
      jira: answers.jira,
      keywords: answers.keywords,
      feature_flags: answers.featureFlags,
      permissions: answers.permissions,
      module_attribution: moduleAttribution,
    };

    // Dry-run mode: validate but don't store (matches frame_validate MCP tool)
    if (options.dryRun) {
      if (options.json) {
        out.json({
          level: "success",
          message: "Frame validation passed (dry-run)",
          code: "FRAME_VALID",
          data: {
            valid: true,
            dryRun: true,
            frame: {
              id: frame.id,
              branch: frame.branch,
              modules: frame.module_scope,
              referencePoint: frame.reference_point,
              summary: frame.summary_caption,
              nextAction: frame.status_snapshot.next_action,
              moduleAttribution: frame.module_attribution,
            },
          },
        });
      } else {
        out.success("✅ Frame validation passed (dry-run mode - not stored)");
        out.info(`Frame ID: ${frame.id}`);
        out.info(`Branch: ${frame.branch}`);
        out.info(`Modules: ${frame.module_scope.join(", ")}`);
        out.info(`Summary: ${frame.summary_caption}`);
        out.info(`Next: ${frame.status_snapshot.next_action || "(none)"}`);
      }
      return;
    }

    // Bind the JSON write receipt to the exact selected store before mutation.
    // Resolving metadata first prevents a successful write followed by a failed receipt.
    const storeMetadata = options.json ? store.getMetadata() : null;

    // Expiry is rechecked immediately before mutation. Authority/backend verification occurred at operation entry.
    assertExpectedDestination(destinationSnapshot, options.expectedDestination);

    // Save Frame to database using FrameStore
    await store.saveFrame(frame);

    // Output result (AX v0.1: structured output with --json)
    if (options.json) {
      out.json({
        level: "success",
        message: "Frame stored",
        code: "FRAME_CREATED",
        data: {
          success: true,
          frame_id: frame.id,
          created_at: frame.timestamp,
          // Additional context fields
          branch: frame.branch,
          modules: frame.module_scope,
          referencePoint: frame.reference_point,
          moduleAttribution: frame.module_attribution,
          ...(callerProvenance ? { provenance: callerProvenance } : {}),
          ...(destinationSnapshot ? { destination: destinationSnapshot } : {}),
          storeIdentity: storeMetadata!.identity,
          store: {
            backend: storeMetadata!.backend,
            canonicalLocation: storeMetadata!.canonicalLocation,
            identity: storeMetadata!.identity,
          },
        },
      });
    } else {
      out.success("Frame created successfully!");
      out.info(`Frame ID: ${frame.id}`);
      out.info(`Timestamp: ${frame.timestamp}`);
      out.info(`Branch: ${frame.branch}`);
      if (frame.jira) {
        out.info(`Jira: ${frame.jira}`);
      }
      out.info(`Reference: ${frame.reference_point}`);
      out.info(`Modules: ${frame.module_scope.join(", ")}`);
      out.info(`Module attribution: ${moduleAttribution.mode} (${moduleAttribution.confidence})`);
    }
  } catch (error: unknown) {
    if (options.json) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const axError: AXError = createAXError(
        error instanceof DestinationBindingError ? error.code : "FRAME_STORE_FAILED",
        errorMessage,
        [
          "Check database connection",
          "Verify write permissions",
          "Run 'lex check' to diagnose issues",
        ],
        error instanceof Error ? { stack: error.stack?.split("\n").slice(0, 5) } : undefined
      );
      out.json({ level: "error", message: axError.message, data: axError, code: axError.code });
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      out.error(`Error: ${errorMessage}`);
    }
    process.exitCode = 2;
  } finally {
    // Close store if we own it
    if (ownsStore) {
      await store?.close();
    }
  }
}

function deriveReferencePoint(summary: string): string {
  const value = summary
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return value.slice(0, 96) || "work-session";
}

/**
 * Apply defaults to optional fields (AX Level 3: no hidden prompts)
 *
 * Required fields: summary, modules
 * Optional fields with defaults:
 *   - referencePoint: "" (empty string)
 *   - next: "" (empty string)
 *   - jira: undefined
 *   - blockers: undefined
 *   - mergeBlockers: undefined
 *   - testsFailing: undefined
 *   - keywords: undefined
 *   - featureFlags: undefined
 *   - permissions: undefined
 */
function applyDefaults(options: RememberOptions): RememberOptions {
  return {
    ...options,
    referencePoint: options.referencePoint ?? "",
    next: options.next ?? "",
    // All other optional fields default to undefined (omitted from Frame)
  };
}

/**
 * Prompt user for Frame metadata interactively
 */
async function promptForFrameData(
  options: RememberOptions,
  _currentBranch: string
): Promise<RememberOptions> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const questions: any[] = [];

  // Only prompt for REQUIRED fields when not in full interactive mode
  const fullInteractive = options.interactive;

  if (fullInteractive && !options.jira) {
    questions.push({
      type: "input",
      name: "jira",
      message: "Jira ticket (optional):",
    });
  }

  if (!options.referencePoint) {
    questions.push({
      type: "input",
      name: "referencePoint",
      message: "Reference point (memorable phrase, optional):",
      default: "",
    });
  }

  if (!options.summary) {
    questions.push({
      type: "input",
      name: "summary",
      message: "Summary (one-line description):",
      validate: (input: string) => input.trim().length > 0 || "Summary is required",
    });
  }

  if (!options.next) {
    questions.push({
      type: "input",
      name: "next",
      message: "Next action (optional):",
      default: "",
    });
  }

  if (!options.modules) {
    questions.push({
      type: "input",
      name: "modules",
      message: "Module scope (comma-separated):",
      filter: (input: string) =>
        input
          .split(",")
          .map((m) => m.trim())
          .filter((m) => m.length > 0),
      validate: (input: string[]) => input.length > 0 || "At least one module is required",
    });
  }

  // Only prompt for optional fields in full interactive mode
  if (fullInteractive && !options.blockers) {
    questions.push({
      type: "input",
      name: "blockers",
      message: "Blockers (comma-separated, optional):",
      filter: (input: string) => {
        if (!input.trim()) return undefined;
        return input
          .split(",")
          .map((b) => b.trim())
          .filter((b) => b.length > 0);
      },
    });
  }

  if (fullInteractive && !options.mergeBlockers) {
    questions.push({
      type: "input",
      name: "mergeBlockers",
      message: "Merge blockers (comma-separated, optional):",
      filter: (input: string) => {
        if (!input.trim()) return undefined;
        return input
          .split(",")
          .map((b) => b.trim())
          .filter((b) => b.length > 0);
      },
    });
  }

  const answers = questions.length > 0 ? await inquirer.prompt(questions) : {};

  // Merge with provided options (provided options take precedence)
  return {
    ...answers,
    ...options,
  };
}
