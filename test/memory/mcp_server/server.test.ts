/**
 * Tests for Frame MCP Server
 *
 * Tests the MCP protocol implementation for Frame storage and recall.
 * Uses Node.js built-in test runner (node:test) - no external dependencies.
 *
 * NOTE: This file contains the CANONICAL tool registry test.
 * When adding/removing MCP tools, update ONLY the "tools/list returns all available tools" test below.
 * Other test files should assert tool *presence* rather than exact counts.
 */

import { test, describe } from "node:test";
import assert from "node:assert";
import { MCPServer } from "@app/memory/mcp_server/server.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("MCP Server - Protocol", () => {
  let server: MCPServer;
  let testDbPath: string;

  // Setup: create test database in temp directory
  function setup() {
    const tmpDir = mkdtempSync(join(tmpdir(), "lex-test-"));
    testDbPath = join(tmpDir, "test-frames.db");
    server = new MCPServer(testDbPath);
    return server;
  }

  // Teardown: close database and cleanup
  async function teardown() {
    if (server) {
      await server.close();
    }
    if (testDbPath) {
      try {
        rmSync(testDbPath, { force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  test("tools/list returns all available tools", async () => {
    const srv = setup();
    try {
      const response = await srv.handleRequest({ method: "tools/list" });

      assert.ok(response.tools, "Response should have tools array");

      // Canonical tool registry test: owns the exact set of expected tools
      // Updated for resource_action naming convention (AX-014)
      const toolNames = response.tools.map((t) => t.name).sort();
      const expectedTools = [
        "atlas_analyze",
        "contradictions_scan",
        "db_stats",
        "destination_inspect",
        "frame_create",
        "frame_get",
        "frame_list",
        "frame_search",
        "frame_validate",
        "help",
        "hints_get",
        "policy_check",
        "system_introspect",
        "timeline_show",
        "turncost_calculate",
      ].sort();

      assert.deepStrictEqual(
        toolNames,
        expectedTools,
        "Should have exactly these tools (no more, no less)"
      );
    } finally {
      await teardown();
    }
  });

  test("lex.remember creates a Frame with valid data", async () => {
    const srv = setup();
    try {
      const args = {
        reference_point: "test memory",
        summary_caption: "Testing Frame creation",
        status_snapshot: {
          next_action: "Verify storage",
          blockers: [],
        },
        module_scope: ["policy/scanners"],
      };

      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: args,
        },
      });

      assert.ok(response.content, "Response should have content");
      assert.ok(
        response.content[0].text.includes("✅ Frame stored"),
        "Should confirm Frame storage"
      );
      assert.ok(response.content[0].text.includes("test memory"), "Should include reference point");
      assert.ok(response.content[0].text.includes("Atlas Frame"), "Should include Atlas Frame");
    } finally {
      await teardown();
    }
  });

  test("lex.remember fails with missing required fields", async () => {
    const srv = setup();
    try {
      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: {
            reference_point: "incomplete data",
            // Missing: summary_caption, status_snapshot, module_scope
          },
        },
      });

      assert.ok(response.error, "Should return error");
      assert.ok(
        response.error.message.includes("Missing required fields"),
        "Error should mention missing fields"
      );
    } finally {
      await teardown();
    }
  });

  test("lex.recall finds stored Frames by reference_point", async () => {
    const srv = setup();
    try {
      // First, create a Frame
      await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: {
            reference_point: "authentication refactoring",
            summary_caption: "Extracted password validation",
            status_snapshot: {
              next_action: "Add unit tests",
              blockers: [],
            },
            module_scope: ["shared/types"],
          },
        },
      });

      // Then, recall it
      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "recall",
          arguments: {
            reference_point: "authentication",
          },
        },
      });

      assert.ok(response.content, "Response should have content");
      assert.ok(response.content[0].text.includes("Found 1 Frame"), "Should find 1 Frame");
      assert.ok(
        response.content[0].text.includes("authentication refactoring"),
        "Should include reference point"
      );
      assert.ok(response.content[0].text.includes("Atlas Frame"), "Should include Atlas Frame");
    } finally {
      await teardown();
    }
  });

  test("lex.recall returns empty result for non-existent query", async () => {
    const srv = setup();
    try {
      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "recall",
          arguments: {
            reference_point: "nonexistent work",
          },
        },
      });

      assert.ok(response.content, "Response should have content");
      assert.ok(
        response.content[0].text.includes("No matching Frames found"),
        "Should indicate no results"
      );
    } finally {
      await teardown();
    }
  });

  test("lex.recall fails without search parameters", async () => {
    const srv = setup();
    try {
      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "recall",
          arguments: {}, // No search parameters
        },
      });

      assert.ok(response.error, "Should return error");
      assert.ok(
        response.error.message.includes("At least one search parameter required"),
        "Error should mention missing parameters"
      );
    } finally {
      await teardown();
    }
  });

  test("lex.list_frames returns recent Frames", async () => {
    const srv = setup();
    try {
      // Create two Frames
      await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: {
            reference_point: "frame one",
            summary_caption: "First test frame",
            status_snapshot: { next_action: "Test" },
            module_scope: ["policy/scanners"],
          },
        },
      });

      await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: {
            reference_point: "frame two",
            summary_caption: "Second test frame",
            status_snapshot: { next_action: "Test" },
            module_scope: ["shared/types"],
          },
        },
      });

      // List frames
      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "list_frames",
          arguments: { limit: 10 },
        },
      });

      assert.ok(response.content, "Response should have content");
      assert.ok(response.content[0].text.includes("Recent Frames (2)"), "Should list 2 frames");
      assert.ok(response.content[0].text.includes("frame one"), "Should include first frame");
      assert.ok(response.content[0].text.includes("frame two"), "Should include second frame");
      assert.ok(response.content[0].text.includes("Atlas Frame"), "Should include Atlas Frames");
    } finally {
      await teardown();
    }
  });

  test("lex.list_frames filters by module", async () => {
    const srv = setup();
    try {
      // Create two Frames with different modules
      await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: {
            reference_point: "auth work",
            summary_caption: "Auth module work",
            status_snapshot: { next_action: "Test" },
            module_scope: ["policy/scanners"],
          },
        },
      });

      await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: {
            reference_point: "ui work",
            summary_caption: "UI module work",
            status_snapshot: { next_action: "Test" },
            module_scope: ["memory/mcp"],
          },
        },
      });

      // List only auth module frames
      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "list_frames",
          arguments: { module: "policy/scanners", limit: 10 },
        },
      });

      assert.ok(response.content, "Response should have content");
      assert.ok(response.content[0].text.includes("Recent Frames (1)"), "Should list 1 frame");
      assert.ok(response.content[0].text.includes("auth work"), "Should include auth frame");
      assert.ok(!response.content[0].text.includes("ui work"), "Should not include ui frame");
    } finally {
      await teardown();
    }
  });

  test("unknown method returns error", async () => {
    const srv = setup();
    try {
      const response = await srv.handleRequest({
        method: "unknown/method",
      });

      assert.ok(response.error, "Should return error");
      assert.ok(
        response.error.message.includes("Unknown method"),
        "Error should mention unknown method"
      );
    } finally {
      await teardown();
    }
  });

  test("unknown tool returns error", async () => {
    const srv = setup();
    try {
      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "lex.unknown_tool",
          arguments: {},
        },
      });

      assert.ok(response.error, "Should return error");
      assert.ok(
        response.error.message.includes("Unknown tool"),
        "Error should mention unknown tool"
      );
    } finally {
      await teardown();
    }
  });

  // Image attachment tests (PR #27)
  test("lex.remember stores Frame with image attachments", async () => {
    const srv = setup();
    try {
      // Create a small test image (base64-encoded PNG)
      const testImageData = Buffer.from("fake-png-data").toString("base64");

      const args = {
        reference_point: "test with images",
        summary_caption: "Testing image attachment",
        status_snapshot: {
          next_action: "Verify image storage",
        },
        module_scope: ["policy/scanners"], // Use valid module from policy
        images: [
          {
            data: testImageData,
            mime_type: "image/png",
          },
        ],
      };

      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: args,
        },
      });

      assert.ok(response.content, "Response should have content");
      assert.ok(
        response.content[0].text.includes("✅ Frame stored"),
        "Should confirm Frame storage"
      );
      assert.ok(
        response.content[0].text.includes("🖼️  Images: 1 attached"),
        "Should indicate image attachment"
      );
    } finally {
      await teardown();
    }
  });

  test("lex.remember stores Frame with multiple image attachments", async () => {
    const srv = setup();
    try {
      const image1 = Buffer.from("png-data").toString("base64");
      const image2 = Buffer.from("jpeg-data").toString("base64");

      const args = {
        reference_point: "test with multiple images",
        summary_caption: "Testing multiple image attachments",
        status_snapshot: {
          next_action: "Verify multi-image storage",
        },
        module_scope: ["shared/types"], // Use valid module from policy
        images: [
          { data: image1, mime_type: "image/png" },
          { data: image2, mime_type: "image/jpeg" },
        ],
      };

      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: args,
        },
      });

      assert.ok(response.content, "Response should have content");
      assert.ok(
        response.content[0].text.includes("🖼️  Images: 2 attached"),
        "Should indicate 2 images attached"
      );
    } finally {
      await teardown();
    }
  });

  test("lex.remember fails with invalid image MIME type", async () => {
    const srv = setup();
    try {
      const testImageData = Buffer.from("fake-data").toString("base64");

      const args = {
        reference_point: "test with invalid image",
        summary_caption: "Testing invalid image type",
        status_snapshot: {
          next_action: "Should fail",
        },
        module_scope: ["policy/scanners"], // Use valid module from policy
        images: [
          {
            data: testImageData,
            mime_type: "application/pdf", // Invalid MIME type
          },
        ],
      };

      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: args,
        },
      });

      assert.ok(response.error, "Should return error");
      assert.ok(
        response.error.message.includes("Failed to store image"),
        "Error should mention image storage failure"
      );
    } finally {
      await teardown();
    }
  });

  test("lex.remember fails with oversized image", async () => {
    const srv = setup();
    try {
      // Create base64 of a buffer larger than 10MB
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024);
      const testImageData = largeBuffer.toString("base64");

      const args = {
        reference_point: "test with oversized image",
        summary_caption: "Testing oversized image",
        status_snapshot: {
          next_action: "Should fail",
        },
        module_scope: ["memory/mcp"], // Use valid module from policy
        images: [
          {
            data: testImageData,
            mime_type: "image/png",
          },
        ],
      };

      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: args,
        },
      });

      assert.ok(response.error, "Should return error");
      assert.ok(
        response.error.message.includes("exceeds maximum"),
        "Error should mention size limit"
      );
    } finally {
      await teardown();
    }
  });

  // Integration tests for module ID validation (THE CRITICAL RULE) - PR #28
  test("lex.remember validates module IDs - rejects invalid module", async () => {
    const srv = setup();
    try {
      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: {
            reference_point: "invalid module test",
            summary_caption: "Testing validation",
            status_snapshot: { next_action: "Test" },
            module_scope: ["invalid-module"],
          },
        },
      });

      assert.ok(response.error, "Should return error for invalid module");
      assert.ok(
        response.error.message.includes("Invalid module IDs"),
        "Error should mention invalid module IDs"
      );
      assert.ok(
        response.error.message.includes("invalid-module"),
        "Error should mention the specific invalid module"
      );
      assert.ok(
        response.error.message.includes("Available modules"),
        "Error should list available modules"
      );
    } finally {
      await teardown();
    }
  });

  test("lex.remember validates module IDs - suggests similar modules", async () => {
    const srv = setup();
    try {
      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: {
            reference_point: "typo test",
            summary_caption: "Testing fuzzy matching",
            status_snapshot: { next_action: "Test" },
            module_scope: ["indexr"], // Typo: should be "policy/scanners"
          },
        },
      });

      assert.ok(response.error, "Should return error for typo");
      assert.ok(response.error.message.includes("indexr"), "Error should mention the typo");
      assert.ok(
        response.error.message.includes("Did you mean"),
        "Error should provide suggestions"
      );
    } finally {
      await teardown();
    }
  });

  test("lex.remember validates module IDs - reports multiple invalid modules", async () => {
    const srv = setup();
    try {
      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: {
            reference_point: "multiple errors test",
            summary_caption: "Testing multiple validation errors",
            status_snapshot: { next_action: "Test" },
            module_scope: ["invalid1", "invalid2", "invalid3"],
          },
        },
      });

      assert.ok(response.error, "Should return error for invalid modules");
      assert.ok(
        response.error.message.includes("invalid1"),
        "Error should mention first invalid module"
      );
      assert.ok(
        response.error.message.includes("invalid2"),
        "Error should mention second invalid module"
      );
      assert.ok(
        response.error.message.includes("invalid3"),
        "Error should mention third invalid module"
      );
    } finally {
      await teardown();
    }
  });

  test("lex.remember validates module IDs - mix of valid and invalid", async () => {
    const srv = setup();
    try {
      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: {
            reference_point: "mixed validity test",
            summary_caption: "Testing mixed valid/invalid modules",
            status_snapshot: { next_action: "Test" },
            module_scope: ["policy/scanners", "invalid-module", "shared/types"],
          },
        },
      });

      assert.ok(response.error, "Should return error when any module is invalid");
      assert.ok(
        response.error.message.includes("invalid-module"),
        "Error should mention the invalid module"
      );
      // Valid modules should only appear in "Available modules" list, not as errors
      const errorLines = response.error.message.split("\n").filter((line) => line.includes("•"));
      const hasValidModuleError = errorLines.some(
        (line) => line.includes("policy/scanners") || line.includes("shared/types")
      );
      assert.ok(!hasValidModuleError, "Error should not flag valid modules as invalid");
    } finally {
      await teardown();
    }
  });

  test("lex.remember validates module IDs - accepts all valid modules", async () => {
    const srv = setup();
    try {
      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: {
            reference_point: "all valid modules",
            summary_caption: "Testing with all policy modules",
            status_snapshot: { next_action: "Test" },
            module_scope: ["policy/scanners", "shared/types", "memory/mcp"],
          },
        },
      });

      assert.ok(response.content, "Should succeed with all valid modules");
      assert.ok(
        response.content[0].text.includes("✅ Frame stored"),
        "Should confirm Frame storage"
      );
      assert.ok(
        response.content[0].text.includes("policy/scanners") &&
          response.content[0].text.includes("shared/types") &&
          response.content[0].text.includes("memory/mcp"),
        "Should include all modules"
      );
    } finally {
      await teardown();
    }
  });

  // Branch detection tests (PR #29)
  test("lex.remember auto-detects git branch when not provided", async () => {
    const srv = setup();
    try {
      const args = {
        reference_point: "branch detection test",
        summary_caption: "Testing auto-detection",
        status_snapshot: {
          next_action: "Verify branch detection",
          blockers: [],
        },
        module_scope: ["policy/scanners"],
      };

      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: args,
        },
      });

      assert.ok(response.content, "Response should have content");
      const text = response.content[0].text;
      assert.ok(text.includes("🌿 Branch:"), "Should include branch info");
      assert.ok(!text.includes("Branch: main"), "Should not hardcode main");
    } finally {
      await teardown();
    }
  });

  test("lex.remember respects provided branch over auto-detection", async () => {
    const srv = setup();
    try {
      const args = {
        reference_point: "manual branch test",
        summary_caption: "Testing manual branch override",
        status_snapshot: {
          next_action: "Verify manual branch",
          blockers: [],
        },
        module_scope: ["policy/scanners"],
        branch: "custom-branch-name",
      };

      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: args,
        },
      });

      assert.ok(response.content, "Response should have content");
      assert.ok(
        response.content[0].text.includes("🌿 Branch: custom-branch-name"),
        "Should use provided branch name"
      );
    } finally {
      await teardown();
    }
  });

  test("get_frame retrieves a Frame by ID", async () => {
    const srv = setup();
    try {
      // First, create a Frame
      const createResponse = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: {
            reference_point: "test frame retrieval",
            summary_caption: "Testing get_frame tool",
            status_snapshot: {
              next_action: "Verify retrieval",
              blockers: ["none"],
            },
            module_scope: ["policy/scanners"],
            jira: "TEST-123",
            keywords: ["testing", "retrieval"],
          },
        },
      });

      // Extract frame ID from the response
      assert.ok(createResponse.data?.frame_id, "Frame creation should return frame_id");
      const frameId = createResponse.data.frame_id as string;

      // Then, retrieve it using get_frame
      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "get_frame",
          arguments: {
            frame_id: frameId,
          },
        },
      });

      assert.ok(response.content, "Response should have content");
      assert.ok(
        response.content[0].text.includes("✅ Frame retrieved"),
        "Should confirm Frame retrieval"
      );
      assert.ok(
        response.content[0].text.includes("test frame retrieval"),
        "Should include reference point"
      );
      assert.ok(
        response.content[0].text.includes("Testing get_frame tool"),
        "Should include summary caption"
      );
      assert.ok(response.content[0].text.includes("TEST-123"), "Should include Jira ticket");
      assert.ok(
        response.content[0].text.includes("Atlas Frame"),
        "Should include Atlas Frame by default"
      );
      assert.ok(response.data?.frame_id === frameId, "Response data should include frame_id");
    } finally {
      await teardown();
    }
  });

  test("get_frame retrieves a Frame without Atlas when include_atlas=false", async () => {
    const srv = setup();
    try {
      // First, create a Frame
      const createResponse = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "remember",
          arguments: {
            reference_point: "test without atlas",
            summary_caption: "Testing get_frame without atlas",
            status_snapshot: {
              next_action: "Verify retrieval",
            },
            module_scope: ["policy/scanners"],
          },
        },
      });

      const frameId = createResponse.data?.frame_id as string;

      // Retrieve it with include_atlas=false
      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "get_frame",
          arguments: {
            frame_id: frameId,
            include_atlas: false,
          },
        },
      });

      assert.ok(response.content, "Response should have content");
      assert.ok(
        response.content[0].text.includes("✅ Frame retrieved"),
        "Should confirm Frame retrieval"
      );
      assert.ok(
        !response.content[0].text.includes("Atlas Frame"),
        "Should NOT include Atlas Frame when include_atlas=false"
      );
    } finally {
      await teardown();
    }
  });

  test("get_frame returns error for non-existent frame", async () => {
    const srv = setup();
    try {
      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "get_frame",
          arguments: {
            frame_id: "nonexistent-frame-id",
          },
        },
      });

      assert.ok(response.error, "Should return error");
      assert.strictEqual(
        response.error.code,
        "STORAGE_FRAME_NOT_FOUND",
        "Error code should be STORAGE_FRAME_NOT_FOUND"
      );
      assert.ok(
        response.error.message.includes("Frame not found"),
        "Error message should indicate frame not found"
      );
      assert.ok(
        response.error.context?.frameId === "nonexistent-frame-id",
        "Error context should include frame ID"
      );
    } finally {
      await teardown();
    }
  });

  test("get_frame returns error for missing frame_id", async () => {
    const srv = setup();
    try {
      const response = await srv.handleRequest({
        method: "tools/call",
        params: {
          name: "get_frame",
          arguments: {},
        },
      });

      assert.ok(response.error, "Should return error");
      assert.strictEqual(
        response.error.code,
        "VALIDATION_REQUIRED_FIELD",
        "Error code should be VALIDATION_REQUIRED_FIELD"
      );
      assert.ok(
        response.error.message.includes("Missing required field: frame_id"),
        "Error message should mention missing frame_id"
      );
    } finally {
      await teardown();
    }
  });
});
