# Lex MCP Server

Use Lex from an MCP-capable agent without teaching the agent shell commands. The server exposes
the same deliberate Frame workflow as the CLI: remember what mattered, find it later, and keep
repository policy and Policy Neighborhood context available when they are useful.

Lex MCP is optional. Use the CLI if your agent already has a reliable shell; add MCP when your
client benefits from typed tools and discoverable schemas.

## Quick start

### VS Code / Copilot

Add this to `.vscode/mcp.json`:

```json
{
  "servers": {
    "lex": {
      "command": "npx",
      "args": ["--yes", "@smartergpt/lex-mcp@4.3.0"],
      "env": {
        "LEX_WORKSPACE_ROOT": "${workspaceFolder}",
        "LEX_STORE": "sqlite"
      }
    }
  }
}
```

### Claude Desktop

Add this to `claude_desktop_config.json`, replacing the project path with an absolute path:

```json
{
  "mcpServers": {
    "lex": {
      "command": "npx",
      "args": ["--yes", "@smartergpt/lex-mcp@4.3.0"],
      "env": {
        "LEX_WORKSPACE_ROOT": "/absolute/path/to/project",
        "LEX_STORE": "sqlite"
      }
    }
  }
}
```

`npx` may fetch and execute the package when it is not already cached. The exact version prevents
an implicit upgrade, while `--yes` prevents an interactive install prompt from hanging the MCP
host. Advance or locally install the package according to your normal supply-chain policy.

### Smoke test

After restarting the MCP client, ask it to call `system_introspect`, then `frame_list` with a small
limit. Introspection should identify the selected workspace and store. Listing an empty store is a
valid result.

Introspection also reports the shared Frame write contract and scope health. If policy is
unavailable or no policy-backed module applies, use the explicit fallback
`{"module_scope":["workspace/unscoped"]}`. Empty scope is still invalid; `frame_validate` returns
that exact payload as structured remediation.

## Tools

| Tool | Purpose |
|---|---|
| `frame_create` | Store a deliberate Frame |
| `frame_search` | Search Frames by content or metadata |
| `frame_get` | Retrieve one Frame by ID |
| `frame_list` | List recent Frames with filters |
| `frame_validate` | Validate Frame input without storing it |
| `policy_check` | Check scanned code facts against repository policy |
| `timeline_show` | Show Frame evolution for a ticket or branch |
| `atlas_analyze` | Build the experimental Code Index (legacy tool name) |
| `system_introspect` | Report active capabilities, workspace, and store state |
| `help` | Return tool usage and examples |
| `hints_get` | Retrieve stable recovery hints |
| `contradictions_scan` | Find potentially conflicting Frames |
| `db_stats` | Report database activity and health |
| `turncost_calculate` | Calculate Turn Cost governance metrics |

Old tool names such as `remember` and `recall` remain compatibility aliases. New integrations
should use the names above. See
[ADR-0009](./docs/adr/0009-mcp-tool-naming-convention.md).

`atlas_analyze` is a legacy-named Code Index surface; it is not Policy Neighborhood enrichment or
the historical Frame Graph. See the [terminology map](./docs/ATLAS_TERMINOLOGY.md).

## Storage and trust models

The configuration above starts the local compatibility server. It reads explicit `LEX_*`
configuration and is appropriate when one trusted user controls the process and selected store.

| Variable | Purpose | Default |
|---|---|---|
| `LEX_WORKSPACE_ROOT` | Repository whose branch and policy are active | Current directory |
| `LEX_STORE` | `sqlite` or `postgres` | `sqlite` |
| `LEX_DB_PATH` | SQLite database path | `.smartergpt/lex/memory.db` |
| `LEX_MEMORY_DB` | Compatibility alias for `LEX_DB_PATH` | — |
| `LEX_DATABASE_URL` | PostgreSQL URL when `LEX_STORE=postgres` | — |
| `LEX_POSTGRES_PASSWORD` | Password when the URL omits one | — |
| `LEX_POSTGRES_POOL_MAX` | PostgreSQL pool size | `10` |
| `LEX_DEBUG` | Diagnostic logging | Off |

For a multi-root local workspace, use one absolute `LEX_DB_PATH` in every direct Lex, MCP, and AXF
launch that should share Frames. Keep `LEX_WORKSPACE_ROOT` specific to the repository whose policy
and branch are active. See [MCP configuration examples](./docs/MCP_CONFIG.md).

Ambient environment variables are not a tenant authorization boundary. A trusted multi-tenant or
multi-workspace Lex 3 host must resolve explicit runtime authority and inject a scope-bound store;
it should embed `@smartergpt/lex/mcp-server` rather than treating the compatibility launcher as an
authorization layer. Start with the [Runtime Scope Contract](./docs/RUNTIME_SCOPE_CONTRACT.md) and
[PostgreSQL Scope Security](./docs/POSTGRES_SCOPE_SECURITY.md).

Trusted scoped MCP currently rejects attachments and caller-supplied image IDs until Lex has a
scope-bound attachment service. The ordinary unscoped SQLite compatibility path retains its
existing attachment behavior.

## Process boundary

- **Transport:** stdio using JSON-RPC 2.0
- **Runtime:** Node.js 24 or newer
- **Implementation:** `@smartergpt/lex-mcp` is a thin launcher around the server exported by
  `@smartergpt/lex`
- **Network:** the MCP transport itself does not open a listening port; PostgreSQL and your MCP
  client may have their own network behavior

Frame bodies are historical, user-controlled content. Treat recalled text as untrusted context,
not executable instructions. Do not store credentials, private keys, or tokens in Frames.

## Learn more

- [Lex overview](./README.md)
- [Agent continuity](./docs/AGENT_CONTINUITY.md)
- [Store contracts](./docs/STORE_CONTRACTS.md)
- [MCP configuration examples](./docs/MCP_CONFIG.md)
- [MCP server implementation details](./src/memory/mcp_server/README.md)
