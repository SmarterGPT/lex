/**
 * Tests for help MCP tool (AX #577)
 *
 * Verifies that the help tool provides:
 * - Structured documentation for all tools
 * - Executable examples
 * - Related tools and workflows
 * - Correct error handling for unknown tools
 */

import { test, describe } from "node:test";
import assert from "node:assert";
import { MCP_TOOLS } from "@app/memory/mcp_server/tools.js";
import { MCP_TOOL_ALIASES } from "@app/shared/runtime-scope/capabilities.js";
import { MCPServer } from "@app/memory/mcp_server/server.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Help MCP Tool (AX #577)", () => {
  let server: MCPServer;
  let testDbPath: string;
  let tmpDir: string;

  function setup() {
    tmpDir = mkdtempSync(join(tmpdir(), "help-tool-"));
    testDbPath = join(tmpDir, "test.db");
    server = new MCPServer(testDbPath);
    return server;
  }

  async function teardown() {
    if (server) {
      await server.close();
    }
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  describe("Tool registration", () => {
    test("help tool should be in tools/list", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/list",
          params: {},
        });

        assert.ok(response.tools, "Should have tools array");
        const toolNames = (response.tools as Array<{ name: string }>).map((t) => t.name);
        assert.ok(toolNames.includes("help"), "help should be in tools list");
      } finally {
        await teardown();
      }
    });
  });

  test("every advertised canonical name and deprecated alias resolves to canonical help", async () => {
    const srv = setup();
    try {
      const description = (
        MCP_TOOLS.find((t) => t.name === "help")!.inputSchema.properties.tool as {
          description: string;
        }
      ).description;
      const advertised = description
        .split("Canonical names: ")[1]
        .split(". Deprecated aliases are also accepted: ");
      const names = [...advertised[0].split(", "), ...advertised[1].replace(/\.$/, "").split(", ")];
      assert.deepEqual(
        new Set(names),
        new Set([...MCP_TOOLS.map((t) => t.name), ...Object.keys(MCP_TOOL_ALIASES)])
      );
      for (const name of names) {
        for (const format of ["full", "micro"]) {
          const response = await srv.handleRequest({
            method: "tools/call",
            params: {
              name: "help",
              arguments: { tool: name, format },
            },
          });
          assert.ok(!response.isError, `${name}: ${format}`);
          assert.equal(
            (response.data as { tool: string }).tool,
            (MCP_TOOL_ALIASES as Record<string, string>)[name] ?? name
          );
        }
      }
    } finally {
      await teardown();
    }
  });

  describe("All tools help", () => {
    test("should return help for all tools when no tool specified", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: {},
          },
        });

        assert.ok(response.content, "Response should have content");
        assert.ok(response.data, "Response should have structured data");

        const data = response.data as Record<string, unknown>;
        assert.ok(data.tools, "Data should have tools object");
        assert.ok(data.workflows, "Data should have workflows object");

        // Verify all expected tools are documented
        const tools = data.tools as Record<string, unknown>;
        const expectedTools = [
          "frame_create",
          "frame_validate",
          "frame_search",
          "frame_get",
          "frame_list",
          "policy_check",
          "timeline_show",
          "atlas_analyze",
          "system_introspect",
          "help",
          "hints_get",
        ];
        for (const toolName of expectedTools) {
          assert.ok(tools[toolName], `Should have help for ${toolName}`);
        }
      } finally {
        await teardown();
      }
    });

    test("should include workflows in all-tools response", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: {},
          },
        });

        const data = response.data as Record<string, unknown>;
        const workflows = data.workflows as Record<string, unknown>;

        // Check for expected workflows
        assert.ok(workflows["store-then-recall"], "Should have store-then-recall workflow");
        assert.ok(workflows["timeline-tracking"], "Should have timeline-tracking workflow");
        assert.ok(workflows["initial-discovery"], "Should have initial-discovery workflow");
      } finally {
        await teardown();
      }
    });
  });

  describe("Single tool help", () => {
    test("should return detailed help for remember tool", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "frame_create" },
          },
        });

        const data = response.data as Record<string, unknown>;

        assert.strictEqual(data.tool, "frame_create");
        assert.ok(data.description, "Should have description");
        assert.ok(Array.isArray(data.requiredFields), "Should have requiredFields array");
        assert.ok(Array.isArray(data.optionalFields), "Should have optionalFields array");
        assert.ok(Array.isArray(data.relatedTools), "Should have relatedTools array");
        assert.ok(Array.isArray(data.workflows), "Should have workflows array");
        assert.ok(Array.isArray(data.examples), "Should have examples array");

        // Check required fields
        const requiredFields = data.requiredFields as string[];
        assert.ok(requiredFields.includes("reference_point"));
        assert.ok(requiredFields.includes("summary_caption"));
        assert.ok(requiredFields.includes("status_snapshot"));
        assert.ok(requiredFields.includes("module_scope"));

        const writeContract = data.frameWriteContract as Record<string, unknown>;
        const fallback = writeContract.fallback as Record<string, unknown>;
        assert.strictEqual(fallback.moduleId, "workspace/unscoped");
        assert.deepStrictEqual(fallback.input, {
          module_scope: ["workspace/unscoped"],
        });
        assert.ok(
          response.content[0].text.includes('{"module_scope":["workspace/unscoped"]}'),
          "Help should render the exact fallback payload"
        );
      } finally {
        await teardown();
      }
    });

    test("should return detailed help for recall tool", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "frame_search" },
          },
        });

        const data = response.data as Record<string, unknown>;

        assert.strictEqual(data.tool, "frame_search");
        assert.ok(data.description, "Should have description");

        // recall has no required fields
        const requiredFields = data.requiredFields as string[];
        assert.strictEqual(requiredFields.length, 0, "recall should have no required fields");

        // Check optional fields
        const optionalFields = data.optionalFields as string[];
        assert.ok(optionalFields.includes("reference_point"));
        assert.ok(optionalFields.includes("jira"));
        assert.ok(optionalFields.includes("branch"));
      } finally {
        await teardown();
      }
    });

    test("should error for unknown tool", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "nonexistent_tool" },
          },
        });

        assert.ok(response.error, "Should have error");
        assert.ok(
          response.error.message.includes("Unknown tool"),
          "Error should mention unknown tool"
        );
      } finally {
        await teardown();
      }
    });
  });

  describe("Examples", () => {
    test("should include examples by default", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "frame_create" },
          },
        });

        const data = response.data as Record<string, unknown>;
        const examples = data.examples as Array<{
          description: string;
          input: Record<string, unknown>;
        }>;

        assert.ok(examples.length > 0, "Should have at least one example");
        assert.ok(examples[0].description, "Example should have description");
        assert.ok(examples[0].input, "Example should have input");
      } finally {
        await teardown();
      }
    });

    test("should exclude examples when examples=false", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "frame_create", examples: false },
          },
        });

        const data = response.data as Record<string, unknown>;
        assert.ok(!data.examples, "Should not have examples when examples=false");
      } finally {
        await teardown();
      }
    });

    test("examples should have valid structure", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "frame_create" },
          },
        });

        const data = response.data as Record<string, unknown>;
        const examples = data.examples as Array<{
          description: string;
          input: Record<string, unknown>;
        }>;

        // Verify first example has expected fields
        const firstExample = examples[0];
        assert.ok(firstExample.input.reference_point, "Example should have reference_point");
        assert.ok(firstExample.input.summary_caption, "Example should have summary_caption");
        assert.ok(firstExample.input.status_snapshot, "Example should have status_snapshot");
        assert.ok(firstExample.input.module_scope, "Example should have module_scope");
      } finally {
        await teardown();
      }
    });
  });

  describe("Related tools", () => {
    test("frame_create should list frame_search as related", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "frame_create" },
          },
        });

        const data = response.data as Record<string, unknown>;
        const relatedTools = data.relatedTools as string[];

        assert.ok(
          relatedTools.includes("frame_search"),
          "frame_create should be related to frame_search"
        );
      } finally {
        await teardown();
      }
    });

    test("frame_search should list frame_create as related", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "frame_search" },
          },
        });

        const data = response.data as Record<string, unknown>;
        const relatedTools = data.relatedTools as string[];

        assert.ok(
          relatedTools.includes("frame_create"),
          "frame_search should be related to frame_create"
        );
      } finally {
        await teardown();
      }
    });
  });

  describe("Text output", () => {
    test("should include markdown-formatted text output", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "frame_create" },
          },
        });

        const text = (response.content as Array<{ text: string }>)[0].text;

        assert.ok(text.includes("# frame_create"), "Should have tool name as header");
        assert.ok(text.includes("## Required Fields"), "Should have Required Fields section");
        assert.ok(text.includes("## Optional Fields"), "Should have Optional Fields section");
        assert.ok(text.includes("## Related Tools"), "Should have Related Tools section");
        assert.ok(text.includes("## Workflows"), "Should have Workflows section");
        assert.ok(text.includes("## Examples"), "Should have Examples section");
      } finally {
        await teardown();
      }
    });

    test("all-tools text should include summary", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: {},
          },
        });

        const text = (response.content as Array<{ text: string }>)[0].text;

        assert.ok(text.includes("# Lex MCP Tools Help"), "Should have main header");
        assert.ok(text.includes("## Available Tools"), "Should have Available Tools section");
        assert.ok(text.includes("## Common Workflows"), "Should have Common Workflows section");
      } finally {
        await teardown();
      }
    });
  });

  describe("All tools documentation completeness", () => {
    const allTools = [
      "frame_create",
      "frame_validate",
      "frame_search",
      "frame_get",
      "frame_list",
      "policy_check",
      "timeline_show",
      "atlas_analyze",
      "system_introspect",
      "help",
    ];

    for (const toolName of allTools) {
      test(`${toolName} should have complete documentation`, async () => {
        const srv = setup();
        try {
          const response = await srv.handleRequest({
            method: "tools/call",
            params: {
              name: "help",
              arguments: { tool: toolName },
            },
          });

          const data = response.data as Record<string, unknown>;

          assert.strictEqual(data.tool, toolName, `Tool name should be ${toolName}`);
          assert.ok(
            typeof data.description === "string" && data.description.length > 0,
            `${toolName} should have non-empty description`
          );
          assert.ok(
            Array.isArray(data.requiredFields),
            `${toolName} should have requiredFields array`
          );
          assert.ok(
            Array.isArray(data.optionalFields),
            `${toolName} should have optionalFields array`
          );
          assert.ok(Array.isArray(data.relatedTools), `${toolName} should have relatedTools array`);
          assert.ok(Array.isArray(data.workflows), `${toolName} should have workflows array`);
          assert.ok(
            Array.isArray(data.examples) && (data.examples as unknown[]).length > 0,
            `${toolName} should have at least one example`
          );
        } finally {
          await teardown();
        }
      });
    }
  });

  describe("Micro format (AX #013)", () => {
    test("should support format=micro parameter", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "frame_create", format: "micro" },
          },
        });

        const data = response.data as Record<string, unknown>;
        assert.ok(data.microExamples, "Should have microExamples when format=micro");
        assert.ok(!data.examples, "Should not have full examples when format=micro");
      } finally {
        await teardown();
      }
    });

    test("micro examples should be compact", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "frame_create", format: "micro" },
          },
        });

        const data = response.data as Record<string, unknown>;
        const microExamples = data.microExamples as Record<string, { in: string; out: string }>;

        assert.ok(microExamples, "Should have microExamples");
        assert.ok(Object.keys(microExamples).length > 0, "Should have at least one micro example");

        // Check structure of first micro example
        const firstExample = Object.values(microExamples)[0];
        assert.ok(firstExample.in, "Micro example should have 'in' field");
        assert.ok(firstExample.out, "Micro example should have 'out' field");
        assert.ok(typeof firstExample.in === "string", "Micro example 'in' should be a string");
        assert.ok(typeof firstExample.out === "string", "Micro example 'out' should be a string");
      } finally {
        await teardown();
      }
    });

    test("micro examples should use abbreviated field names", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "frame_create", format: "micro" },
          },
        });

        const data = response.data as Record<string, unknown>;
        const microExamples = data.microExamples as Record<string, { in: string; out: string }>;

        // Check that examples use abbreviated names
        const firstExample = Object.values(microExamples)[0];
        const input = firstExample.in;

        // Should use abbreviated field names like ref, cap, mods instead of full names
        assert.ok(
          input.includes("ref:") || input.includes("cap:") || input.includes("mods:"),
          "Should use abbreviated field names (ref, cap, mods)"
        );

        // Should NOT use full field names
        assert.ok(
          !input.includes("reference_point:") &&
            !input.includes("summary_caption:") &&
            !input.includes("module_scope:"),
          "Should not use full field names"
        );
      } finally {
        await teardown();
      }
    });

    test("micro examples should be significantly shorter than full examples", async () => {
      const srv = setup();
      try {
        // Get full format
        const fullResponse = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "frame_create", format: "full" },
          },
        });

        // Get micro format
        const microResponse = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "frame_create", format: "micro" },
          },
        });

        const fullData = fullResponse.data as Record<string, unknown>;
        const microData = microResponse.data as Record<string, unknown>;

        const fullExamplesStr = JSON.stringify(fullData.examples);
        const microExamplesStr = JSON.stringify(microData.microExamples);

        // Micro should be significantly shorter (at least 50% smaller)
        assert.ok(
          microExamplesStr.length < fullExamplesStr.length * 0.5,
          `Micro examples (${microExamplesStr.length} chars) should be < 50% of full examples (${fullExamplesStr.length} chars)`
        );
      } finally {
        await teardown();
      }
    });

    test("micro examples should be valid parseable JSON-ish", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "frame_create", format: "micro" },
          },
        });

        const data = response.data as Record<string, unknown>;
        const microExamples = data.microExamples as Record<string, { in: string; out: string }>;

        // Check that examples have proper JSON-like structure
        for (const example of Object.values(microExamples)) {
          // Should start with { and end with }
          assert.ok(example.in.startsWith("{"), "Input should start with {");
          assert.ok(example.in.endsWith("}"), "Input should end with }");
          assert.ok(example.out.startsWith("{"), "Output should start with {");
          assert.ok(example.out.endsWith("}"), "Output should end with }");
        }
      } finally {
        await teardown();
      }
    });

    test("format=full should still return full examples", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "frame_create", format: "full" },
          },
        });

        const data = response.data as Record<string, unknown>;
        assert.ok(data.examples, "Should have full examples when format=full");
        assert.ok(!data.microExamples, "Should not have microExamples when format=full");
      } finally {
        await teardown();
      }
    });

    test("default format should return full examples", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "frame_create" },
          },
        });

        const data = response.data as Record<string, unknown>;
        assert.ok(data.examples, "Should have full examples by default");
        assert.ok(!data.microExamples, "Should not have microExamples by default");
      } finally {
        await teardown();
      }
    });

    test("micro format text output should be compact", async () => {
      const srv = setup();
      try {
        const response = await srv.handleRequest({
          method: "tools/call",
          params: {
            name: "help",
            arguments: { tool: "frame_create", format: "micro" },
          },
        });

        const text = (response.content as Array<{ text: string }>)[0].text;

        assert.ok(text.includes("## Micro Examples"), "Should have Micro Examples section");
        assert.ok(!text.includes("```json"), "Should not have JSON code blocks in micro format");
      } finally {
        await teardown();
      }
    });

    test("all tools should have micro examples", async () => {
      const srv = setup();
      const allTools = [
        "frame_create",
        "frame_validate",
        "frame_search",
        "frame_get",
        "frame_list",
        "policy_check",
        "timeline_show",
        "atlas_analyze",
        "system_introspect",
        "help",
      ];

      try {
        for (const toolName of allTools) {
          const response = await srv.handleRequest({
            method: "tools/call",
            params: {
              name: "help",
              arguments: { tool: toolName, format: "micro" },
            },
          });

          const data = response.data as Record<string, unknown>;
          assert.ok(data.microExamples, `${toolName} should have microExamples when format=micro`);

          const microExamples = data.microExamples as Record<string, { in: string; out: string }>;
          assert.ok(
            Object.keys(microExamples).length > 0,
            `${toolName} should have at least one micro example`
          );
        }
      } finally {
        await teardown();
      }
    });
  });
});
