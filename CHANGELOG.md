# Changelog

## 4.3.0

See the [4.3 migration and recovery guide](docs/releases/lex-4.3-migration.md).

### Minor Changes

- f66b956: Represent a confirmed absent operation explicitly so conditional policy can be dormant
  without confusing absence with unknown proposal data. Existing null proposals retain
  their fail-closed unknown meaning; absence cannot carry a route or implementation.
- 58631c4: Add deterministic, non-authorizing Codex and Copilot shadow policy projections with
  explicit profiles, independent fidelity/enforcement reporting, and verifiable receipts.

### Patch Changes

- Canonicalize both caller and repository paths during runtime discovery; preserve exact LF projection goldens across platforms.
- Refresh sharp and js-yaml patch dependencies to resolve audit findings.

- 03834c8: Return a closeable HTTP server handle and reject bind failures. Keep OAuth state local to each router and expire it on requests without an import-time background timer.
- 0506849: Preserve explicit `lex recall --fold-radius 0` so only seed modules are returned.
  Omitting the option still defaults to one hop. Reject negative, fractional,
  malformed and unsafe integer radii before accessing the Frame store; direct recall
  callers receive the same numeric validation.

## 4.2.0

See the [4.2 migration and recovery guide](docs/releases/lex-4.2-migration.md).

### Minor Changes

- bd25374: Add JSON-only normative-policy ingestion and deterministic, non-authorizing compilation with
  closed compiled records, exact relation-graph validation, and stable diagnostics. No resolver,
  authority evaluation, host installation, or live effect behavior is introduced.
- 758ab1f: Add the library-only normative policy resolver, protected verifier contract,
  bounded exception overlays, and deterministic non-authorizing effective snapshots.
  Release this increment together with the merged Slice 1A2 compiler.

## 4.1.0

### Minor Changes

See the [4.1 migration and recovery guide](docs/releases/lex-4.1-migration.md).

- 1c6feb1: Add the experimental typed normative-policy contract, canonicalization, binding checks, and
  data-only conformance fixtures.

### Patch Changes

- Refresh locked `fast-uri` to 3.1.7 and `qs` to 6.16.0 to resolve the dependency audit findings
  discovered during 4.1.0 release verification.

## 4.0.4

### Patch Changes

- 96f14bd: Preserve exact hyphenated and compound reference-point recall across PostgreSQL and SQLite without weakening scoped filters or exact-token semantics.

## 4.0.3

### Patch Changes

- Validate the MCP Registry manifest against the pinned `2025-12-11` schema in local, CI, and
  release gates; shorten the Registry description to its 100-character contract; and make signed-tag
  candidate verification accept an already-public package only when its integrity exactly matches the
  retained candidate. This supersedes the partial 4.0.2 release, whose npm artifact and signed tag are
  valid but whose GitHub release and MCP Registry publication did not complete.

## 4.0.2

### Patch Changes

- f56ea41: Align the PostgreSQL dogfood receipt validator and security guide with scoped FrameStore schema v4,
  keep the simulated WSL fixture path on its verified host drive when the canary runs on Windows, and grant trusted Frame
  imports the read capability required for collision handling. Runtime bindings now also reject roles
  that can `SET ROLE` to any privilege-bearing authority escape, with live `BYPASSRLS` and
  authority-mutator controls, direct protected-ledger mutation rejection, and a fail-closed membership
  check on PostgreSQL versions older than 16. PostgreSQL 16+ rejects both settable and immediately
  inherited unsafe-role paths, and disallows admin-option memberships that can regrant a settable
  path through otherwise benign bridge roles.

## 4.0.1

### Patch Changes

- 7493f13: Upgrade the repository-only ESLint and c8 toolchains to their patched major versions. Direct dependency declarations and the Node 24 support contract are unchanged.
- Refresh five transitive lock entries to patched releases for `brace-expansion`, `fast-uri`,
  `ip-address`, and both `js-yaml` lines; the high-severity dependency audit is clean.
- 2a795a6: Require every normalized `lex context` query term to match before continuity is ranked, and fail
  closed for empty or partially unsupported normalized queries instead of returning unrelated recent
  Frames.
- Persist bounded handoff provenance with exact repository, workspace, store, provider, and invocation
  identity so downstream session consumers can distinguish source-bound continuity from an unavailable
  or unbound runtime.
- Export the PostgreSQL behavioral-store migration plan, apply, SQL, and rollback surfaces from the
  public `@smartergpt/lex/store` entrypoint so operators can provision the runtime boundary without
  importing package internals.

## 4.0.0

Lex 4.0 participates in the Ecosystem 3.1 release train. The package-major version records the
breaking Node.js support-floor change honestly; Ecosystem 3.1 is a compatibility-set identifier,
not a lockstep package version.

[Migration and recovery guide](./docs/releases/lex-4.0-migration.md)

### Major Changes

- 561f075: Raise the supported Node.js runtime floor to Node 24 and remove the unproven `<25` upper bound.

### Minor Changes

- 39c1b59: Add the four-type KnowledgeFrame v1 contract, exact-path Markdown compilation, isolated coherent
  snapshot storage, bounded read-only context, provenance explanation, and structured CLI/provider
  operations.
- 315deed: Add the authorized, backend-neutral LexSona behavioral store with immutable persona and rule
  revisions, deterministic write receipts, scoped SQLite persistence, and PostgreSQL forced-RLS
  support.
- 925c0e5: Add the schema-validated Ecosystem 3.1 compatibility manifest and coupled cross-repository release
  SOP.
- bf0927b: Add the deterministic, redacted PostgreSQL quarantine inventory, ownership manifest, and
  zero-write recovery planning contract, plus an admin-only v4 recovery ledger and separately bound
  PostgreSQL service for transactional copy verification, receipt recovery, and explicit cleanup of
  preserved legacy Frames.

### Patch Changes

- 5fcb3b1: Upgrade sharp and its bundled libvips runtime to remediate high-severity image-processing advisories, and patch the transitive fast-uri parser vulnerability.
- Retire the duplicate legacy MCP transport and launcher with a fail-closed,
  agent-readable migration diagnostic that directs hosts to the canonical
  `@smartergpt/lex-mcp` package without implying Frame-store data loss.

## 3.0.1

### Patch Changes

- 2d79248: Rewrite Lex's documentation around the agent continuity story, add a bounded agent evaluation path, and align the prominent operator and contract references with Lex 3.
- Restore environment-selected PostgreSQL writes after the Lex 3 scoped migration by moving the
  unscoped compatibility adapter onto a distinct versioned relation and migration ledger. Direct
  Lex 2.x upgrades copy only demonstrably unowned Frames; scoped and quarantined data remain behind
  an explicit administrative ownership decision. ([#774](https://github.com/Guffawaffle/lex/issues/774))

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No unreleased changes._

---

## 3.0.0

### Major Changes

- 8264119: Add the Lex 3 PostgreSQL two-tenant/five-workspace GA acceptance gate, including deterministic
  redacted receipts, a direct least-privileged runtime login, real CLI/MCP parity checks, local
  Windows/WSL registry fixtures, and asserted cleanup of isolated live-canary resources. Restore the
  authority runtime role's read-only access to the schema-version ledger required by its fail-closed
  snapshot validation while explicitly rejecting ledger mutations.
- 9dc796b: Add the PostgreSQL canonical authority directory, explicit administration and dogfood topology
  provisioning, consistent resolver snapshots, workspace/repository authorization, stale local grant
  rejection, fully qualified explicit-schema persistence, and ready trusted CLI/MCP host compositions
  without ambient environment authority. Make authority migration provision the runtime role's safe
  schema usage and read-only table access as one atomic deployment step.
  Fail closed when the runtime role retains effective authority-schema `CREATE` through `PUBLIC` or
  an inherited group role.
- 5e5ab01: Add the Lex 3.0 PostgreSQL scoped FrameStore runtime and separate administration boundaries.
  Protect every normal Frame operation with explicit tenant/workspace/principal predicates,
  transaction-local pool context, forced Row-Level Security, runtime-role safety checks, and
  credential-free deterministic tests. Bind every relation and helper function to an explicit,
  validated PostgreSQL schema, including the transitional adapter, and preserve every Frame v7 field
  through a versioned metadata payload.
  Migrate schema v1 rows into an admin-only unowned quarantine instead of guessing ownership, and
  expose a non-mutating migration plan before schema v3 is applied.
  Reject runtime roles with effective `CREATE` on the protected FrameStore schema, including
  privileges inherited through `PUBLIC` or group roles.
- 0408fa9: Introduce the Lex 3.0 `ScopedFrameStore` and separately authorized `FrameStoreAdmin` contracts,
  including stable read, write, delete, and admin capabilities. Add an in-memory reference backend
  that binds immutable `AuthorizedScope` snapshots, stamps tenant/workspace ownership and creator
  attribution internally, and proves normal operations cannot cross their bound workspace.
- df62fa2: Add the Lex 3.0 scope-owned SQLite v15 adapter and explicit legacy migration staging. Each
  per-workspace file now has one immutable tenant/workspace binding, every normal operation is
  scope-filtered, and ownership migration requires a reviewed deterministic manifest, mandatory
  backup, transactional rebuild, verification receipt, and explicit recovery operation. Durable
  reads and updates preserve and validate the complete Frame v7 contract.
  Trusted MCP now advertises scoped SQLite attachments as unsupported and rejects attachment inputs
  until a scope-bound attachment service can preserve ownership safely.
- f8a9bfd: Bind trusted MCP configuration, policy, Code Atlas, and idempotency behavior to the
  authorized invocation workspace. Trusted dispatch now consumes physically contained
  file snapshots, uses the invocation's captured time and repository identity, and
  avoids ambient process configuration and executable lookup.

### Minor Changes

- 968e01c: Add public, versioned runtime-scope contracts for canonical authority, surface-local bindings,
  immutable invocation scope, structured diagnostics, stable resolver errors, and cross-platform
  conformance fixtures. Include deterministic execution-surface and registry-location resolution,
  a separate versioned SQLite local registry with explicit lifecycle operations, a fail-closed
  runtime-scope resolver, and concrete conformance coverage for every exported fixture.
  Add a shared, immutable CLI/MCP bootstrap guard that opens the surface-local registry read-only,
  attenuates requested capabilities, fails before command dispatch, and keeps redacted diagnostics
  explicit and capability-gated. Add native Git/filesystem/provider discovery, an explicit
  surface-local workspace binding lifecycle, exhaustive CLI/MCP capability maps, and lexical
  scope-bound FrameStore handoff that fails closed instead of falling back to an unscoped store.

### Patch Changes

- 42acca5: Add opt-in `--pretty` and `--prettier` aliases to the developer-validation driver for a
  check-only repository-wide Prettier audit while leaving the default validation gate unchanged.
- 69f4ead: Freeze the declared package export inventory and validate every JavaScript, type declaration,
  JSON Schema, and CLI artifact before release. Packed consumer smoke tests now import and type-check
  all public paths from a clean tarball installation while confirming internal paths remain blocked.
  Published declarations now carry their PostgreSQL and supported Node type dependencies and resolve
  their policy imports entirely within the package.
  Reconcile public Frame documentation with the implemented v7 record and mutable store contract,
  including opaque string IDs, targeted updates, and supersession, with a docs drift guard.
- 5860c42: Detect structurally inconsistent SQLite Frame stores and add an explicit, backed-up repair command
  for recognized additive schema divergence. Read-only and ordinary initialization paths now fail
  closed instead of silently repairing mismatched stores.
- Compatibility note: canonical MCP tool names remain preferred, but the older short and `lex_*`
  aliases are still accepted in Lex 3. Their eventual removal requires a separate breaking-change
  decision.

## 2.10.0

### Minor Changes

- Add a shared PostgreSQL FrameStore so WSL2 and Windows clients can use one
  coordinated store while preserving SQLite as the default local backend.
- Make `lex init` backend-aware, including PostgreSQL-only bootstrap support and
  explicit handling for existing shared stores.

### Patch Changes

- Add hard read-only SQLite access for inspection workflows without creating or
  mutating store files.
- Align the compiler and build graph with TypeScript 6 while retaining the
  existing runtime, CLI, MCP, and package contracts.

## 2.9.1

### Patch Changes

- Harden the MCP Registry delivery contract: coordinated wrapper/core versions,
  signed-tag provenance, schema and package validation, and protected DNS
  publication from an immutable release tag.

## 2.9.0

### Minor Changes

- Expose the Frame write contract in context and introspection, add bounded
  `--modules auto` inference plus an explicit `workspace/unscoped` fallback, and
  persist module attribution provenance with each Frame.

## 2.8.0

### Minor Changes

- Add a bounded, prompt-safe `lex context` command for agent session bootstrap. Align installed CLI and MCP caller-root configuration, expose canonical active-store identity and provenance, detect alternate conventional stores, and document shared `LEX_DB_PATH` configuration for multi-root workspaces.

## Contract Commitment

**Lex is public. This changelog is a contract.**

We sign every release with our names and our work. The contracts documented here —
AX guarantees, Frame schemas, Policy invariants — are promises we keep, not
marketing we forget.

See: [`docs/CONTRACT_SURFACE.md`](docs/CONTRACT_SURFACE.md) for the technical surface.
**Signatories:** Guff `[signed ~]` · Lex `[signed Lex ✶]`

---

## [2.5.0] - 2026-02-11

### Added

- **FrameStore: `updateFrame(id, updates)`** — Targeted field updates without full row replacement. Uses dynamic SQL `UPDATE ... SET` in SQLite and object merge in Memory implementation. Safe for adding metadata to existing Frames (e.g., marking as superseded). ([#705](https://github.com/Guffawaffle/lex/issues/705), [#707](https://github.com/Guffawaffle/lex/pull/707))
- **FrameStore: `purgeSuperseded()`** — Bulk delete all Frames where `superseded_by IS NOT NULL`. Replaces O(N) paginated-list-then-delete pattern with a single call. ([#704](https://github.com/Guffawaffle/lex/issues/704), [#708](https://github.com/Guffawaffle/lex/pull/708))
- **Export paths for maintenance utilities** — New package.json exports: `./dedup`, `./similarity`, `./consolidation`, `./contradictions`, and `./maintenance` (barrel). Out-of-tree FrameStore consumers (e.g., Majel) can now import deduplication, similarity scoring, consolidation, and contradiction detection utilities directly. ([#706](https://github.com/Guffawaffle/lex/issues/706), [#709](https://github.com/Guffawaffle/lex/pull/709))
- **71 new tests** across `update-frame.test.ts` (42), `purge-superseded.test.ts` (14), and `export-maintenance.test.ts` (15).

### Fixed

- **saveFrame() column omission** — `saveFrame()` and `saveFrames()` SQL now include `superseded_by` and `merged_from` columns (18 total, up from 16). Previously, these columns existed in the schema (migration V9), `frameToRow()`, and `rowToFrame()` but were omitted from the INSERT statement, causing consolidation metadata to be silently dropped. ([#705](https://github.com/Guffawaffle/lex/issues/705), [#707](https://github.com/Guffawaffle/lex/pull/707))

### Changed

- **consolidate.ts** functions (`markFrameAsSuperseded`, `updateFrameWithMergedFrom`) now use `updateFrame()` instead of the read-modify-`saveFrame()` pattern, eliminating the risk of clobbering unrelated fields during INSERT OR REPLACE.
- **FrameStore interface** expanded from 13 to 15 methods (additive, non-breaking).

### Migration Note

Consumers using `saveFrame()` to update dedup metadata should switch to `updateFrame()` for targeted updates. The `saveFrame()` bug fix means existing code will now correctly persist `superseded_by` and `merged_from`, but `updateFrame()` is the recommended approach.

---

## [2.4.0] - 2026-02-11

### Added

- **FrameStore: `getStats(detailed?)`** — Store diagnostics (total frames, thisWeek, thisMonth, date range, optional module distribution). Replaces raw `getDbStats()` calls that required a `Database` handle. ([#689](https://github.com/Guffawaffle/lex/issues/689), [#702](https://github.com/Guffawaffle/lex/pull/702))
- **FrameStore: `getTurnCostMetrics(since?)`** — Token and prompt cost aggregation from Frame `spend` metadata. Replaces raw `getTurnCostMetrics()` calls. ([#689](https://github.com/Guffawaffle/lex/issues/689), [#702](https://github.com/Guffawaffle/lex/pull/702))
- **`StoreStats` and `TurnCostMetrics` types** — Exported from `frame-store.ts` for consumers.
- **24 new tests** in `stats-turncost.test.ts` covering both SqliteFrameStore and MemoryFrameStore.

### Changed

- **MCPServer: Eliminated `private db: Database.Database | null`** — The server no longer holds a raw SQLite reference. All diagnostic queries (`db_stats`, `turncost_calculate`) now route through the FrameStore interface. ImageManager derives its db handle on-demand via `instanceof SqliteFrameStore`. ([#689](https://github.com/Guffawaffle/lex/issues/689))
- **MCPServer: Removed imports** of `getDbStats` from queries.ts and `Database` type from better-sqlite3.
- **FrameStore interface** expanded from 11 to 13 methods (additive, non-breaking).

### Migration Note

Consumers that previously cast `(store as any)._db` to call `getDbStats()` or `getTurnCostMetrics()` should now use `store.getStats()` and `store.getTurnCostMetrics()` directly.

---

## [2.3.0] - 2026-02-11

### Added

- **FrameStore: `deleteFrame(id)`** — Delete a single Frame by ID. Returns boolean indicating whether a Frame was found and deleted. Implemented in both SqliteFrameStore and MemoryFrameStore. ([#688](https://github.com/Guffawaffle/lex/issues/688), [#694](https://github.com/Guffawaffle/lex/pull/694))
- **FrameStore: `getFrameCount()`** — Get the total number of Frames in the store. Replaces the need for raw DB access to count frames. ([#688](https://github.com/Guffawaffle/lex/issues/688), [#694](https://github.com/Guffawaffle/lex/pull/694))
- **FrameStore: `userId` filtering on `searchFrames()` and `listFrames()`** — Add `userId?: string` to `FrameSearchCriteria` and `FrameListOptions` interfaces, enabling multi-tenant read-path isolation. Backward-compatible: omitting userId returns all frames. ([#691](https://github.com/Guffawaffle/lex/issues/691), [#700](https://github.com/Guffawaffle/lex/pull/700))
- **FrameStore: `deleteFramesBefore(date)`** — TTL-based retention cleanup. Deletes all Frames with timestamps before the given date. ([#693](https://github.com/Guffawaffle/lex/issues/693), [#701](https://github.com/Guffawaffle/lex/pull/701))
- **FrameStore: `deleteFramesByBranch(branch)`** — Branch lifecycle cleanup. Deletes all Frames matching a branch name. ([#693](https://github.com/Guffawaffle/lex/issues/693), [#701](https://github.com/Guffawaffle/lex/pull/701))
- **FrameStore: `deleteFramesByModule(moduleId)`** — Module decommission cleanup. Deletes all Frames containing the given module in their `module_scope`. Uses `json_each()` in SQLite. ([#693](https://github.com/Guffawaffle/lex/issues/693), [#701](https://github.com/Guffawaffle/lex/pull/701))

### Changed

- **FrameStore interface** expanded from 6 to 11 methods (all additive, non-breaking)
- **Test script** now includes `*.spec.ts` files alongside `*.test.ts` in `npm test`

---

## [2.2.1] - 2026-02-11

### Fixed

- **MCPServer**: Fixed `handleDbStats()` and `handleTurncostCalculate()` bypassing DI `frameStore`. Both methods now use the injected `this.db` instead of the global `getDb()` singleton, preventing database cross-contamination when Lex is embedded as a library alongside the MCP server with different database paths. ([#686](https://github.com/Guffawaffle/lex/issues/686))

## [2.2.0] - 2026-02-08

### Changed

- **SQLite dependency floor bump** - `better-sqlite3-multiple-ciphers` from `^12.4.6` to `^12.6.2`
  - Aligns all ecosystem repos (lex, lexsona, lexrunner) on the same SQLite version
  - Includes upstream bug fixes and performance improvements
- **Dependabot batch merge** - Merged 6 dependency updates:
  - `@isaacs/brace-expansion` 5.0.0 → 5.0.1
  - `commander` 14.0.2 → 14.0.3
  - `better-sqlite3-multiple-ciphers` 12.5.0 → 12.6.2
  - `pino` 10.1.0 → 10.3.0
  - `zod` 4.3.5 → 4.3.6
  - `@typescript-eslint/eslint-plugin` 8.52.0 → 8.54.0

---

## [2.1.2] - 2026-02-01

### Added

- **CLI `--query` option** for `lex recall` - Alternative to positional argument for better discoverability
  - Now supports both: `lex recall "topic"` and `lex recall --query "topic"` (or `-q`)
- **Database migration script** (`scripts/migrate-db.mjs`) - Fixes schema drift in older databases
  - Safely adds missing columns (`feature_flags`, `permissions`, etc.)
  - Idempotent - safe to run multiple times
  - Usage: `node scripts/migrate-db.mjs [db-path]`

### Fixed

- **Schema migration issue** - Databases created before full v11 schema were missing `feature_flags`
  and `permissions` columns, causing `SQLITE_ERROR: table frames has no column named feature_flags`
  - Root cause: Some early installations had incomplete schema application
  - Fix: Migration script or delete `lex-memory.db` to recreate with full schema
  - MCP server connections cache the database; restart VS Code/Claude Desktop after migration

### Notes

If you encounter the error `table frames has no column named feature_flags`:

1. **Quick fix**: Delete `lex-memory.db` (loses existing frames)
2. **Preserve data**: Run `node scripts/migrate-db.mjs ./lex-memory.db`
3. **Restart** your editor/MCP client to reconnect

---

## [2.1.1] - 2026-01-01

### Added

- **MCP Registry Publication** - Automated GitHub Actions workflow for MCP registry publication
- **README.mcp.md** - Dedicated MCP configuration guide for Claude Desktop and VS Code
- **Wave Completion Frame Emission** (LEX-MCP-001) - Emit frames when integration waves complete
- **Epic Status Auto-sync** (LEX-MCP-002) - Automatically sync parent epic status from sub-issue states
- **Natural Language Recall** (LEX-TSF-003) - Fuzzy matching for recall queries
- **Contradiction Detection** (LEX-TSF-002) - Detect contradicting information in stored frames
- **Frame Deduplication** - Consolidate duplicate frames automatically
- **OR-mode Search** (#656) - Multi-term queries now use OR logic for broader recall
- **AX CLI/MCP Parity** (#664, #665) - Added missing CLI and MCP tool equivalents:
  - CLI: `lex remember --dry-run`, `lex introspect`, `lex hints <ids>`
  - MCP: `db_stats`, `turncost_calculate`, `contradictions_scan`

### Changed

- Bumped MCP registry to 1.0.2
- MCP server module now exported for wrapper package integration

### Fixed

- Gracefully handle missing CLI build in validate-docs (#657)
- Aligned recall-quality tests with FTS5 AND behavior (#653)

### Security

- Bumped qs to 6.14.1 (GHSA-6rw7-vpxm-498p)

---

## [2.1.0] - 2025-12-16

### ⚠️ BREAKING CHANGE: MCP Tool Names

**VS Code automatically adds `mcp_{servername}_` prefix to all tool names.** Our previous naming included redundant prefixes, causing tools to appear as `mcp_lex_lex_remember` instead of `mcp_lex_remember`.

This release removes the namespace prefix from tool definitions to match the GitHub MCP pattern.

#### Migration Guide

| v2.0.x Tool Name   | v2.1.x Tool Name | VS Code Display        |
| ------------------ | ---------------- | ---------------------- |
| `lex_remember`     | `remember`       | `mcp_lex_remember`     |
| `lex_recall`       | `recall`         | `mcp_lex_recall`       |
| `lex_list_frames`  | `list_frames`    | `mcp_lex_list_frames`  |
| `lex_timeline`     | `timeline`       | `mcp_lex_timeline`     |
| `lex_policy_check` | `policy_check`   | `mcp_lex_policy_check` |
| `lex_code_atlas`   | `code_atlas`     | `mcp_lex_code_atlas`   |

**Backwards Compatibility:** The old `lex_*` names are preserved as deprecated aliases. The
historical removal target was v3.0.0, but Lex 3 retains them; see the 3.0 compatibility note above.

### Changed

- MCP tool names no longer include namespace prefix (GitHub MCP pattern)
- Updated `docs/NAMING_CONVENTIONS.md` with correct VS Code prefix behavior

### Fixed

- Tools now display correctly in VS Code as `mcp_lex_{action}` instead of `mcp_lex_lex_{action}`

---

## [2.0.3] - 2025-12-16

### Added

- **MCP tool naming convention** - All MCP tools renamed to `lex_{action}` pattern (VS Code adds `mcp_lex_` prefix)
  - `lex.remember` → `lex_remember`
  - `lex.recall` → `lex_recall`
  - `lex.list_frames` → `lex_list_frames`
  - `lex.timeline` → `lex_timeline`
  - `lex.policy_check` → `lex_policy_check`
  - `lex.code_atlas` → `lex_code_atlas`
  - Old names preserved as deprecated aliases for backwards compatibility

- **Ecosystem naming conventions** - Added `docs/NAMING_CONVENTIONS.md` as canonical spec for:
  - MCP tool names: `{namespace}_{action}` (VS Code adds `mcp_{server}_` prefix)
  - CLI commands: `{cli} {category} {action}`
  - File names, TypeScript identifiers, persona IDs

---

## [2.0.2] - 2025-12-13

### Fixed

- **LexSona subpath export** - `@smartergpt/lex/lexsona` now correctly included in npm package
  - Previous 2.0.1 was published from wrong branch without export
  - Enables LexSona package to import `getRules`, `recordCorrection` APIs

---

## [2.0.1] - 2025-12-13 (yanked)

_Published from incorrect branch. Use 2.0.2 instead._

---

## [2.0.0] - 2025-12-05

### 🚀 AX-Native Release (Stable)

Lex 2.0.0 is the first stable release with **AX (Agent eXperience)** as a first-class design principle.
This release graduates from alpha with all AX guarantees verified and documented.

**Install:** `npm install @smartergpt/lex@latest`

### What's New Since Alpha

- **`lex instructions` CLI** - Full instruction management:
  - `lex instructions init` - Scaffold canonical source, lex.yaml, and target files
  - `lex instructions generate` - Generate host-specific projections
  - `lex instructions check` - Verify projections are in sync
- **Performance improvements** - Cached policy module ID lookups for O(1) resolution
- **AX documentation in CONTRIBUTING.md** - PR review checklist for AX compliance
- **LexSona behavioral memory socket** - `recordCorrection`/`getRules` API for persona integration

### Contract Status

This release freezes the following contracts:

| Contract      | Version | Document                        |
| ------------- | ------- | ------------------------------- |
| AX Guarantees | v0.1    | `docs/specs/AX-CONTRACT.md`     |
| Frame Schema  | v3      | `docs/specs/FRAME-SCHEMA-V3.md` |
| Error Schema  | v1      | AXError in `src/shared/errors/` |
| FrameStore    | 1.0.0   | `src/memory/store/CONTRACT.md`  |

Breaking these contracts requires a major version bump and explicit changelog entry.

---

## [2.0.0-alpha.1] - 2025-12-01

### 🚀 AX-Native Release (Alpha)

Lex 2.0.0 introduces **AX (Agent eXperience)** as a first-class design principle.
This is the first release where AX guarantees are real, not just documented.

> **Alpha Notice:** This is a prerelease for LexRunner 1.0.0 integration testing.
> Install with `npm install @smartergpt/lex@alpha` — not marked as `latest`.

### Contract Status

This release freezes the following contracts:

| Contract      | Version | Document                        |
| ------------- | ------- | ------------------------------- |
| AX Guarantees | v0.1    | `docs/specs/AX-CONTRACT.md`     |
| Frame Schema  | v3      | `docs/specs/FRAME-SCHEMA-V3.md` |
| Error Schema  | v1      | AXError in `src/shared/errors/` |
| FrameStore    | 1.0.0   | `src/memory/store/CONTRACT.md`  |

Breaking these contracts requires a major version bump and explicit changelog entry.

### AX Contract v0.1 Compliance

| Guarantee          | Status | Details                             |
| ------------------ | ------ | ----------------------------------- |
| Structured Output  | ✅     | `--json` on `remember`, `timeline`  |
| Recoverable Errors | ✅     | AXError schema with `nextActions[]` |
| Memory & Recall    | ✅     | FTS5 case-insensitive, hyphen-safe  |
| Frame Emission     | ✅     | Frame v3 schema stable for runners  |

**This table is a contract.** If we break any of these guarantees, it's a bug.

### Added

- **AXError Schema** (`src/shared/errors/ax-error.ts`)
  - Zod schema: `code`, `message`, `context`, `nextActions[]`
  - Factory: `createAXError()`, `wrapAsAXError()`
  - Type guard: `isAXError()`
  - Exception class: `AXErrorException`

- **Frame Schema v3** (`src/shared/types/frame-schema.ts`)
  - Zod validation: `FrameSchema`, `parseFrame()`, `createFrame()`
  - Runner fields: `runId`, `planHash`, `executorRole`, `toolCalls`, `guardrailProfile`
  - Documentation: `docs/specs/FRAME-SCHEMA-V3.md`

- **CLI JSON Output**
  - `lex remember --json` — structured event output
  - `lex timeline --json` — structured event output
  - AXError integration for failure cases

- **AX Documentation**
  - `docs/specs/AX-CONTRACT.md` — v0.1 guarantees
  - `docs/specs/AX-AI-EXPERIENCE.md` — philosophy
  - `docs/specs/AX-IMPLEMENTATION-PLAN.md` — roadmap

### Fixed

- **Recall FTS5 Hyphen Handling** (AX-002)
  - Compound queries like `"recall-fix"` now work correctly
  - Case-insensitive search per AX Contract §2.4

### New Exports

| Import                   | Purpose                      |
| ------------------------ | ---------------------------- |
| `@smartergpt/lex/errors` | AXError schema and utilities |

### For LexRunner Integration

LexRunner 1.0.0 can now:

- Import `AXErrorSchema`, `createAXError` from `@smartergpt/lex/errors`
- Import `FrameSchema`, `createFrame` from `@smartergpt/lex/types`
- Emit Frames for merge-weave completions
- Return structured errors with recovery actions

---

## [1.0.2] - 2025-11-28

### Fixed

- Minor bug fixes and stability improvements

## [1.0.0] - 2025-11-27

### 🎉 First Stable Release

Lex 1.0.0 marks the first stable API contract. All public exports now have explicit subpaths,
and the FrameStore interface is frozen for 1.0.x releases.

### Highlights

- **Stable API Contract:** All public exports have explicit subpaths in `package.json`
- **Security:** SQLCipher database encryption + OAuth2/JWT authentication
- **MCP Server:** Machine-readable error codes (`MCPErrorCode` enum) for orchestrators
- **CLI:** JSON output mode with schema validation
- **Policy Bootstrap:** `lex init --policy` generates starter policy from codebase

### Added

- **ARCH-001: FrameStore Contract Freeze**
  - `FRAME_STORE_SCHEMA_VERSION = "1.0.0"` exported from `@smartergpt/lex/store`
  - `CONTRACT.md` documents persistence requirements
  - PR template updated with FrameStore change checklist
  - Changes to FrameStore interface now require explicit protocol

### Breaking Changes from 0.4.x

- Wildcard exports removed (use explicit subpaths)
- `getCurrentBranch()` / `getCurrentCommit()` now return `string | undefined`
- `LEX_GIT_MODE=off` is the new default (set to `live` for git features)

### Subpath Exports

| Import                       | Purpose                |
| ---------------------------- | ---------------------- |
| `@smartergpt/lex`            | Core types + store API |
| `@smartergpt/lex/types`      | All shared types       |
| `@smartergpt/lex/store`      | Database operations    |
| `@smartergpt/lex/policy`     | Policy loading         |
| `@smartergpt/lex/atlas`      | Atlas Frame generation |
| `@smartergpt/lex/module-ids` | Module ID validation   |
| `@smartergpt/lex/aliases`    | Alias resolution       |
| `@smartergpt/lex/cli-output` | CLI JSON utilities     |

### Metrics

| Metric         | Value       |
| -------------- | ----------- |
| Tests          | 1013        |
| Source files   | 108         |
| Exports        | 14 subpaths |
| Schema version | 2           |

## [0.6.0] - 2025-11-27

### Added

- **Store Layer Contracts:** Persistence abstraction for database operations
  - `FrameStore` interface: stable 1.0 contract for Frame persistence
  - `SqliteFrameStore`: Default SQLite implementation
  - `src/memory/store/` subpath export for store access
  - See `docs/STORE_CONTRACTS.md` for interface details

- **SQL Safety Guardrails:** Curated query modules enforced via CI test
  - `test/sql-safety.test.ts`: Fails if `db.prepare()` appears outside curated modules
  - Curated modules: `queries.ts`, `code-unit-queries.ts`, `db.ts`, `backup.ts`, `images.ts`, `code-atlas-runs.ts`, `auth/`, `routes/`, `shared/cli/db.ts`
  - Prevents dynamic SQL from models/prompts reaching the database layer
  - See `.github/copilot-instructions.md` SQL Safety section for rules

- **IP Boundary Guardrail:** CI test ensuring Lex does not import from lexrunner
  - `test/ip-boundary.test.ts`: Fails if any source imports from lexrunner
  - Lex is a public MIT library; lexrunner may import FROM Lex, never the reverse

- **Migrations Directory:** Schema evolution infrastructure
  - `migrations/README.md`: Rules for numbered migration files
  - `migrations/000_reference_schema.sql`: Complete V6 schema documentation
  - Schema-only changes; data migrations require explicit approval

### Experimental

- **CodeAtlasStore (@experimental):** Interface for Code Atlas persistence
  - API may change in 1.0.x releases without semver guarantees
  - Will be stabilized in a future minor release

### Security

- **Database migration hardening (SEC-001):** Column names are now validated during `lex db encrypt` migration
  - Added validation for column names using alphanumeric pattern `/^[a-zA-Z0-9_]+$/`
  - Both `dbEncrypt` and `calculateDatabaseChecksum` functions now validate column names
  - Migration fails with explicit error if malformed column names are detected
  - Prevents potential SQL injection from maliciously crafted source databases

### Documentation

- **SQL Safety Section:** Added comprehensive SQL safety rules to `.github/copilot-instructions.md`
  - Curated SQL modules whitelist
  - Forbidden patterns with examples
  - Migration workflow guidance
- **IP Boundary Section:** Added to `.github/copilot-instructions.md`
  - Lex → lexrunner import forbidden
  - CI enforcement via `test/ip-boundary.test.ts`

## [0.4.7-alpha] - 2025-11-26

### Added

- **Tracked policy file:** Added `canon/policy/lexmap.policy.json` providing an out-of-the-box policy configuration for Lex dogfooding with 23 defined modules

### Changed

- **Dependencies updated:**
  - `zod`: 4.1.12 → 4.1.13
  - `glob`: 11.1.0 → 13.0.0
  - `inquirer`: 12.11.1 → 13.0.1
  - `@typescript-eslint/parser`: 8.47.0 → 8.48.0
  - `@types/uuid`: 10.0.0 → 11.0.0

## [0.4.2-alpha] - 2025-11-21

### Security

- **HTTP server hardening (BREAKING CHANGE):** Comprehensive security overhaul for Frame Ingestion API
  - `apiKey` now **required** (was optional) - throws error if missing
  - Rate limiting: 100 requests per 15 minutes (general), 5 auth failures per 15 minutes
  - Security headers via Helmet: CSP, HSTS, X-Frame-Options, X-Content-Type-Options
  - Request size limits: 1MB maximum body size
  - Audit logging: Method, path, status, duration, IP, hashed API key
  - **Migration required:** All HTTP server deployments must add `apiKey` configuration
  - See `SECURITY.md` for deployment best practices (reverse proxy, TLS, environment variables)

### Added

- **Security dependencies:** express-rate-limit@7.5.0, helmet@8.0.0 for production hardening
- **Test coverage:** 11 new HTTP security tests (authentication, rate limiting, headers, validation)

### Changed

- **Type definitions:** `http-server.d.ts` now requires `apiKey` (breaking change)
- **Route behavior:** Frame creation routes now enforce authentication unconditionally

### Documentation

- **SECURITY.md:** New HTTP Server Security section with Nginx reverse proxy example
- **Deployment guidance:** Production best practices, DO/DON'T lists, MCP stdio vs HTTP comparison

## [Previous Releases]

### Security

- **Dependency vulnerabilities fixed:** Updated glob and js-yaml to patch security issues
  - `glob@11.0.3 → 11.1.0` - Fixes command injection vulnerability (GHSA-5j98-mcp5-4vw2, HIGH)
  - `js-yaml@4.1.0 → 4.1.1` - Fixes prototype pollution (GHSA-mh29-5h37-fv8m, MODERATE)
  - All tests pass (123/123), no breaking changes
  - See `.smartergpt.local/VULNERABILITY_FIXES_20251119.md` for detailed analysis

### Security Posture & Documentation

- **SECURITY.md enhanced:** Added comprehensive security guidance for dev-time vs production use
  - Clear scope: "Local dev / small teams" (acceptable) vs "Public multi-tenant" (not recommended for 0.4.0-alpha)
  - Known limitations documented: No auth, no encryption, no audit logging
  - Production roadmap: P0/P1/P2 features planned for 0.5.0-0.7.0
  - Vulnerability disclosure process established

- **Package messaging clarified:** Removed LexRunner commercial positioning
  - package.json description now emphasizes MIT licensing and dev-time use
  - README no longer positions Lex as "powers paid LexRunner"
  - Clear separation: Lex is standalone MIT library, not a marketing funnel

- **Scanner security warnings:** Added comprehensive disclaimers to `examples/scanners/README.md`
  - "Examples only, not production-hardened" warnings
  - Safe usage guidelines (review code, sandbox execution, validate output)
  - Production scanning pipeline recommendations

- **ARCHITECTURE.md created:** New documentation for design decisions
  - Dependency rationale (why Express, Sharp, Shiki despite size)
  - Future modularization plan (peer deps in 0.5.0, package split in 0.6.0)
  - Design philosophy ("dumb by design" scanners, local-first, explicit over implicit)
  - Database design decisions and performance considerations

- **Lint cleanup roadmap:** Created 4 GitHub issues for post-alpha warning reduction
  - Issue #1: Remove 48 unused variables/imports (P1)
  - Issue #2: Type MCP server arguments (25 explicit any → proper types) (P1)
  - Issue #3: Fix 30 unsafe any operations (P2, depends on #2)
  - Issue #4: Address 4 misc warnings (P2)
  - New policy: No new warnings in PRs after 0.4.0-alpha

### Repository Cleanup

- **Tracked MCP symlink:** `memory/mcp_server/frame-mcp.mjs` now tracked (required by `lex-launcher.sh`)
- **Removed lint baseline:** Deleted empty `lint-baseline.json` from tracking (optional dev tool)
- **CLI cleanup:** Removed commented-out commands for unimplemented features (`db vacuum`, `db backup`, `frames export`)
- **Architecture notes:** Clarified Zod/TypeScript type separation in `src/memory/frames/types.ts`
- **Scanner examples:** Relocated Python/PHP scanners to `examples/scanners/` (not part of TS runtime)

### ⚠️ Breaking Changes

- **REMOVED:** `LEX_PROMPTS_DIR`, `LEX_SCHEMAS_DIR`, `LEX_CONFIG_DIR` environment variables
  - **Use:** `LEX_CANON_DIR=/path/to/canon` (points to directory containing `prompts/` and `schemas/`)
  - **Example:** `export LEX_CANON_DIR=/custom/canon` loads prompts from `/custom/canon/prompts/`

- **REMOVED:** Runtime reads of `.smartergpt/` directory for prompts
  - **Use:** `.smartergpt/prompts/` for shared prompt overlays (organization-level)
  - **Note:** `.smartergpt/` schemas remain for build-time compilation only

- **CHANGED:** Prompt loading precedence (3-level instead of 5-level)
  - **Old:** `LEX_PROMPTS_DIR` → `.smartergpt/prompts/` → prompts/
  - **New:** `LEX_PROMPTS_DIR` → `.smartergpt/prompts/` → `prompts/` → `canon/prompts/`

- **CHANGED:** Zod schemas now use `.loose()` instead of `.passthrough()`
  - Affects: `GateConfigSchema`, `StackComponentConfigSchema` in infrastructure schemas
  - Behavior unchanged, but aligns with Zod 4.x best practices

### Migration Guide

1. **Replace environment variables:**

   ```bash
   # OLD
   export LEX_PROMPTS_DIR=/custom/prompts
   export LEX_SCHEMAS_DIR=/custom/schemas

   # NEW
   export LEX_CANON_DIR=/custom/canon  # containing prompts/ and schemas/
   ```

2. **Move local overrides (if using deprecated .smartergpt/prompts):**

   ```bash
   # Only needed if you were reading from .smartergpt/prompts at runtime
   # (typically you weren't - this was mostly for internal development)
   mkdir -p .smartergpt/prompts
   # Add your custom prompt files to .smartergpt/prompts/
   ```

3. **Update scripts/configs referencing old environment variables**

4. **Re-test precedence:** `LEX_PROMPTS_DIR` → `.smartergpt/prompts/` → `prompts/` → `canon/prompts/`

## [0.4.0] - 2025-11-09

### ⚠️ Breaking Changes (Internal APIs)

**Note:** These changes only affect internal APIs. Lex has no external adopters yet (internal dogfooding phase only).

- **Legacy Module ID Validator Removed** ([#173](https://github.com/Guffawaffle/lex/pull/173)): Deleted `validateModuleIdsSync()` function and its test suite
  - **Previous behavior**: Synchronous validator without alias resolution support
  - **New behavior**: Use `validateModuleIds()` (async) which provides full alias resolution
  - **Migration**: Replace all `validateModuleIdsSync(ids, policy)` calls with `await validateModuleIds(ids, policy, aliasTable)`
  - **Why**: Async validator is strictly superior with alias support; sync version was deprecated and unused

- **Policy Reporter Signature Modernized** ([#173](https://github.com/Guffawaffle/lex/pull/173)): Enforced modern `generateReport()` signature
  - **Previous behavior**: Accepted 3 arguments `generateReport(violations, policy, format)` with legacy type detection
  - **New behavior**: Single object parameter `generateReport(violations, { policy, format })`
  - **Migration**: Change `generateReport(violations, policy, "json")` → `generateReport(violations, { policy, format: "json" })`
  - **Why**: Modern signature is clearer, easier to extend, and removes legacy type detection code

- **Legacy Policy Loader Cleanup** ([#173](https://github.com/Guffawaffle/lex/pull/173)): Removed `LEGACY_POLICY_PATH` and `transformPolicy()` fallbacks
  - **Previous behavior**: Attempted to load legacy policy format and transform to current schema
  - **New behavior**: Only loads current "modules" format from standard paths
  - **Migration**: Ensure all policy files use current schema with `"modules"` key
  - **Why**: All policy files already use current format; legacy fallbacks were unused dead code

### Added

- **Structured Logging System** ([#173](https://github.com/Guffawaffle/lex/pull/173)): Pino-based logger with subpath export
  - `lex/logger` subpath provides `getLogger(scope?)` function
  - Respects `LEX_LOG_LEVEL` env var (silent/trace/debug/info/warn/error/fatal)
  - Respects `LEX_LOG_PRETTY` env var for TTY-aware formatting
  - Tests default to `silent` level to avoid pollution
  - Scope support for categorizing log entries (`{scope: "cli:remember"}`)
  - **pino-pretty** moved to `optionalDependencies` - gracefully falls back to JSON if not installed

- **CLI Output Wrapper** ([#173](https://github.com/Guffawaffle/lex/pull/173)): Centralized console output system
  - `src/shared/cli/output.ts` provides dual-sink output (console + diagnostic logger)
  - Supports plain mode (default, human-readable) and JSONL mode (machine-parseable)
  - Stream routing: errors/warnings → stderr, info/success/debug → stdout
  - Controlled via `LEX_CLI_OUTPUT_MODE` env var
  - See `docs/CLI_OUTPUT.md` and `schemas/cli-output.v1.schema.json` for details

- **ESLint Legacy Guards** ([#173](https://github.com/Guffawaffle/lex/pull/173)): Prevent reintroduction of removed patterns
  - Added `no-restricted-imports` rules forbidding `**/framestore` and `**/validateModuleIdsSync*`
  - Enforced `no-console` globally with narrow override only for `src/shared/cli/output.ts`
  - Helpful error messages guide developers to correct alternatives

### Changed

- **ESM Imports in Database Layer** ([#173](https://github.com/Guffawaffle/lex/pull/173)): Converted `require()` to ESM imports
  - `src/memory/store/db.ts` now uses proper `import { readFileSync } from "fs"` instead of `require()`
  - Better TypeScript type inference and IDE support
  - Aligns with pure ESM codebase policy

- **Test/Docs Terminology Updates** ([#173](https://github.com/Guffawaffle/lex/pull/173)): Clarified "backward-compatible" → "named exports"
  - Test descriptions updated to reflect these are intentional current APIs, not legacy compatibility layers
  - `docs/CLI_OUTPUT.md` terminology clarified

### Fixed

- **ESLint Configuration Optimized** ([#173](https://github.com/Guffawaffle/lex/pull/173)): Reduced type-safety warnings by 94.6%
  - Lint warnings reduced from 661 → 154 (73% overall reduction)
  - Type-safety rules (no-unsafe-\*) exempted for test files and data boundary layers
  - Core business logic in `src/memory` and `src/policy` remains strictly typed
  - Zero hard-stop errors

### Performance

- **CI Cost Optimization** ([#173](https://github.com/Guffawaffle/lex/pull/173)): Reduced GitHub Actions runs by 25%
  - Removed duplicate Node 22 matrix entry from alias tests
  - Maintains Node 20 LTS coverage

### Documentation

- **Legacy Removal Plan** ([#173](https://github.com/Guffawaffle/lex/pull/173)): Added `docs/legacy-removal-plan.md` documenting Phase 2-3 cleanup strategy
- **CLI Output Documentation** ([#173](https://github.com/Guffawaffle/lex/pull/173)): Enhanced `docs/CLI_OUTPUT.md` with usage patterns and schema reference
- **README Updates** ([#173](https://github.com/Guffawaffle/lex/pull/173)): Added Quick Start section and environment variable documentation

## [0.3.0] - 2025-11-08

### ⚠️ Breaking Changes

- **Module ID Validation Strictness** ([#119](https://github.com/Guffawaffle/lex/pull/119)): Substring matching is now disabled in the validator
  - **Previous behavior**: `'auth-core'` would match `'services/auth-core'` automatically
  - **New behavior**: Only exact matches or explicit aliases are accepted (confidence === 1.0)
  - **Migration**: If you rely on substring matching, add explicit aliases to your policy files
  - **Why**: Prevents unintended module resolution and enforces stricter validation

### Added

- **Performance Optimization**: O(1) policy lookup caching via WeakMap for module ID validation ([#117](https://github.com/Guffawaffle/lex/pull/117))
  - Fast path for all-exact-matches case, bypassing resolver entirely
  - 1000-module policy now validates in same time as 10-module (~0.003ms)
  - Benchmark performance improved by ~55% (faster than baseline)
- **Improved Error Handling**: FTS5 search errors now gracefully return empty results instead of failing ([#120](https://github.com/Guffawaffle/lex/pull/120))
  - Handles special characters (hyphens, operators) in search queries
  - Treats SQLITE_ERROR as empty result set rather than propagating errors
  - Better handling of edge cases: unicode, special chars, and malformed queries

### Changed

- **Stricter Module ID Validation**: Disabled substring matching in validator ([#119](https://github.com/Guffawaffle/lex/pull/119))
  - Now only accepts `confidence === 1.0` resolutions (exact match or explicit alias)
  - Substring matches (confidence 0.9) correctly fail validation but suggest alternatives
  - Example: `'auth-core'` no longer auto-resolves to `'services/auth-core'` without explicit alias
  - Enforces case-sensitive validation
- **Documentation Updates**: Comprehensive updates to reflect single-package structure ([#112](https://github.com/Guffawaffle/lex/pull/112))
  - Replaced all `@lex/*` imports with relative paths from `src/`
  - Updated runtime paths: `memory/mcp_server/frame-mcp.mjs` → `dist/memory/mcp_server/frame-mcp.js`
  - Simplified build documentation to single `npm run build` command
  - Updated RELEASE.md, .changeset/README.md, and all module READMEs
  - Added import pattern reference and subpath exports documentation

### Fixed

- **ESM Compatibility**: Fixed CommonJS `require()` in ES module test file ([#118](https://github.com/Guffawaffle/lex/pull/118))
  - Replaced `require("fs")` with ES module import
  - All 12 integration tests now execute properly in ESM context
- **Benchmark Test Fixes**: Made async functions properly await validation promises ([#117](https://github.com/Guffawaffle/lex/pull/117))
  - Tests were measuring promise creation time (~0.001ms) instead of actual execution
  - Fixed `measureTime` and `benchmark` functions to use async/await correctly
- **Build Artifacts**: Added `tsconfig.tsbuildinfo` to `.gitignore` ([#119](https://github.com/Guffawaffle/lex/pull/119))

## Integration Notes

All changes were integrated via umbrella PR [#121](https://github.com/Guffawaffle/lex/pull/121) (batch integration, 2025-11-07).

The 5 PRs were merged locally in dependency order:

1. PR #112 - Documentation updates (independent)
2. PR #118 - ESM test fix (independent)
3. PR #117 - Performance & caching (independent)
4. PR #119 - Validator strictness (depends on #117)
5. PR #120 - Empty search handling (independent)

All gates (lint, typecheck, test) passed locally before integration.

## Upgrade Notes

### From 0.2.0 to 0.3.0

#### Module ID Validation Changes

If you're using module ID validation and previously relied on substring matching:

**Example scenario that now requires explicit aliases:**

```typescript
// Previously worked (substring match):
validateModuleIds(['auth-core'], policy); // matched 'services/auth-core'

// Now requires explicit alias or full path:
validateModuleIds(['services/auth-core'], policy); // full path
// OR add alias to policy:
{
  "aliases": {
    "auth-core": "services/auth-core"
  }
}
```

#### Performance Improvements

The validation performance improvements are automatic and require no code changes. If you were caching policy lookups manually, you may be able to remove that code as it's now handled internally.

#### Documentation Updates

If you're referencing old monorepo documentation:

- Update import patterns from `@lex/*` to relative paths
- Use subpath exports: `lex/cli`, `lex/policy/*`, `lex/memory/*`, `lex/shared/*`
- Build command simplified to `npm run build`

#### FTS5 Search Behavior

Empty search results and special character handling is now more graceful. If you were catching and handling FTS5 SQLITE_ERROR exceptions, that error handling may no longer trigger as these are now treated as empty result sets.

## [0.2.0] - 2025-11-02

Initial release with unified single-package structure after monorepo consolidation (PR #91).

### Features

- Policy-aware memory system with receipts
- Frame storage with SQLite FTS5 search
- MCP (Model Context Protocol) server for memory access
- Module ID validation with fuzzy matching
- Alias resolution system
- Policy checking and scanning

### Architecture

- Single package with subpath exports
- ESM-first design
- TypeScript with strict type checking
- Comprehensive test coverage

[Unreleased]: https://github.com/Guffawaffle/lex/compare/v3.0.1...HEAD
[3.0.1]: https://github.com/Guffawaffle/lex/releases/tag/v3.0.1
[3.0.0]: https://github.com/Guffawaffle/lex/releases/tag/v3.0.0
[0.3.0]: https://github.com/Guffawaffle/lex/releases/tag/v0.3.0
[0.2.0]: https://github.com/Guffawaffle/lex/releases/tag/v0.2.0
