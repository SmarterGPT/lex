/**
 * Init Command - Initialize .smartergpt/ workspace
 *
 * Zero-to-value onboarding: one command to get from zero to working Lex setup.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { promptForFirstFrameSummary } from "./interactive-prompts.js";
import * as output from "./output.js";
import { discoverModules, generatePolicyFile } from "./policy-generator.js";
import { AXErrorException } from "../errors/ax-error.js";
import { detectProject, describeProject } from "./project-detector.js";
import { wrapWithMarkers } from "../instructions/markers.js";

// ESM compatibility: create __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface InitOptions {
  force?: boolean;
  json?: boolean;
  store?: string; // Explicit FrameStore backend for initialization
  promptsDir?: string; // Optional: custom prompts directory
  policy?: boolean; // Generate seed policy from directory structure
  srcDir?: string; // Optional constrained discovery root for policy generation
  instructions?: boolean; // Create canonical instructions file (default: true)
  mcp?: boolean; // Generate .vscode/mcp.json for MCP server configuration
  yes?: boolean; // Non-interactive mode (skip prompts)
  interactive?: boolean; // Interactive mode (prompt for first frame)
}

export interface InitResult {
  success: boolean;
  workspaceDir: string;
  message: string;
  filesCreated: string[];
  storeBackend?: InitStoreBackend;
  storeSource?: InitStoreSource;
  modulesDiscovered?: number;
  instructionsCreated?: boolean;
  mcpConfigCreated?: boolean;
  projectType?: string;
  databaseInitialized?: boolean;
  mcpGuidanceShown?: boolean;
}

export type InitStoreBackend = "sqlite" | "postgres";
export type InitStoreSource = "--store" | "LEX_STORE" | "LEX_DATABASE_URL" | "default";

export interface InitStoreResolution {
  backend: InitStoreBackend;
  source: InitStoreSource;
}

/**
 * Resolve init's storage backend without opening either store.
 *
 * The explicit option wins, followed by LEX_STORE. A configured PostgreSQL URL
 * is also sufficient for init to take the SQLite-free bootstrap path. Other
 * commands retain the normal FrameStore resolution contract.
 */
export function resolveInitStoreBackend(
  option: string | undefined = undefined,
  environment: NodeJS.ProcessEnv = process.env
): InitStoreResolution {
  const optionValue = option?.trim().toLowerCase();
  const envValue = environment.LEX_STORE?.trim().toLowerCase();
  const value = optionValue || envValue;

  if (value && value !== "sqlite" && value !== "postgres") {
    const source = optionValue ? "--store" : "LEX_STORE";
    throw new Error(`Unsupported ${source} value: ${value}. Expected sqlite or postgres.`);
  }

  if (optionValue) {
    return { backend: optionValue as InitStoreBackend, source: "--store" };
  }
  if (envValue) {
    return { backend: envValue as InitStoreBackend, source: "LEX_STORE" };
  }
  if (environment.LEX_DATABASE_URL?.trim()) {
    return { backend: "postgres", source: "LEX_DATABASE_URL" };
  }
  return { backend: "sqlite", source: "default" };
}

/**
 * Resolve path to canon directory in package
 */
function resolveCanonDir(): string {
  // Walk up from dist/shared/cli/ to package root
  let pkgRoot = path.dirname(__dirname);
  while (pkgRoot !== path.dirname(pkgRoot)) {
    const pkgJsonPath = path.join(pkgRoot, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      return path.join(pkgRoot, "canon");
    }
    pkgRoot = path.dirname(pkgRoot);
  }
  throw new AXErrorException(
    "PACKAGE_ROOT_NOT_FOUND",
    "Could not find package root",
    [
      "Ensure the package is properly installed",
      "Check that package.json exists in the package root",
      "Verify the installation directory structure is intact",
    ],
    { searchPath: __dirname, operation: "init" }
  );
}

/**
 * Initialize .smartergpt/ workspace with prompts and policy
 * Enhanced for zero-to-value onboarding
 */
export async function init(options: InitOptions = {}): Promise<InitResult> {
  const baseDir = process.cwd();
  const workspaceDir = path.join(baseDir, ".smartergpt");
  const promptsDir = options.promptsDir
    ? path.resolve(baseDir, options.promptsDir)
    : path.join(workspaceDir, "prompts");

  // Detect project type
  const projectDetection = detectProject(baseDir);
  const projectDesc = describeProject(projectDetection);

  let storeResolution: InitStoreResolution;
  try {
    storeResolution = resolveInitStoreBackend(options.store);
  } catch (error) {
    const result: InitResult = {
      success: false,
      workspaceDir,
      message: `Failed to initialize workspace: ${error instanceof Error ? error.message : String(error)}`,
      filesCreated: [],
      projectType: projectDesc,
    };

    if (options.json) {
      output.json(result);
    } else {
      output.error(result.message);
    }
    return result;
  }

  // Show detection results (unless in JSON mode)
  if (!options.json) {
    output.info("🔍 Detecting project...");
    output.info(`   Found: ${projectDesc}`);
    output.info("");
    output.info(
      `💾 Storage backend: ${storeResolution.backend === "postgres" ? "PostgreSQL" : "SQLite"} (${storeResolution.source})`
    );
    if (storeResolution.backend === "postgres") {
      output.info("   SQLite database creation disabled");
    }
    output.info("");
  }

  const filesCreated: string[] = [];

  try {
    // Create .smartergpt/ directory
    fs.mkdirSync(workspaceDir, { recursive: true });

    // Create prompts directory
    fs.mkdirSync(promptsDir, { recursive: true });

    // Copy canon/prompts to .smartergpt/prompts (or custom location)
    const canonDir = resolveCanonDir();
    const canonPromptsDir = path.join(canonDir, "prompts");

    if (fs.existsSync(canonPromptsDir)) {
      const promptFiles = fs.readdirSync(canonPromptsDir);
      for (const file of promptFiles) {
        const srcPath = path.join(canonPromptsDir, file);
        const destPath = path.join(promptsDir, file);

        // Skip if file exists and not force
        if (fs.existsSync(destPath) && !options.force) {
          continue;
        }

        // Copy only files, not subdirectories
        if (fs.statSync(srcPath).isFile()) {
          fs.copyFileSync(srcPath, destPath);
          filesCreated.push(path.relative(baseDir, destPath));
        }
      }
    } else {
      // Create .gitkeep if no canon prompts found
      const gitkeepPath = path.join(promptsDir, ".gitkeep");
      fs.writeFileSync(gitkeepPath, "");
      filesCreated.push(path.relative(baseDir, gitkeepPath));
    }

    // Create lexmap.policy.json template in .smartergpt/lex/ subdirectory
    const lexDir = path.join(workspaceDir, "lex");
    fs.mkdirSync(lexDir, { recursive: true });
    const policyPath = path.join(lexDir, "lexmap.policy.json");
    let modulesDiscovered = 0;

    if (!fs.existsSync(policyPath) || options.force) {
      if (options.policy) {
        // Generate seed policy from directory structure
        const modules = discoverModules({ rootDir: baseDir, srcDir: options.srcDir });
        modulesDiscovered = modules.length;

        if (modules.length > 0) {
          const policy = generatePolicyFile(modules);
          fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2) + "\n");
          filesCreated.push(path.relative(baseDir, policyPath));
        } else {
          // No modules found, create minimal policy
          const minimalPolicy = {
            schemaVersion: "1.0.0",
            modules: {},
          };
          fs.writeFileSync(policyPath, JSON.stringify(minimalPolicy, null, 2) + "\n");
          filesCreated.push(path.relative(baseDir, policyPath) + " (minimal)");
        }
      } else {
        // Use example policy or create minimal policy
        const packageRoot = path.dirname(canonDir);
        const examplePath = path.join(
          packageRoot,
          "src/policy/policy_spec/lexmap.policy.json.example"
        );

        if (fs.existsSync(examplePath)) {
          fs.copyFileSync(examplePath, policyPath);
          filesCreated.push(path.relative(baseDir, policyPath));
        } else {
          // Create minimal policy if no template found
          const minimalPolicy = {
            schemaVersion: "1.0.0",
            modules: {},
          };
          fs.writeFileSync(policyPath, JSON.stringify(minimalPolicy, null, 2) + "\n");
          filesCreated.push(path.relative(baseDir, policyPath) + " (minimal)");
        }
      }
    }

    // Create instructions directory and canonical instructions file
    // Default to true unless explicitly set to false
    const shouldCreateInstructions = options.instructions !== false;
    let instructionsCreated = false;

    if (shouldCreateInstructions) {
      const instructionsDir = path.join(workspaceDir, "instructions");
      fs.mkdirSync(instructionsDir, { recursive: true });

      const instructionsPath = path.join(instructionsDir, "lex.md");

      if (!fs.existsSync(instructionsPath) || options.force) {
        const canonInstructionsPath = path.join(canonDir, "instructions", "lex.example.md");

        if (fs.existsSync(canonInstructionsPath)) {
          fs.copyFileSync(canonInstructionsPath, instructionsPath);
          filesCreated.push(path.relative(baseDir, instructionsPath));
          instructionsCreated = true;
        }
      }
    }

    // Generate IDE instruction files (.github/copilot-instructions.md and .cursorrules)
    // if not in JSON mode and instructions were created
    if (!options.json && shouldCreateInstructions) {
      output.info("📝 Creating IDE instruction files...");
    }

    // Create .github/copilot-instructions.md with LEX markers
    const copilotDir = path.join(baseDir, ".github");
    const copilotPath = path.join(copilotDir, "copilot-instructions.md");

    if (!fs.existsSync(copilotPath) || options.force) {
      fs.mkdirSync(copilotDir, { recursive: true });
      const copilotContent = getIDEInstructionContent("copilot");
      const wrappedContent = wrapWithMarkers(copilotContent);
      fs.writeFileSync(copilotPath, wrappedContent, "utf-8");
      filesCreated.push(path.relative(baseDir, copilotPath));
      if (!options.json) {
        output.info(`   ✓ Added Lex instruction block to ${path.relative(baseDir, copilotPath)}`);
      }
    }

    // Create .cursorrules if Cursor is detected
    if (projectDetection.hasCursor || options.force) {
      const cursorPath = path.join(baseDir, ".cursorrules");
      if (!fs.existsSync(cursorPath) || options.force) {
        const cursorContent = getIDEInstructionContent("cursor");
        const wrappedContent = wrapWithMarkers(cursorContent);
        fs.writeFileSync(cursorPath, wrappedContent, "utf-8");
        filesCreated.push(path.relative(baseDir, cursorPath));
        if (!options.json) {
          output.info(`   ✓ Created ${path.relative(baseDir, cursorPath)}`);
        }
      }
    }

    if (!options.json) {
      output.info("");
    }

    // Create lex.yaml with sensible defaults
    if (!options.json) {
      output.info("⚙️  Creating lex.yaml...");
    }

    const lexYamlPath = path.join(baseDir, "lex.yaml");
    if (!fs.existsSync(lexYamlPath) || options.force) {
      const lexYamlContent = getLexYamlContent(projectDetection);
      fs.writeFileSync(lexYamlPath, lexYamlContent, "utf-8");
      filesCreated.push(path.relative(baseDir, lexYamlPath));
      if (!options.json) {
        output.info("   ✓ Default configuration");
        output.info("");
      }
    }

    // Preserve the existing lazy SQLite initialization behavior, but never
    // inspect or create memory.db for a PostgreSQL bootstrap.
    const dbPath = path.join(lexDir, "memory.db");
    const databaseInitialized = storeResolution.backend === "sqlite" && !fs.existsSync(dbPath);

    if (!options.json && databaseInitialized) {
      output.info("💾 Initializing database...");
      output.info(`   ✓ ${path.relative(baseDir, dbPath)} ready on first SQLite use`);
      output.info("");
    }

    // Generate MCP config if requested
    let mcpConfigCreated = false;
    if (options.mcp) {
      const vscodeDir = path.join(baseDir, ".vscode");
      const mcpConfigPath = path.join(vscodeDir, "mcp.json");

      if (!fs.existsSync(mcpConfigPath) || options.force) {
        fs.mkdirSync(vscodeDir, { recursive: true });
        const mcpConfig = getMCPConfig(storeResolution.backend);
        fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 4) + "\n");
        filesCreated.push(path.relative(baseDir, mcpConfigPath));
        mcpConfigCreated = true;

        if (!options.json) {
          output.info("📡 MCP Configuration:");
          output.info(`   ✓ Created ${path.relative(baseDir, mcpConfigPath)}`);
          output.info("");
        }
      }
    }

    // Show MCP guidance (only if not creating config)
    let mcpGuidanceShown = false;
    if (!options.json && !mcpConfigCreated) {
      showMCPGuidance(projectDetection, storeResolution.backend);
      mcpGuidanceShown = true;
    }

    // Interactive first frame (if not --yes and not JSON)
    if (options.interactive && !options.yes && !options.json) {
      await promptFirstFrame(baseDir);
    }

    const result: InitResult = {
      success: true,
      workspaceDir,
      message:
        filesCreated.length > 0
          ? "Workspace initialized successfully"
          : "Workspace already initialized; no changes needed",
      filesCreated,
      storeBackend: storeResolution.backend,
      storeSource: storeResolution.source,
      modulesDiscovered: options.policy ? modulesDiscovered : undefined,
      instructionsCreated,
      mcpConfigCreated,
      projectType: projectDesc,
      databaseInitialized,
      mcpGuidanceShown,
    };

    if (options.json) {
      output.json(result);
    } else {
      displaySuccessMessage(result, baseDir, projectDesc, modulesDiscovered, options);
    }

    return result;
  } catch (error) {
    const result: InitResult = {
      success: false,
      workspaceDir,
      message: `Failed to initialize workspace: ${error instanceof Error ? error.message : String(error)}`,
      filesCreated,
    };

    if (options.json) {
      output.json(result);
    } else {
      output.error(
        `Failed to initialize workspace: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return result;
  }
}

/**
 * Get IDE instruction content for a specific host
 */
function getIDEInstructionContent(_host: "copilot" | "cursor"): string {
  return `# Lex Instructions

This content is auto-generated from the canonical source.
Run \`lex instructions generate\` to update.

## Getting Started with Lex

Lex provides work continuity and policy enforcement for this repository.

### Core Commands

\`\`\`bash
lex remember    # Save context after completing work
lex recall      # Retrieve context from previous sessions
lex check       # Validate code against policy
\`\`\`

### Workflow

1. At the end of a session, use \`lex remember\` to capture context
2. At the start of the next session, use \`lex recall\` to restore context
3. Use \`lex check\` to validate changes against project policy

For more information, see the canonical instructions at \`.smartergpt/instructions/lex.md\`.
`;
}

/**
 * Get lex.yaml content with defaults based on project detection
 */
function getLexYamlContent(detection: ReturnType<typeof detectProject>): string {
  const hasCopilot = true; // Always enable Copilot
  const hasCursor = detection.hasCursor;

  return `# Lex Configuration
# See: https://github.com/Guffawaffle/lex

version: 1

instructions:
  # Canonical source of AI instructions
  canonical: .smartergpt/instructions/lex.md

  # Which hosts to project to (auto-detected if omitted)
  projections:
    copilot: ${hasCopilot}
    cursor: ${hasCursor}
`;
}

/**
 * Generate MCP server configuration for VS Code
 */
function getMCPConfig(storeBackend: InitStoreBackend): object {
  const env: Record<string, string> = {
    LEX_WORKSPACE_ROOT: "${workspaceFolder}",
  };
  if (storeBackend === "postgres") {
    env.LEX_STORE = "postgres";
  }

  return {
    servers: {
      lex: {
        type: "stdio",
        command: "npx",
        args: ["@smartergpt/lex-mcp"],
        env,
      },
    },
  };
}

/**
 * Show MCP server configuration guidance
 */
function showMCPGuidance(
  detection: ReturnType<typeof detectProject>,
  storeBackend: InitStoreBackend
): void {
  output.info("📡 MCP Setup:");

  if (detection.hasVSCode) {
    output.info("   For VS Code, add to settings.json:");
  } else {
    output.info("   To use with VS Code, add to settings.json:");
  }

  output.info("   {");
  output.info('     "mcp.servers": {');
  output.info('       "lex": {');
  output.info('         "command": "npx",');
  output.info('         "args": ["@smartergpt/lex", "mcp"],');
  output.info('         "env": {');
  output.info(
    '           "LEX_WORKSPACE_ROOT": "${workspaceFolder}"' +
      (storeBackend === "postgres" ? "," : "")
  );
  if (storeBackend === "postgres") {
    output.info('           "LEX_STORE": "postgres"');
  }
  output.info("         }");
  output.info("       }");
  output.info("     }");
  output.info("   }");
  output.info("");
}

/**
 * Prompt user to create first frame (interactive mode)
 */
async function promptFirstFrame(_baseDir: string): Promise<void> {
  try {
    const summary = await promptForFirstFrameSummary();

    if (summary !== undefined) {
      output.info("");
      output.info("Creating your first Frame...");
      output.info(`Summary: ${summary}`);
      output.info("");
      output.info("✓ Frame created! Run 'lex recall' next session to retrieve this context.");
      output.info("");
    }
  } catch {
    // User cancelled or error occurred - gracefully continue
  }
}

/**
 * Display success message with all created files and next steps
 */
function displaySuccessMessage(
  result: InitResult,
  _baseDir: string,
  _projectDesc: string,
  _modulesDiscovered: number,
  _options: InitOptions
): void {
  if (result.filesCreated.length > 0) {
    output.info("📁 Files created or updated:");
    for (const file of result.filesCreated) {
      output.info(`   ✓ ${file}`);
    }
  } else {
    output.info("📁 No files changed; workspace bootstrap is already complete.");
  }
  output.info("");
  output.info(
    `💾 Active backend: ${result.storeBackend === "postgres" ? "PostgreSQL (SQLite-free)" : "SQLite"}`
  );
  output.info("");
  output.info("🎯 Quick start:");
  output.info("   lex remember    # Save context after work");
  output.info("   lex recall      # Retrieve context next session");
  output.info("");
  output.info('✨ Done! Run `lex recall "getting started"` to test.');
}
