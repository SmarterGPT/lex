/**
 * CLI Entry Point - Command Routing and Global Flags
 *
 * Routes commands to appropriate handlers and handles global flags.
 */

import { Command, InvalidArgumentError } from "commander";
import { destination } from "./destination.js";
import { remember, type RememberOptions } from "./remember.js";
import { recall, type RecallOptions } from "./recall.js";
import { check, type CheckOptions } from "./check.js";
import { checkContradictions, type CheckContradictionsOptions } from "./check-contradictions.js";
import { timeline, type TimelineCommandOptions } from "./timeline.js";
import { init, type InitOptions } from "./init.js";
import { exportFrames, type ExportCommandOptions } from "./export.js";
import { importFrames, type ImportCommandOptions } from "./import.js";
import {
  dbVacuum,
  dbBackup,
  dbRepair,
  dbScopeInventory,
  dbScopeManifest,
  dbScopeMigrate,
  dbScopeRecover,
  dbEncrypt,
  dbStats,
  type DbVacuumOptions,
  type DbBackupOptions,
  type DbRepairOptions,
  type DbScopeInventoryOptions,
  type DbScopeManifestOptions,
  type DbScopeMigrateOptions,
  type DbScopeRecoverOptions,
  type DbEncryptOptions,
  type DbStatsOptions,
} from "./db.js";
import { policyCheck, type PolicyCheckOptions } from "./policy-check.js";
import { policyAddModule, type PolicyAddModuleOptions } from "./policy-add-module.js";
import { policyGenerate, type PolicyGenerateOptions } from "./policy-generate.js";
import { codeAtlas, type CodeAtlasOptions } from "./code-atlas.js";
import {
  instructionsInit,
  instructionsGenerate,
  instructionsCheck,
  type InstructionsInitOptions,
  type InstructionsGenerateOptions,
  type InstructionsCheckOptions,
} from "./instructions.js";
import { turncost, type TurnCostOptions } from "./turncost.js";
import { dedupe, type DedupeOptions } from "./dedupe.js";
import { epicSync, type EpicSyncOptions } from "./epic.js";
import { waveComplete, type WaveCompleteOptions } from "./wave.js";
import { introspect, type IntrospectOptions } from "./introspect.js";
import { context, type ContextOptions } from "./context.js";
import { hints, type HintsOptions } from "./hints.js";
import { addWorkspaceAdminCommands, type WorkspaceAdminCliV1 } from "./workspace.js";
import { addKnowledgeCommands } from "./knowledge.js";
import {
  scopedFrameStoreAsLegacyView,
  type FrameStore,
  type ScopedFrameStore,
  type ScopedFrameStoreBinder,
} from "../../memory/store/index.js";
import * as output from "./output.js";
import { AXErrorException } from "../errors/ax-error.js";
import {
  DIAGNOSTIC_CONTRACT_VERSION,
  createDestinationSnapshot,
  UNVERIFIED_BACKEND_IDENTITY,
  type DestinationSnapshotV1,
  authorizeTrustedRuntimeEntrypoint,
  capabilitiesForCliInvocation,
  trustedCliOperationFromArgv,
  type DiagnosticEnvelopeV1,
  type DiagnosticRequestV1,
  type TrustedRuntimeScopeBootstrapResultV1,
  type TrustedRuntimeScopeEntrypointGuardV1,
} from "../runtime-scope/index.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
function getVersion(): string {
  try {
    // From dist/shared/cli/index.js, package.json is at ../../../package.json (root)
    const packagePath = join(__dirname, "..", "..", "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf-8"));
    return packageJson.version;
  } catch {
    return "0.2.0";
  }
}

/**
 * Create and configure the CLI program
 */
export interface CreateProgramOptionsV1 {
  readonly runtimeScopeDiagnostics?: boolean;
  /** Request-local authorized store; never retained after this invocation. */
  readonly frameStore?: FrameStore;
  /** Trusted operation-entry snapshot; never populated from command arguments. */
  readonly destination?: DestinationSnapshotV1;
  readonly workspaceAdmin?: WorkspaceAdminCliV1;
}

export function createProgram(programOptions: CreateProgramOptionsV1 = {}): Command {
  const program = new Command();

  program
    .name("lex")
    .description("Policy-aware work continuity with receipts")
    .version(getVersion())
    .option("--json", "Output results in JSON format")
    .option("--verbose", "Enable diagnostic logging (Pino logs)");
  if (programOptions.runtimeScopeDiagnostics) {
    program
      .option("--diagnostic", "Include a redacted runtime-scope diagnostic summary")
      .option(
        "--diagnostic-level <level>",
        "Runtime-scope diagnostic detail: summary or full (requires --diagnostic)",
        /^(summary|full)$/,
        undefined
      );
  }

  // lex init command
  program
    .command("init")
    .description("Initialize .smartergpt/ workspace with prompts, policy, and instructions")
    .option("--force", "Overwrite existing files")
    .option("--store <backend>", "Storage backend for initialization (sqlite or postgres)")
    .option("--policy", "Generate a structural seed policy from repository code")
    .option("--src-dir <dir>", "Constrain policy discovery to a repository-relative directory")
    .option("--prompts-dir <path>", "Custom prompts directory (default: .smartergpt/prompts)")
    .option("--no-instructions", "Skip creating canonical instructions file")
    .option("--mcp", "Generate .vscode/mcp.json for MCP server configuration")
    .option("-y, --yes", "Non-interactive mode (skip prompts)")
    .option("-i, --interactive", "Interactive mode (prompt for first frame)")
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: InitOptions = {
        force: cmdOptions.force || false,
        store: cmdOptions.store,
        policy: cmdOptions.policy || false,
        srcDir: cmdOptions.srcDir,
        json: globalOptions.json || false,
        promptsDir: cmdOptions.promptsDir,
        instructions: cmdOptions.instructions,
        mcp: cmdOptions.mcp || false,
        yes: cmdOptions.yes || false,
        interactive: cmdOptions.interactive || false,
      };
      await init(options);
    });

  program
    .command("destination")
    .description(
      "Inspect the authorized destination for remember without reading or writing Frames"
    )
    .action(() => destination(programOptions.destination, program.opts().json || false));

  // lex remember command
  program
    .command("remember")
    .description("Capture a work session Frame")
    .option("--jira <ticket>", "Jira ticket ID")
    .option("--reference-point <phrase>", "Human-memorable anchor phrase")
    .option("--summary <text>", "One-line summary (required for non-interactive use)")
    .option("--next <action>", "Next action to take")
    .option(
      "--modules <list>",
      "Required module IDs, 'auto' for inference, or 'unscoped' for fallback",
      parseList
    )
    .option("--blockers <list>", "Comma-separated blockers", parseList)
    .option("--merge-blockers <list>", "Comma-separated merge blockers", parseList)
    .option("--tests-failing <list>", "Comma-separated test names", parseList)
    .option("--keywords <list>", "Comma-separated keywords", parseList)
    .option("--feature-flags <list>", "Comma-separated feature flags", parseList)
    .option("--permissions <list>", "Comma-separated permissions", parseList)
    .option(
      "--provenance-json <json>",
      "Bounded caller-supplied historical provenance JSON object (stored without interpretation)"
    )
    .option("-i, --interactive", "Interactive mode (prompt for all fields)")
    .option("--strict", "Disable auto-correction for typos (for CI)")
    .option("--no-substring", "Disable substring matching for module IDs (for CI)")
    .option("--skip-policy", "Skip ontology validation only; required Frame fields still apply")
    .option("--dry-run", "Validate frame without storing (matches frame_validate MCP tool)")
    .option(
      "--expected-destination <identity>",
      "Require the verified destination identity from lex destination"
    )
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: RememberOptions = {
        jira: cmdOptions.jira,
        referencePoint: cmdOptions.referencePoint,
        summary: cmdOptions.summary,
        next: cmdOptions.next,
        modules: cmdOptions.modules,
        blockers: cmdOptions.blockers,
        mergeBlockers: cmdOptions.mergeBlockers,
        testsFailing: cmdOptions.testsFailing,
        keywords: cmdOptions.keywords,
        featureFlags: cmdOptions.featureFlags,
        permissions: cmdOptions.permissions,
        provenanceJson: cmdOptions.provenanceJson,
        interactive: cmdOptions.interactive || false,
        json: globalOptions.json || false,
        strict: cmdOptions.strict || false,
        noSubstring: cmdOptions.noSubstring || false,
        noPolicy: cmdOptions.skipPolicy || false,
        dryRun: cmdOptions.dryRun || false,
        expectedDestination: cmdOptions.expectedDestination,
      };
      await remember(options, programOptions.frameStore, programOptions.destination);
    });

  // lex recall command
  program
    .command("recall [query]")
    .description(
      "Retrieve a Frame by reference point, ticket ID, or Frame ID, or list recent frames"
    )
    .option("-q, --query <text>", "Search query (alternative to positional argument)")
    .option("--list [limit]", "List recent frames (optionally limit to N results)", parseInt)
    .option(
      "--fold-radius <number>",
      "Non-negative integer fold radius (0 = seed modules only; default: 1)",
      (value: string) => {
        const radius = Number(value);
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(radius)) {
          throw new InvalidArgumentError("Fold radius must be a non-negative safe integer.");
        }
        return radius;
      }
    )
    .option("--auto-radius", "Auto-tune radius based on token limits")
    .option(
      "--max-tokens <number>",
      "Maximum tokens for Policy Neighborhood context (use with --auto-radius)",
      parseInt
    )
    .option("--cache-stats", "Show cache statistics")
    .option("--exact", "Disable fuzzy matching (prefix wildcards)")
    .option(
      "--mode <type>",
      "Search mode: 'all' (AND - all terms must match, default) or 'any' (OR - any term can match)",
      /^(all|any)$/,
      "all"
    )
    .option("--strict", "Exit with code 1 when no frames found (for CI/scripts)")
    .option("--summary", "Enable compact format mode for small-context agents")
    .option(
      "--format <type>",
      "Output format: json, prose (narrative), or default (pretty print)",
      /^(json|prose|default)$/,
      undefined
    )
    .action(async (query, cmdOptions) => {
      const globalOptions = program.opts();
      // Support both positional argument and --query option
      const searchQuery = query || cmdOptions.query;
      const options: RecallOptions = {
        list: cmdOptions.list,
        foldRadius: cmdOptions.foldRadius ?? 1,
        autoRadius: cmdOptions.autoRadius || false,
        maxTokens: cmdOptions.maxTokens,
        showCacheStats: cmdOptions.cacheStats || false,
        exact: cmdOptions.exact || false,
        mode: cmdOptions.mode || "all",
        strict: cmdOptions.strict || false,
        json: globalOptions.json || false,
        summary: cmdOptions.summary || false,
        format: cmdOptions.format,
      };

      // Validate auto-radius options
      if (options.autoRadius && !options.maxTokens) {
        output.error("Error: --auto-radius requires --max-tokens to be specified");
        process.exit(1);
      }

      // Validate that either query or --list is provided
      if (!searchQuery && options.list === undefined) {
        output.error(
          "\n❌ Error: Either provide a search query or use --list to browse recent frames\n"
        );
        process.exit(1);
      }

      await recall(searchQuery, options, programOptions.frameStore);
    });

  // lex context command
  program
    .command("context [query]")
    .description("Produce bounded, prompt-safe, read-only context for agent session bootstrap")
    .option("--project-root <path>", "Explicit project/workspace root")
    .option("--branch <name>", "Git branch/ref override")
    .option("--limit <number>", "Maximum selected Frames (default: 5)", parseInt)
    .option("--max-tokens <number>", "Maximum approximate output tokens (default: 1200)", parseInt)
    .action(async (query, cmdOptions) => {
      const globalOptions = program.opts();
      const options: ContextOptions = {
        query,
        projectRoot: cmdOptions.projectRoot,
        branch: cmdOptions.branch,
        limit: cmdOptions.limit,
        maxTokens: cmdOptions.maxTokens,
        json: globalOptions.json || false,
      };
      await context(options, programOptions.frameStore);
    });

  // lex check command
  program
    .command("check <merged-json> <policy-json>")
    .description("Enforce policy against scanned code")
    .option("--ticket <id>", "Ticket ID for context")
    .action(async (mergedJson, policyJson, cmdOptions) => {
      const globalOptions = program.opts();
      const options: CheckOptions = {
        ticket: cmdOptions.ticket,
        json: globalOptions.json || false,
      };
      await check(mergedJson, policyJson, options);
    });

  // lex timeline command
  program
    .command("timeline <ticket-or-branch>")
    .description("Show visual timeline of Frame evolution for a ticket or branch")
    .option("--since <date>", "Filter frames since this date (ISO 8601)")
    .option("--until <date>", "Filter frames until this date (ISO 8601)")
    .option("--format <type>", "Output format: text, json, or html", /^(text|json|html)$/, "text")
    .option("--output <file>", "Write output to file instead of stdout")
    .action(async (ticketOrBranch, cmdOptions) => {
      const globalOptions = program.opts();
      const options: TimelineCommandOptions = {
        since: cmdOptions.since,
        until: cmdOptions.until,
        format: cmdOptions.format,
        output: cmdOptions.output,
        json: globalOptions.json || false,
      };
      await timeline(ticketOrBranch, options, programOptions.frameStore);
    });

  // lex frames command group
  const framesCommand = program.command("frames").description("Frame database operations");

  // lex frames export command
  framesCommand
    .command("export")
    .description("Export frames from database to JSON files")
    .option("--out <dir>", "Output directory (default: .smartergpt/lex/frames.export)")
    .option(
      "--since <date|duration>",
      "Export frames since date or duration (e.g., 7d, 2025-01-01)"
    )
    .option("--jira <ticket>", "Export frames for specific Jira ticket")
    .option("--branch <name>", "Export frames for specific branch")
    .option("--format <type>", "Output format: json or ndjson", /^(json|ndjson)$/, "json")
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: ExportCommandOptions = {
        out: cmdOptions.out,
        since: cmdOptions.since,
        jira: cmdOptions.jira,
        branch: cmdOptions.branch,
        format: cmdOptions.format,
        json: globalOptions.json || false,
      };
      await exportFrames(options, programOptions.frameStore);
    });

  // lex frames import command
  framesCommand
    .command("import")
    .description("Import frames from JSON files for backup recovery and migration")
    .option("--from-dir <path>", "Import all JSON files from directory")
    .option("--from-file <path>", "Import single JSON file (array of Frames)")
    .option("--dry-run", "Validate without writing to database")
    .option("--skip-duplicates", "Skip frames with existing IDs")
    .option("--merge", "Update existing frames with new data")
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: ImportCommandOptions = {
        fromDir: cmdOptions.fromDir,
        fromFile: cmdOptions.fromFile,
        dryRun: cmdOptions.dryRun || false,
        skipDuplicates: cmdOptions.skipDuplicates || false,
        merge: cmdOptions.merge || false,
        json: globalOptions.json || false,
      };
      await importFrames(options, programOptions.frameStore);
    });

  // lex db command group
  const dbCommand = program.command("db").description("Database maintenance commands");

  // lex db vacuum
  dbCommand
    .command("vacuum")
    .description("Optimize database (rebuild and compact)")
    .action(async () => {
      const globalOptions = program.opts();
      const options: DbVacuumOptions = {
        json: globalOptions.json || false,
      };
      await dbVacuum(options);
    });

  // lex db backup
  dbCommand
    .command("backup")
    .description("Create timestamped database backup")
    .option("--rotate <n>", "Keep N most recent backups (0 = no rotation)", parseInt)
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: DbBackupOptions = {
        rotate: cmdOptions.rotate,
        json: globalOptions.json || false,
      };
      await dbBackup(options);
    });

  // lex db repair
  dbCommand
    .command("repair")
    .description("Diagnose SQLite schema integrity (read-only unless --write is explicit)")
    .option("--database <path>", "SQLite database file (default: configured Lex store)")
    .option("--write", "Back up and apply a recognized safe repair")
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: DbRepairOptions = {
        database: cmdOptions.database,
        write: cmdOptions.write || false,
        json: globalOptions.json || false,
      };
      await dbRepair(options);
    });

  // lex db scope: explicit SQLite v14 -> v15 ownership staging
  const dbScopeCommand = dbCommand
    .command("scope")
    .description("Stage and apply explicit SQLite tenant/workspace ownership");

  dbScopeCommand
    .command("inventory")
    .description("Inspect SQLite ownership state without mutation")
    .option("--database <path>", "SQLite database file (default: configured Lex store)")
    .action(async (cmdOptions) => {
      const options: DbScopeInventoryOptions = {
        database: cmdOptions.database,
        json: program.opts().json || false,
      };
      await dbScopeInventory(options);
    });

  dbScopeCommand
    .command("manifest")
    .description("Create a deterministic explicit source-to-scope manifest")
    .requiredOption("--tenant-id <uuid>", "Canonical tenant UUID")
    .requiredOption("--workspace-id <uuid>", "Canonical workspace UUID")
    .requiredOption("--creator-principal-id <uuid>", "Canonical migration principal UUID")
    .requiredOption("--scope-version <version>", "Authority scope version")
    .option("--database <path>", "SQLite database file (default: configured Lex store)")
    .option("--output <path>", "Create the manifest file exclusively (0600)")
    .action(async (cmdOptions) => {
      const options: DbScopeManifestOptions = {
        tenantId: cmdOptions.tenantId,
        workspaceId: cmdOptions.workspaceId,
        creatorPrincipalId: cmdOptions.creatorPrincipalId,
        scopeVersion: cmdOptions.scopeVersion,
        database: cmdOptions.database,
        output: cmdOptions.output,
        json: program.opts().json || false,
      };
      await dbScopeManifest(options);
    });

  dbScopeCommand
    .command("migrate")
    .description("Validate a manifest; mutate only when --write is explicit")
    .requiredOption("--manifest <path>", "Reviewed SQLite scope migration manifest")
    .option("--database <path>", "SQLite database file (default: configured Lex store)")
    .option("--write", "Back up, transactionally migrate, and verify")
    .action(async (cmdOptions) => {
      const options: DbScopeMigrateOptions = {
        manifest: cmdOptions.manifest,
        database: cmdOptions.database,
        write: cmdOptions.write || false,
        json: program.opts().json || false,
      };
      await dbScopeMigrate(options);
    });

  dbScopeCommand
    .command("recover")
    .description("Verify a migration backup; restore only when --write is explicit")
    .requiredOption("--backup <path>", "Local recovery snapshot created by migration")
    .option("--database <path>", "SQLite database file (default: configured Lex store)")
    .option("--write", "Atomically restore and verify the legacy source")
    .action(async (cmdOptions) => {
      const options: DbScopeRecoverOptions = {
        backup: cmdOptions.backup,
        database: cmdOptions.database,
        write: cmdOptions.write || false,
        json: program.opts().json || false,
      };
      await dbScopeRecover(options);
    });

  // lex db encrypt
  dbCommand
    .command("encrypt")
    .description(
      "Encrypt existing database with SQLCipher (passphrase must be provided via LEX_DB_KEY environment variable)"
    )
    .option("--input <path>", "Input database file (default: current database)")
    .option("--output <path>", "Output encrypted database file (default: input-encrypted.db)")
    .option("--verify", "Verify data integrity after encryption")
    .option("--no-backup", "Skip creating a backup before encryption")
    .option(
      "--batch-size <n>",
      "Number of rows per batch/transaction (reduces memory usage)",
      parseInt
    )
    .option("--dry-run", "Estimate migration time and rows without writing")
    .option("--progress", "Show progress indicator during migration")
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: DbEncryptOptions = {
        input: cmdOptions.input,
        output: cmdOptions.output,
        verify: cmdOptions.verify || false,
        json: globalOptions.json || false,
        backup: cmdOptions.backup,
        batchSize: cmdOptions.batchSize,
        dryRun: cmdOptions.dryRun || false,
        progress: cmdOptions.progress || false,
      };
      await dbEncrypt(options);
    });

  // lex db stats
  dbCommand
    .command("stats")
    .description("Show database statistics and health information")
    .option("--detailed", "Include full module breakdown")
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: DbStatsOptions = {
        json: globalOptions.json || false,
        detailed: cmdOptions.detailed || false,
      };
      await dbStats(options);
    });

  // lex policy command group
  const policyCommand = program.command("policy").description("Policy file operations");

  // lex policy generate
  policyCommand
    .command("generate")
    .description("Generate a deterministic structural policy for a mixed-language repository")
    .option("--root <path>", "Repository root (default: current directory)")
    .option("--src-dir <dir>", "Constrain discovery to a repository-relative directory")
    .option("--output <path>", "Output path (default: .smartergpt/lex/lexmap.policy.json)")
    .option("--force", "Overwrite an existing output file")
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: PolicyGenerateOptions = {
        rootDir: cmdOptions.root,
        srcDir: cmdOptions.srcDir,
        policyPath: cmdOptions.output,
        force: cmdOptions.force || false,
        json: globalOptions.json || false,
      };
      await policyGenerate(options);
    });

  // lex policy check
  policyCommand
    .command("check")
    .description("Validate policy file syntax and optionally verify module-codebase mapping")
    .option("--match", "Verify modules match codebase structure")
    .option("--policy <path>", "Custom policy file path")
    .option("--src-dir <dir>", "Source directory for --match (default: src)")
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: PolicyCheckOptions = {
        json: globalOptions.json || false,
        match: cmdOptions.match || false,
        policyPath: cmdOptions.policy,
        srcDir: cmdOptions.srcDir,
      };
      await policyCheck(options);
    });

  // lex policy add-module
  policyCommand
    .command("add-module <moduleId>")
    .description("Add a new module to the policy file")
    .option("--policy <path>", "Custom policy file path")
    .action(async (moduleId, cmdOptions) => {
      const globalOptions = program.opts();
      const options: PolicyAddModuleOptions = {
        json: globalOptions.json || false,
        policyPath: cmdOptions.policy,
      };
      await policyAddModule(moduleId, options);
    });

  // lex instructions command group
  const instructionsCommand = program
    .command("instructions")
    .description("Manage AI assistant instructions");

  // lex instructions init
  instructionsCommand
    .command("init")
    .description("Scaffold canonical source file, lex.yaml, and target files")
    .option("--project-root <path>", "Project root directory")
    .option("--force", "Overwrite existing files")
    .option("--targets <hosts>", "Comma-separated host targets (default: copilot,cursor)")
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: InstructionsInitOptions = {
        projectRoot: cmdOptions.projectRoot,
        force: cmdOptions.force || false,
        targets: cmdOptions.targets,
        json: globalOptions.json || false,
      };
      await instructionsInit(options);
    });

  // lex instructions generate
  instructionsCommand
    .command("generate")
    .description("Generate host-specific instruction projections from canonical source")
    .option("--project-root <path>", "Project root directory")
    .option("--config <path>", "Path to lex.yaml config")
    .option("--dry-run", "Preview changes without writing")
    .option("--verbose", "Show detailed output")
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: InstructionsGenerateOptions = {
        projectRoot: cmdOptions.projectRoot,
        config: cmdOptions.config,
        dryRun: cmdOptions.dryRun || false,
        verbose: cmdOptions.verbose || globalOptions.verbose || false,
        json: globalOptions.json || false,
      };
      await instructionsGenerate(options);
    });

  // lex instructions check
  instructionsCommand
    .command("check")
    .description("Verify instruction files are in sync with canonical source")
    .option("--project-root <path>", "Project root directory")
    .option("--config <path>", "Path to lex.yaml config")
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: InstructionsCheckOptions = {
        projectRoot: cmdOptions.projectRoot,
        config: cmdOptions.config,
        json: globalOptions.json || false,
      };
      await instructionsCheck(options);
    });

  // lex code-atlas command
  program
    .command("code-atlas")
    .description("Extract code units from repository using static analysis")
    .option("--repo <path>", "Repository root (default: current directory)")
    .option("--include <pattern>", "Glob pattern for files (default: **/*.{ts,tsx,js,jsx,py})")
    .option("--exclude <pattern>", "Exclude pattern (default: **/node_modules/**)")
    .option("--max-files <n>", "Limit files scanned (default: 500)", parseInt)
    .option("--out <path>", "Output file path (default: stdout)")
    .option(
      "--strategy <type>",
      "Extraction strategy: static (default)",
      /^(static|llm-assisted|mixed)$/,
      "static"
    )
    .option("--policy-seed <path>", "Generate policy seed file from detected modules (YAML format)")
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: CodeAtlasOptions = {
        repo: cmdOptions.repo,
        include: cmdOptions.include,
        exclude: cmdOptions.exclude,
        maxFiles: cmdOptions.maxFiles,
        out: cmdOptions.out,
        strategy: cmdOptions.strategy,
        json: globalOptions.json || false,
        policySeed: cmdOptions.policySeed,
      };
      await codeAtlas(options);
    });

  // lex turncost command
  program
    .command("turncost")
    .description("Measure and analyze Turn Cost metrics (governance coordination cost)")
    .option("--period <duration>", "Time period for metrics (e.g., 24h, 7d, 30d)", "24h")
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: TurnCostOptions = {
        json: globalOptions.json || false,
        period: cmdOptions.period,
      };
      await turncost(options, programOptions.frameStore);
    });

  // lex dedupe command
  program
    .command("dedupe")
    .description("Detect and consolidate duplicate frames based on similarity scoring")
    .option("--dry-run", "Show what would be consolidated without making changes")
    .option("--threshold <number>", "Similarity threshold (0.0-1.0, default: 0.85)", parseFloat)
    .option("--auto", "Automatically consolidate duplicates without prompting")
    .option("--show-candidates", "Show duplicate candidates")
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: DedupeOptions = {
        dryRun: cmdOptions.dryRun || false,
        threshold: cmdOptions.threshold,
        auto: cmdOptions.auto || false,
        showCandidates: cmdOptions.showCandidates || false,
        json: globalOptions.json || false,
      };
      await dedupe(options, programOptions.frameStore);
    });

  // lex check contradictions command
  program
    .command("check-contradictions")
    .description("Scan all frames for contradictions")
    .option("--module <id>", "Filter by module ID")
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: CheckContradictionsOptions = {
        module: cmdOptions.module,
        json: globalOptions.json || false,
      };
      await checkContradictions(options, programOptions.frameStore);
    });

  // lex epic command group
  const epicCommand = program.command("epic").description("Epic/tracking issue operations");

  // lex epic sync
  epicCommand
    .command("sync <epic-ref>")
    .description("Sync epic status with actual sub-issue states (e.g., lexrunner#653)")
    .action(async (epicRef, _cmdOptions) => {
      const globalOptions = program.opts();
      const options: EpicSyncOptions = {
        json: globalOptions.json || false,
      };
      await epicSync(epicRef, options);
    });

  // lex wave command group
  const waveCommand = program.command("wave").description("Wave management operations");

  // lex wave complete command
  waveCommand
    .command("complete")
    .description("Emit wave completion frame with aggregated metrics")
    .option("--epic <ref>", "Epic issue reference (e.g., lexrunner#653)")
    .option("--wave <id>", "Wave identifier (e.g., 2 or wave-2)")
    .option("--epic-labels <labels>", "Comma-separated epic labels for keywords", parseList)
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: WaveCompleteOptions = {
        epic: cmdOptions.epic,
        wave: cmdOptions.wave,
        epicLabels: cmdOptions.epicLabels,
        json: globalOptions.json || false,
      };
      await waveComplete(options, programOptions.frameStore);
    });

  // lex introspect command
  program
    .command("introspect")
    .description("Discover current Lex state, policy, capabilities, and error codes")
    .option(
      "--format <type>",
      "Output format: full (default) or compact",
      /^(full|compact)$/,
      "full"
    )
    .action(async (cmdOptions) => {
      const globalOptions = program.opts();
      const options: IntrospectOptions = {
        json: globalOptions.json || false,
        format: cmdOptions.format,
      };
      await introspect(options, programOptions.frameStore);
    });

  // lex hints command
  program
    .command("hints [ids...]")
    .description("Retrieve hint details by hint ID (stable advice for error recovery)")
    .option("--list", "List all available hint IDs")
    .action(async (hintIds: string[], cmdOptions) => {
      const globalOptions = program.opts();
      const options: HintsOptions = {
        json: globalOptions.json || false,
        list: cmdOptions.list || false,
      };
      await hints(hintIds || [], options);
    });

  addWorkspaceAdminCommands(program, programOptions.workspaceAdmin);
  addKnowledgeCommands(program);

  return program;
}

/**
 * Parse comma-separated list
 */
function parseList(value: string): string[] | undefined {
  if (!value || !value.trim()) {
    return undefined;
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Run the CLI program
 */
export interface CliRuntimeScopeGuardV1 extends TrustedRuntimeScopeEntrypointGuardV1 {
  readonly frameStoreBinder?: ScopedFrameStoreBinder;
  readonly onResolved?: (
    result: Extract<TrustedRuntimeScopeBootstrapResultV1, { readonly resolved: true }>
  ) => void | Promise<void>;
  readonly emitDiagnostics: (diagnostics: DiagnosticEnvelopeV1) => void | Promise<void>;
}

export interface CliRunOptionsV1 {
  readonly runtimeScope?: CliRuntimeScopeGuardV1;
  readonly workspaceAdmin?: WorkspaceAdminCliV1;
}

export type { WorkspaceAdminCliV1 } from "./workspace.js";

function diagnosticRequestFromArgv(argv: readonly string[]): DiagnosticRequestV1 | undefined {
  const boundary = argv.indexOf("--");
  const runtimeArguments = boundary === -1 ? argv : argv.slice(0, boundary);
  if (!runtimeArguments.includes("--diagnostic")) return undefined;
  const equalsArgument = runtimeArguments.find((argument) =>
    argument.startsWith("--diagnostic-level=")
  );
  if (equalsArgument) {
    const level = equalsArgument.slice("--diagnostic-level=".length);
    if (level !== "summary" && level !== "full") return undefined;
    return Object.freeze({ schemaVersion: DIAGNOSTIC_CONTRACT_VERSION, level });
  }
  const index = runtimeArguments.indexOf("--diagnostic-level");
  const candidate = index === -1 ? undefined : runtimeArguments[index + 1];
  const level = candidate === "full" || candidate === "summary" ? candidate : "summary";
  return Object.freeze({ schemaVersion: DIAGNOSTIC_CONTRACT_VERSION, level });
}

/**
 * Run one CLI invocation. When a trusted runtime-scope guard is supplied, it
 * resolves before Commander dispatches any command and exposes scope only to
 * the injected callback that Phase 4 will use to bind the store.
 */
export async function run(
  argv: string[] = process.argv,
  options: CliRunOptionsV1 = {}
): Promise<void> {
  let scopedStore: ScopedFrameStore | undefined;
  let destinationSnapshot: DestinationSnapshotV1 | undefined;
  const boundary = argv.indexOf("--");
  const runtimeArguments = boundary === -1 ? argv : argv.slice(0, boundary);
  const hasDiagnosticLevel = runtimeArguments.some(
    (argument) => argument === "--diagnostic-level" || argument.startsWith("--diagnostic-level=")
  );
  if (hasDiagnosticLevel && !runtimeArguments.includes("--diagnostic")) {
    throw new AXErrorException(
      "VALIDATION_INVALID_TYPE",
      "--diagnostic-level requires --diagnostic.",
      ["Add --diagnostic or remove --diagnostic-level."]
    );
  }
  const diagnosticRequest = diagnosticRequestFromArgv(argv);
  if (diagnosticRequest && !options.runtimeScope) {
    throw new AXErrorException(
      "LEX_WORKSPACE_UNBOUND",
      "Runtime-scope diagnostics require a configured trusted bootstrap.",
      ["Configure trusted workspace bootstrap before requesting --diagnostic."]
    );
  }
  const operation =
    options.runtimeScope || options.workspaceAdmin ? trustedCliOperationFromArgv(argv) : undefined;
  const workspaceAdministration = operation?.startsWith("workspace:") ?? false;
  if (workspaceAdministration && !options.workspaceAdmin) {
    throw new AXErrorException(
      "LEX_WORKSPACE_UNBOUND",
      "Trusted workspace administration is not configured for this Lex host.",
      ["Configure an AuthorityDirectory and explicit workspace administration service."]
    );
  }
  if (options.runtimeScope && operation && !workspaceAdministration) {
    const requestedCapabilities = capabilitiesForCliInvocation(argv);
    if (operation.startsWith("db:")) {
      throw new AXErrorException(
        "LEX_FRAME_STORE_INVALID_SCOPE",
        "Legacy database maintenance is not available through the normal scope-bound store.",
        ["Use a separately authorized physical FrameStore administration adapter."]
      );
    }
    if (
      requestedCapabilities.some((capability) => capability.startsWith("frame:")) &&
      !options.runtimeScope.frameStoreBinder
    ) {
      throw new AXErrorException(
        "LEX_FRAME_STORE_INVALID_SCOPE",
        "Trusted runtime scope is configured without a scope-bound FrameStore.",
        ["Configure a ScopedFrameStoreBinder before dispatching Frame operations."]
      );
    }
    const result = await authorizeTrustedRuntimeEntrypoint(
      options.runtimeScope,
      "cli",
      requestedCapabilities,
      diagnosticRequest
    );
    if (result.diagnostics) {
      await options.runtimeScope.emitDiagnostics(result.diagnostics);
    }
    if (!result.resolved) {
      throw new AXErrorException(
        result.error.code,
        result.error.message,
        ["Inspect the local workspace binding or perform an explicit administrative bind."],
        result.diagnostics ? { diagnostics: result.diagnostics } : undefined
      );
    }
    if (options.runtimeScope.frameStoreBinder) {
      scopedStore = options.runtimeScope.frameStoreBinder.bind(result.authorizedScope);
    }
    try {
      if (scopedStore && (operation === "remember" || operation === "destination")) {
        const metadata = scopedStore.getMetadata();
        destinationSnapshot = createDestinationSnapshot(
          result.invocationContext,
          result.authorizedScope,
          {
            kind: metadata.backend,
            identity: metadata.backendIdentity ?? UNVERIFIED_BACKEND_IDENTITY,
            ...(metadata.namespace ? { namespace: metadata.namespace } : {}),
          },
          options.runtimeScope.request.bootstrap.executionSurface
        );
      }
      await options.runtimeScope.onResolved?.(result);
    } catch (error) {
      await scopedStore?.close();
      throw error;
    }
  }
  const program = createProgram({
    runtimeScopeDiagnostics: options.runtimeScope !== undefined,
    ...(scopedStore ? { frameStore: scopedFrameStoreAsLegacyView(scopedStore) } : {}),
    ...(destinationSnapshot ? { destination: destinationSnapshot } : {}),
    ...(options.workspaceAdmin ? { workspaceAdmin: options.workspaceAdmin } : {}),
  });
  try {
    await program.parseAsync(argv);
  } finally {
    await scopedStore?.close();
  }
}

// Direct execution detection - guide users to correct entry point
// This module is a library; use lex.js for CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  output.error("This is the library module, not the CLI entry point.");
  output.info("Use: node dist/shared/cli/lex.js <command>");
  output.info("Or:  npx lex <command>");
  process.exit(1);
}
