# MCP Configuration Examples

## VS Code / GitHub Copilot

Create `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "lex": {
      "type": "stdio",
      "command": "npx",
      "args": ["--yes", "@smartergpt/lex-mcp@4.4.0"],
      "env": {
        "LEX_WORKSPACE_ROOT": "${workspaceFolder}",
        "LEX_STORE": "sqlite"
      }
    }
  }
}
```

## Claude Desktop

Add to `~/.config/Claude/claude_desktop_config.json` (Linux) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "lex": {
      "command": "npx",
      "args": ["--yes", "@smartergpt/lex-mcp@4.4.0"],
      "env": {
        "LEX_WORKSPACE_ROOT": "/path/to/your/project",
        "LEX_STORE": "sqlite"
      }
    }
  }
}
```

## Shared store for multi-root workspaces

When several repositories should share continuity, configure every Lex launch path with the same absolute `LEX_DB_PATH`. Keep `LEX_WORKSPACE_ROOT` pointed at the repository whose branch and policy should be active for that server:

```json
{
  "servers": {
    "lex": {
      "type": "stdio",
      "command": "npx",
      "args": ["--yes", "@smartergpt/lex-mcp@4.4.0"],
      "env": {
        "LEX_WORKSPACE_ROOT": "D:\\dev\\stfc-mod",
        "LEX_STORE": "sqlite",
        "LEX_DB_PATH": "D:\\dev\\.smartergpt\\lex\\memory.db"
      }
    }
  }
}
```

Use the same `LEX_DB_PATH` for direct CLI commands, Codex MCP configuration, and AXF-routed Lex. Verify alignment with `lex introspect`, `lex --json introspect --format compact`, or `lex context`; each reports the canonical store path and a comparable `path-v1` identity. Lex also warns when other conventional store files exist in the project, its ancestors, or the user home directory.

For a shared PostgreSQL store, configure every surface with the same two variables instead:

```json
{
  "env": {
    "LEX_STORE": "postgres",
    "LEX_DATABASE_URL": "postgresql://lex@127.0.0.1:5432/lex",
    "LEX_POSTGRES_PASSWORD": "<from-secret-configuration>"
  }
}
```

Keep the password in the host environment or secret configuration. A password may alternatively be embedded in `LEX_DATABASE_URL`. PostgreSQL introspection reports a credential-free `postgres-v1` identity, live connection health, schema/server versions, Frame count, and capabilities. Images are reported unsupported on PostgreSQL. `LEX_DB_PATH` remains SQLite-only.

Some MCP hosts pass only explicitly allowlisted parent environment variables. Preserve the
reviewed `LEX_*` routing values and forward the existing secret by name; never copy its value into
a tracked configuration. For Codex TOML:

```toml
[mcp_servers.lex]
command = "npx"
args = ["--yes", "@smartergpt/lex-mcp@4.4.0"]
env_vars = ["LEX_POSTGRES_PASSWORD"]

[mcp_servers.lex.env]
LEX_WORKSPACE_ROOT = "/absolute/path/to/repository"
LEX_STORE = "postgres"
LEX_DATABASE_URL = "postgresql://lex@127.0.0.1:5432/lex"
```

Restart or reload the MCP host after changing environment pass-through. Confirm the child receives
the variable without printing its value, then verify the intended workspace and credential-free
store identity. A PostgreSQL SCRAM “password must be a string” failure after a launcher change
usually means the child did not receive the separate password; it is not evidence of database
loss, and it is not permission to delete, recreate, or repair a store.

This environment-selected PostgreSQL path is the compatibility adapter. It can coordinate a
trusted shared store, but it is not a tenant authorization boundary. Multi-tenant and
multi-workspace hosts must use explicit runtime authority and a scope-bound PostgreSQL store; see
[Runtime Scope](./RUNTIME_SCOPE_CONTRACT.md) and
[PostgreSQL Scope Security](./POSTGRES_SCOPE_SECURITY.md).

The compatibility adapter uses dedicated `lex_compat_*` relations and a separate migration ledger.
It may coexist in the same PostgreSQL schema as the Lex 3 scoped/RLS store, but it never reads the
scoped relation or automatically assigns ownership to scoped or quarantined legacy Frames.

Installed CLI and MCP consumers discover `.lex.config.json` from the caller project root. This provides a file-based alternative when the host does not support environment wiring:

```json
{
  "paths": {
    "appRoot": ".",
    "database": "D:\\dev\\.smartergpt\\lex\\memory.db",
    "policy": ".smartergpt/lex/lexmap.policy.json"
  }
}
```

## Legacy entrypoint migration

`LEX_MCP_LEGACY_ENTRYPOINT_REMOVED` means the host still launches the removed
`frame-mcp.mjs` source transport or the deprecated `lex-launcher.sh` wrapper.
This is an intentional fail-closed migration, not evidence of Frame loss or
store corruption.

Preserve the existing `LEX_*` environment values and replace only the launch
command:

```toml
command = "npx"
args = ["--yes", "@smartergpt/lex-mcp@4.4.0"]
```

For JSON-based hosts:

```json
{
  "command": "npx",
  "args": ["--yes", "@smartergpt/lex-mcp@4.4.0"]
}
```

Restart or reload the MCP host after updating its configuration. Managed
environments may pin `@smartergpt/lex-mcp@<approved-version>` and should advance
that pin through their normal Lex/Lex-MCP compatibility review.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LEX_WORKSPACE_ROOT` | Project root directory | Current directory |
| `LEX_STORE` | Frame backend (`sqlite` or `postgres`) | `sqlite` |
| `LEX_DATABASE_URL` | PostgreSQL URL (required for PostgreSQL) | — |
| `LEX_POSTGRES_PASSWORD` | Optional separate PostgreSQL password | — |
| `LEX_POSTGRES_POOL_MAX` | PostgreSQL compatibility pool size | `10` |
| `LEX_DB_PATH` | SQLite database path | `.smartergpt/lex/memory.db` |
| `LEX_MEMORY_DB` | Alias for `LEX_DB_PATH` (backwards compat) | — |
| `LEX_DEBUG` | Enable debug logging | Disabled |

`LEX_DB_PATH` takes precedence over the compatibility alias `LEX_MEMORY_DB`, then `.lex.config.json`, then the project-local default.

## Available Tools

Once configured, the following MCP tools are available:

Legacy compatibility names are classified in the
[Atlas terminology ownership map](./ATLAS_TERMINOLOGY.md).

- `frame_create` - Store a deliberate Frame
- `frame_search` - Search past Frames
- `frame_get` - Retrieve a specific frame
- `frame_list` - List recent frames
- `frame_validate` - Validate frame input
- `atlas_analyze` - Compatibility name for experimental Code Index dependency analysis
- `timeline_show` - Show work timeline
- `hints_get` - Get hint details
- `help` - Get usage guidance
- `policy_check` - Validate against policy
- `system_introspect` - System status
- `db_stats` - Database statistics
- `turncost_calculate` - Turn cost metrics
- `contradictions_scan` - Detect conflicting information

## Quick Test

```bash
# Test the MCP server directly
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | npx --yes @smartergpt/lex-mcp@4.4.0
```
