# MCP server internals

> **Audience:** Lex maintainers
> **Public consumer setup:** [`README.mcp.md`](../../../README.mcp.md) and
> [`docs/MCP_CONFIG.md`](../../../docs/MCP_CONFIG.md)
> **Security boundary:** [`SECURITY.md`](../../../SECURITY.md)

This directory implements Lex's stdio Model Context Protocol server. It is not a second public
package entrypoint or a consumer import surface. Consumers launch the exact reviewed
`@smartergpt/lex-mcp` package, which transports the matching `@smartergpt/lex` server.

Source paths, undeclared `dist/` paths, `frame-mcp.mjs`, and `lex-launcher.sh` are not supported
launch contracts.

## Canonical transport

The supported transport is stdio JSON-RPC through `@smartergpt/lex-mcp`:

```json
{
  "command": "npx",
  "args": ["--yes", "@smartergpt/lex-mcp@4.4.1"]
}
```

Pin the version selected by the active release manifest. Preserve the reviewed workspace, store,
and secret-pass-through configuration when changing the command.

The server writes protocol messages to stdout and diagnostics to stderr. A successful
`notifications/initialized` notification is silent. Protocol acceptance sends `initialize`, the
notification, and `tools/list` before any store-backed call.

## Canonical tool surface

[`tools.ts`](./tools.ts) is the advertised tool definition and
[`server.ts`](./server.ts) is the dispatch implementation. `tools/list` currently advertises
exactly fourteen canonical `resource_action` names:

| Tool | Purpose |
| --- | --- |
| `frame_create` | Validate and store a deliberate Frame |
| `frame_validate` | Validate Frame input without storing it |
| `frame_search` | Search Frames using the selected store |
| `frame_get` | Retrieve one Frame by ID |
| `frame_list` | List recent Frames with bounded filters |
| `policy_check` | Check paths or changes against repository policy |
| `timeline_show` | Return a chronological work timeline |
| `atlas_analyze` | Build the experimental Code Index (legacy tool name) |
| `system_introspect` | Report runtime capabilities and credential-free store identity |
| `help` | Return task-oriented tool guidance |
| `hints_get` | Return focused usage hints |
| `db_stats` | Return supported store statistics |
| `turncost_calculate` | Calculate bounded turn-cost estimates |
| `contradictions_scan` | Find conflicting Frame claims |

## Frame write fallback and scope health

`frame_create` and `frame_validate` require a non-empty `module_scope`. When no policy-backed
module applies, callers must send the canonical fallback explicitly:

```json
{ "module_scope": ["workspace/unscoped"] }
```

Fallback Frames retain `module_attribution.mode = "fallback"` when stored and retrieved.
`system_introspect` exposes the same structured write contract plus scope health: policy
availability and source, policy module count, unscoped Frame count, and a bounded summary of
Frame module IDs absent from the loaded policy. An empty scope remains invalid and returns the
exact fallback payload as structured remediation; it is never silently rewritten.

Accepted legacy aliases are compatibility inputs only. They are not advertised tools and must not
appear as the preferred name in current consumer documentation. Alias mappings and capability
coverage live in [`../../shared/runtime-scope/capabilities.ts`](../../shared/runtime-scope/capabilities.ts).

`atlas_analyze` itself is a legacy-named Code Index command. It does not generate the
policy-backed Policy Neighborhood returned with Frame recall and does not rebuild the historical
Frame Graph. See the
[`Atlas` terminology map](../../../docs/ATLAS_TERMINOLOGY.md).

Any tool addition, removal, or rename must update together:

- `tools.ts`;
- `server.ts` dispatch and help metadata;
- runtime-scope capability mapping;
- focused MCP protocol and authorization tests;
- `README.mcp.md` and `docs/MCP_CONFIG.md`; and
- packed-consumer acceptance.

## Runtime and authority boundary

The compatibility server may select a local SQLite or unscoped PostgreSQL adapter from reviewed
`LEX_*` process configuration. Those variables are trusted-host configuration, not tenant or
workspace authority.

A trusted multi-workspace host must inject:

```text
trusted runtime selection + repository evidence
        ↓
canonical authority and workspace binding
        ↓
AuthorizedScope
        ↓
scope-bound FrameStore
```

Authorization completes before tool dispatch. Unknown operations fail closed rather than
receiving a default capability. Normal handlers receive only a bound store view; migration,
repair, rebind, and recovery remain separately authorized.

The normative contracts are:

- [`docs/RUNTIME_SCOPE_CONTRACT.md`](../../../docs/RUNTIME_SCOPE_CONTRACT.md);
- [`src/memory/store/CONTRACT.md`](../store/CONTRACT.md);
- [`docs/POSTGRES_AUTHORITY.md`](../../../docs/POSTGRES_AUTHORITY.md); and
- [`docs/POSTGRES_SCOPE_SECURITY.md`](../../../docs/POSTGRES_SCOPE_SECURITY.md).

## Store configuration

The complete compatibility environment contract is
[`docs/ENVIRONMENT.md`](../../../docs/ENVIRONMENT.md). Important selections include:

| Variable | Role |
| --- | --- |
| `LEX_WORKSPACE_ROOT` | Explicit caller repository root |
| `LEX_STORE` | Compatibility backend: `sqlite` or `postgres` |
| `LEX_DB_PATH` | Exact SQLite store path |
| `LEX_DATABASE_URL` | PostgreSQL compatibility endpoint; may contain credentials |
| `LEX_POSTGRES_PASSWORD` | Separately injected PostgreSQL password |
| `LEX_POSTGRES_POOL_MAX` | PostgreSQL compatibility pool size |

Some hosts filter inherited environment variables. Forward
`LEX_POSTGRES_PASSWORD` through the host's secret/environment allowlist without storing or logging
its value, then restart the MCP host. A SCRAM “password must be a string” failure indicates absent
or invalid authentication input; it is not evidence of database loss and does not authorize store
repair or deletion.

MCP migration acceptance must not discover, query, or mutate an existing project or user database.
Use protocol-only initialization/tool-list checks first. Store-specific checks use an
operator-selected target and the hard read-only path described in the
[`Lex 4.0 migration guide`](../../../docs/releases/lex-4.0-migration.md).

## Removed launcher

[`frame-mcp.mjs`](./frame-mcp.mjs) is a fail-closed tombstone. It emits
`LEX_MCP_LEGACY_ENTRYPOINT_REMOVED` because the former source transport duplicated canonical
server behavior and could bypass current initialization, cleanup, authority, and tool-surface
contracts.

Recovery is configuration-only:

1. preserve the reviewed `LEX_*` values;
2. replace only the command and arguments with exact `@smartergpt/lex-mcp`;
3. preserve secret pass-through by variable name;
4. restart the MCP host; and
5. perform protocol-only acceptance before a store-backed call.

The repository-level `lex-launcher.sh` follows the same fail-closed contract. Do not restore or
extend either launcher.

## Unsupported HTTP implementation

Historical HTTP source may remain in this directory for internal compatibility and tests. It is
not a declared package export, supported deployment, or peer to the stdio MCP transport. Do not
advertise its endpoints, authentication model, or direct source imports as Lex 4 consumer API.

Any proposal to restore an HTTP surface requires a separate reviewed public API, authentication,
authorization, deployment, threat-model, and SemVer decision.

## Maintainer map

| Path | Responsibility |
| --- | --- |
| `index.ts` | Publicly exported MCP server assembly |
| `server.ts` | Protocol handling, dispatch, help, and lifecycle |
| `tools.ts` | Canonical advertised tool definitions |
| `frame-mcp.mjs` | Removed-launcher tombstone |
| `http-server.ts` | Unsupported historical/internal HTTP implementation |
| `types.ts` | MCP-local types |

Do not add a new executable entrypoint merely for local convenience. Exercise the package wrapper
or the repository's existing protocol harness so development and consumer behavior remain the
same.

## Verification

During implementation, run touched and adjacent MCP, runtime-scope, store, and documentation
tests. At the final release candidate, run the repository's exhaustive gate and packed-consumer
acceptance.

At minimum, MCP changes must prove:

- package build and public API checks;
- initialization and notification silence;
- exact fourteen-tool discovery;
- canonical and supported-alias dispatch behavior;
- pre-dispatch authority denial;
- cancellation and process cleanup;
- no protocol corruption from diagnostics;
- isolated SQLite and PostgreSQL behavior where affected; and
- the removed launcher fails with its stable diagnostic and an actionable recovery path.

The release checklist is [`RELEASE.md`](../../../RELEASE.md).
