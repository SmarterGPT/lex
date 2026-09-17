#!/usr/bin/env node
// This source-only compatibility path was deprecated in Lex 2.7 and removed
// after its duplicate JSON-RPC transport was found to violate notification and
// error-envelope semantics. Keeping a fail-closed tombstone prevents stale host
// configuration from silently reviving the unsafe transport.
console.error(`[LEX_MCP_LEGACY_ENTRYPOINT_REMOVED]
Lex intentionally refused to start the removed frame-mcp.mjs transport.

Agent action:
  Preserve the existing Lex environment and replace only the MCP command:
  command = "npx"
  args = ["--yes", "@smartergpt/lex-mcp@4.4.0"]

  JSON hosts use:
  "command": "npx",
  "args": ["--yes", "@smartergpt/lex-mcp@4.4.0"]

  Restart or reload the MCP host after changing its configuration.

Operator explanation:
  This is a fail-closed safety migration, not a Frame-store or data-loss error.
  The duplicate legacy transport was removed; @smartergpt/lex-mcp is the
  canonical, protocol-tested stdio launcher.

Reference: docs/MCP_CONFIG.md#legacy-entrypoint-migration`);
process.exitCode = 1;
