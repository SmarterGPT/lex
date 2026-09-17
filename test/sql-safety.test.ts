/**
 * SQL Safety Test
 *
 * Ensures that db.prepare() calls only appear in curated SQL modules.
 * This is a guardrail to prevent dynamic SQL from models/prompts.
 *
 * Curated SQL modules (allowed to use db.prepare):
 * - src/memory/store/queries.ts (Frame CRUD)
 * - src/memory/store/code-unit-queries.ts (CodeUnit CRUD)
 * - src/memory/store/receipt-queries.ts (Receipt CRUD and aggregation)
 * - src/memory/store/db.ts (schema initialization)
 * - src/memory/store/backup.ts (backup utilities)
 * - src/memory/store/code-atlas-runs.ts (CodeAtlas run tracking)
 * - src/memory/store/sqlite/ (SqliteFrameStore implementation)
 * - src/memory/mcp_server/auth/state-storage.ts (OAuth state)
 * - src/memory/mcp_server/routes/*.ts (MCP route handlers)
 * - src/shared/cli/db.ts (CLI database utilities)
 * - src/shared/runtime-scope/registry-queries.ts (local binding registry)
 * - src/knowledge/store-queries.ts (KnowledgeFrame snapshot persistence)
 *
 * @see .github/copilot-instructions.md for SQL safety rules
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "path";

// Allowed paths for db.prepare() usage (relative to src/)
const ALLOWED_PATTERNS = [
  "memory/store/queries.ts",
  "memory/store/code-unit-queries.ts",
  "memory/store/lexsona-queries.ts",
  "memory/store/receipt-queries.ts",
  "memory/store/db.ts",
  "memory/store/backup.ts",
  "memory/store/code-atlas-runs.ts",
  "memory/store/images.ts",
  "memory/store/sqlite/", // SqliteFrameStore and future sqlite implementations
  "memory/mcp_server/auth/state-storage.ts",
  "memory/mcp_server/routes/",
  "shared/cli/db.ts",
  "shared/runtime-scope/registry-queries.ts",
  "knowledge/store-queries.ts",
];

function scanSourceLines(repoRoot: string, pattern: RegExp): string[] {
  function walk(relative: string): string[] {
    return readdirSync(join(repoRoot, relative), { withFileTypes: true }).flatMap((entry) => {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) return walk(path);
      if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
      return readFileSync(join(repoRoot, path), "utf8")
        .split(/\r?\n/)
        .flatMap((line, index) => (pattern.test(line) ? [`${path}:${index + 1}:${line}`] : []));
    });
  }
  return walk("src");
}

describe("SQL Safety", () => {
  it("should only use db.prepare() in curated SQL modules", () => {
    const repoRoot = join(import.meta.dirname, "..");

    const violations: string[] = [];
    const lines = scanSourceLines(repoRoot, /\.prepare\(/);

    for (const line of lines) {
      // Extract file path from grep output (format: "path:line:content")
      const match = line.match(/^src\/([^:]+):/);
      if (!match) continue;

      const filePath = match[1];

      // Check if this file is in an allowed path
      const isAllowed = ALLOWED_PATTERNS.some(
        (pattern) => filePath.startsWith(pattern) || filePath === pattern
      );

      if (!isAllowed) {
        violations.push(line);
      }
    }

    if (violations.length > 0) {
      assert.fail(
        `Found db.prepare() calls outside curated SQL modules:\n\n` +
          violations.join("\n") +
          `\n\n` +
          `All SQL must live in curated modules:\n` +
          ALLOWED_PATTERNS.map((p) => `  - src/${p}`).join("\n") +
          `\n\n` +
          `To fix this violation, move your SQL to a curated query module.\n` +
          `See TROUBLESHOOTING.md "SQL Safety Violations" section for:\n` +
          `  - Before/after refactor examples\n` +
          `  - Step-by-step remediation guide\n` +
          `  - Security best practices\n` +
          `\n` +
          `Quick fix: Extract your SQL into a function in src/memory/store/queries.ts\n` +
          `and import that function instead of using db.prepare() directly.`
      );
    }
  });

  it("should not have dynamic SQL string interpolation in curated modules", () => {
    const repoRoot = join(import.meta.dirname, "..");

    // Preserve the existing single-line heuristic; filesystem errors fail the gate.
    const lines = scanSourceLines(repoRoot, /\.prepare\(`[^`]*\$\{/);

    // Filter out legitimate dynamic SQL (e.g., building WHERE clauses with validated columns)
    const dangerous: string[] = [];
    for (const line of lines) {
      // Allow: SET clauses built from validated column names
      // Allow: ORDER BY with validated column names
      // Disallow: Table names, raw user input in WHERE
      if (
        line.includes("${table}") ||
        line.includes("${tableName}") ||
        line.includes("${userInput}") ||
        line.includes("${input}")
      ) {
        dangerous.push(line);
      }
    }

    if (dangerous.length > 0) {
      assert.fail(
        `Found potentially dangerous dynamic SQL:\n\n` +
          dangerous.join("\n") +
          `\n\n` +
          `Dynamic table/input interpolation is forbidden. Use parameterized queries.`
      );
    }
  });
});
