#!/bin/bash
# Deprecated launcher tombstone. Existing callers are forwarded to the shared
# agent-readable migration diagnostic; no transport is started here.

set -e

case "$0" in
  */*)
    LAUNCHER_DIR="${0%/*}"
    [ -n "$LAUNCHER_DIR" ] || LAUNCHER_DIR="/"
    ;;
  *)
    LAUNCHER_DIR="."
    ;;
esac
SCRIPT_DIR="$(cd "$LAUNCHER_DIR" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "[LEX_MCP_LEGACY_ENTRYPOINT_REMOVED] Install Node.js 24+, then replace this launcher with: npx --yes @smartergpt/lex-mcp@4.3.0" >&2
  exit 1
fi

exec "$(command -v node)" "$SCRIPT_DIR/src/memory/mcp_server/frame-mcp.mjs"
