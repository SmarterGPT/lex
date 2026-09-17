# Public Package API

<!-- public-api-contract:v1 -->

Every entry in the `package.json` export map is a public, semver-governed package path. Removing a
path, changing its resolution, or removing an exported contract symbol requires a major release.
Additive symbols may be introduced in a minor release. Files below these paths are internal unless
they are separately declared in the export map; consumers must not import `dist/` or source paths.

The contract anchors are maintained in `scripts/public-api-contract.mjs`. `npm run
check:public-api` checks the export map, built JavaScript and declaration targets, representative
runtime symbols, JSON Schemas, this inventory, the CLI binary, and the negative internal-path
boundary. `npm run test:smoke` repeats those checks against a tarball installed in a clean consumer
and compiles imports for every declaration path.

## Export inventory

| Import | Purpose |
|---|---|
| `@smartergpt/lex` | Core types, trusted scope, and compatibility store API |
| `@smartergpt/lex/context` | Bounded canonical session context without CLI or MCP startup |
| `@smartergpt/lex/cli` | Programmatic CLI construction |
| `@smartergpt/lex/cli-output` | Structured CLI output helpers |
| `@smartergpt/lex/types` | Shared Frame and policy types and validators |
| `@smartergpt/lex/runtime-scope` | Trusted identity, authority, binding, and diagnostics |
| `@smartergpt/lex/normative-policy` | Typed normative policy contracts, canonicalization, and conformance fixtures |
| `@smartergpt/lex/errors` | AXError schemas, codes, and hints |
| `@smartergpt/lex/policy` | Policy loading and validation |
| `@smartergpt/lex/atlas` | Legacy compatibility barrel for Policy Neighborhood, Frame Graph, and Code Index |
| `@smartergpt/lex/atlas/code-unit` | Code-unit schemas and validation |
| `@smartergpt/lex/atlas/schemas` | Code Index run and policy-seed schemas |
| `@smartergpt/lex/module-ids` | Module identifier validation |
| `@smartergpt/lex/aliases` | Module alias resolution |
| `@smartergpt/lex/store` | Legacy FrameStore and authorized scoped persistence adapters |
| `@smartergpt/lex/dedup` | Frame duplicate detection |
| `@smartergpt/lex/similarity` | Frame similarity scoring |
| `@smartergpt/lex/consolidation` | Frame consolidation operations |
| `@smartergpt/lex/contradictions` | Frame contradiction detection |
| `@smartergpt/lex/maintenance` | Combined Frame maintenance API |
| `@smartergpt/lex/memory` | Frame payload validation |
| `@smartergpt/lex/memory/receipts` | Execution receipt creation and schemas |
| `@smartergpt/lex/memory/receipts/validator` | Receipt payload validation |
| `@smartergpt/lex/logger` | Structured logging |
| `@smartergpt/lex/prompts` | Prompt template loading and rendering |
| `@smartergpt/lex/lexsona` | Behavioral-memory integration |
| `@smartergpt/lex/knowledge` | KnowledgeFrame contract and deterministic Markdown compiler |
| `@smartergpt/lex/mcp-server` | Embeddable MCP server |
| `@smartergpt/lex/schemas/cli-output.v1.schema.json` | Versioned CLI output JSON Schema |
| `@smartergpt/lex/schemas/ecosystem-release-v1.schema.json` | Ecosystem release manifest JSON Schema |
| `@smartergpt/lex/schemas/feature-spec-v0.json` | Versioned feature specification JSON Schema |
| `@smartergpt/lex/schemas/profile.schema.json` | Lex profile JSON Schema |

The export path itself is stable once declared. Individual symbols may carry a narrower explicit
status: `@smartergpt/lex/normative-policy`, `@smartergpt/lex/lexsona`, and Code Index persistence
currently identify experimental behavior in their source contracts. Consumers should not infer
full behavioral stabilization from path availability alone; promoting or breaking those
experimental symbols still requires an explicit contract decision and release note.

The `atlas` package path is a compatibility umbrella, not one subsystem. Its current symbol
families and migration order are classified in the
[Atlas terminology map](./ATLAS_TERMINOLOGY.md).

## Trusted storage boundary

`@smartergpt/lex/store` keeps the unscoped 2.x adapters for migration compatibility, but trusted
CLI and MCP hosts bind `AuthorizedScope` to `ScopedFrameStore`. Normal code receives only
that bound view. `FrameStoreAdmin` is a separately authorized boundary for migration, repair, and
recovery. See [Store Contracts](./STORE_CONTRACTS.md), [Runtime Scope](./RUNTIME_SCOPE_CONTRACT.md),
and [PostgreSQL Scope Security](./POSTGRES_SCOPE_SECURITY.md).

The same package path exposes the behavioral contract through separate read/write views. LexSona
receives scoped data, immutable revisions, and deterministic receipts; it never receives a SQLite
or PostgreSQL handle. See [Scoped Behavioral Store](./BEHAVIORAL_STORE.md).
