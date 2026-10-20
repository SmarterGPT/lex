# Ecosystem 3.1 documentation inventory

> **Status:** Execution inventory for Lex 4.0 / Ecosystem 3.1
> **Baseline:** Repository state reviewed on 2026-07-22
> **Scope:** Lex documentation only; this inventory does not itself delete or rewrite another file

This inventory defines the delete-first documentation pass required before Lex 4.0 can represent
the Lex portion of the Ecosystem 3.1 train. The goal is not to make every old sentence sound
current. It is to establish one owner for each live contract, reduce duplicated procedures to
links, preserve immutable release history, and remove advice that would lead a human or agent to
the wrong package, runtime, transport, tool, or database recovery action.

“Delete-first” means that a cleanup removes a duplicated or obsolete claim before adding another
explanation of the same claim. It does not mean erasing release history. Historical records remain
historical, with their original versions, package names, dates, and decisions intact.

## Execution status

The Lex 4 release candidate applies the release-blocking part of this inventory:

- replaces `RELEASE.md` with the current manual-publication and partial-recovery contract;
- adds one canonical Lex 4 migration/recovery guide and links it from every release entrypoint;
- aligns package, lock, README, changelog, Ecosystem manifest, and MCP Registry manifest at 4.0.0;
- documents canonical Lex-MCP launch, filtered secret pass-through, restart, and fail-closed legacy
  launcher recovery;
- replaces the duplicated MCP/HTTP consumer manual with a bounded maintainer-internals map;
- removes unsafe delete-the-database troubleshooting advice;
- makes current trusted-host contract framing version-neutral;
- marks dated troubleshooting, adoption, architecture, HTTP, security-incident, audit, and canon
  documents as historical or superseded so they cannot claim current authority; and
- adds executable version, link, tool, launcher, environment, recovery-text, and manual-publication
  checks.

Deep relocation and deletion of the now-clearly-bounded historical corpus is tracked in
[Lex #793](https://github.com/Guffawaffle/lex/issues/793). That follow-up cannot redefine the Lex 4
release contract or remove immutable release evidence.

## Authority order

When current prose disagrees, use this order:

1. Machine-enforced contracts and runtime behavior:
   [`package.json`](../../package.json), [`releases/ecosystem-3.1.json`](../../releases/ecosystem-3.1.json),
   [`canon/schemas`](../../canon/schemas), the package export map, CLI help, MCP `tools/list`, and
   focused conformance tests.
2. The current normative owner document named below.
3. A derived guide or index that links to the owner.
4. Historical release notes, ADRs, plans, audits, and implementation reports.

A lower layer must not redefine a higher layer. If a derived guide needs the same table or
procedure, it should link to or mechanically derive from the owner.

## Current normative owners

These documents should remain current and are the places where a live contract is explained.
Some need a narrow Lex 4 wording update, but their role should not be duplicated elsewhere.

| Contract | Normative owner | Evidence and required treatment |
| --- | --- | --- |
| Ecosystem 3.1 membership, dependency order, human approval checkpoints, and recovery | [`docs/releases/ecosystem-3.1.md`](./ecosystem-3.1.md), backed by [`releases/ecosystem-3.1.json`](../../releases/ecosystem-3.1.json) and its schema | Distinguishes train name from package SemVer, selects Lex 4.0, requires immutable evidence, and binds Lex npm publication to the reviewed trusted-publishing workflow. Keep this as the release-train SOP. |
| Node support floor and native-addon refresh | [`docs/releases/node-24-migration.md`](./node-24-migration.md), backed by `package.json#engines`, `.nvmrc`, workflows, and `scripts/check-node-runtime-contract.mjs` | Already records that Lex 4.0 requires Node 24 or newer and that published 3.0.1 metadata remains immutable. All current guides should link here instead of restating a version matrix. |
| Public package name and exports | [`docs/PUBLIC_API.md`](../PUBLIC_API.md), backed by [`package.json`](../../package.json) and `scripts/verify-public-api.mjs` | Its export inventory matches the scoped `@smartergpt/lex` map and rejects source or undeclared `dist/` imports. Rename the “Lex 3.0 storage boundary” heading without changing the underlying contract history. |
| Frame persistence semantics | [`src/memory/store/CONTRACT.md`](../../src/memory/store/CONTRACT.md) | It explicitly identifies current schema versions, opaque IDs, mutation semantics, capability boundaries, and quarantine recovery. It supersedes the ULID/lifecycle claims in old plans. Update only release-line framing that still says Lex 3.0. |
| Trusted identity, authority, and scope | [`docs/RUNTIME_SCOPE_CONTRACT.md`](../RUNTIME_SCOPE_CONTRACT.md) | This is the live trusted-host contract. Paths and environment variables are evidence or compatibility configuration, not authority. Update release-line wording without weakening the contract. |
| LexSona persistence socket | [`docs/BEHAVIORAL_STORE.md`](../BEHAVIORAL_STORE.md) | This owns scoped behavioral read/write views, immutable revisions, evidence, receipts, and rollback boundaries. Other LexSona prose should link here rather than describe database access independently. |
| PostgreSQL authority and isolation | [`docs/POSTGRES_AUTHORITY.md`](../POSTGRES_AUTHORITY.md) and [`docs/POSTGRES_SCOPE_SECURITY.md`](../POSTGRES_SCOPE_SECURITY.md) | These separate administrative composition, runtime credentials, forced RLS, and scope. Keep deployment and recovery details here. |
| Compatibility environment variables | [`docs/ENVIRONMENT.md`](../ENVIRONMENT.md) | This is the complete variable reference, including `LEX_STORE`, `LEX_DATABASE_URL`, and `LEX_POSTGRES_PASSWORD`. Host-specific guides should link here and document whether the host passes inherited variables. |
| MCP client configuration and migration | [`docs/MCP_CONFIG.md`](../MCP_CONFIG.md) | This owns the canonical `@smartergpt/lex-mcp` command, store selection, and `LEX_MCP_LEGACY_ENTRYPOINT_REMOVED` recovery. Add explicit secret pass-through examples for hosts that filter child environments; never embed a real password. |
| CLI output and public errors | [`docs/CLI_OUTPUT.md`](../CLI_OUTPUT.md), [`docs/AX_ERROR_CODES.md`](../AX_ERROR_CODES.md), and their exported schemas/code catalogs | Retain only codes and shapes that are present in the current public CLI/MCP surface. HTTP-only error documentation is not allowed to redefine this surface. |
| Security boundary | [`SECURITY.md`](../../SECURITY.md) | This correctly says stdio MCP trusts its launcher, the historical HTTP server is unsupported, compatibility environment variables are not authorization, and Frames are untrusted history. Change the supported line from 3.x to 4.x. |
| Contributor and build workflow | [`CONTRIBUTING.md`](../../CONTRIBUTING.md) and [`canon/README.md`](../../canon/README.md) | These own checkout-only `src/`/`dist/` guidance and canon build flow. Consumer docs must not copy contributor-only paths. |

The executable artifacts remain higher authority than these owner documents. In particular, the
package export map decides public import paths and MCP `tools/list` decides advertised tool names.

## Link-only or derived layer

These documents are useful entry points, but they should not independently own version numbers,
complete export inventories, full environment tables, MCP tool inventories, or release
procedures.

| Document | Target role |
| --- | --- |
| [`README.md`](../../README.md) | Product orientation and navigation. Keep one current package/version statement and link to the release, API, environment, security, and migration owners. |
| [`QUICK_START.md`](../../QUICK_START.md) | Disposable SQLite value proof. Keep its safe baseline/rollback workflow; derive the Node floor and package name from owner contracts. |
| [`README.mcp.md`](../../README.mcp.md) | Short MCP decision and setup page. Keep one canonical launcher example and link to `docs/MCP_CONFIG.md` for host/environment details. |
| [`docs/CONTRACT_SURFACE.md`](../CONTRACT_SURFACE.md) | Contract map and orientation. It already says validators, schemas, exports, and tests are normative; remove release-line duplication and point to the owners above. |
| [`docs/STORE_CONTRACTS.md`](../STORE_CONTRACTS.md) | Human overview of the store contract. Link exact semantics and versions to `src/memory/store/CONTRACT.md`. |
| [`docs/FAQ.md`](../FAQ.md) and [`docs/LIMITATIONS.md`](../LIMITATIONS.md) | User-facing consequences of owner contracts. Avoid maintaining independent version or deployment policy. |
| [`docs/API_USAGE.md`](../API_USAGE.md) | Repository-policy adoption guide, not package API authority despite the filename. Link its TypeScript imports to `docs/PUBLIC_API.md`. |
| [`docs/AGENT_CONTINUITY.md`](../AGENT_CONTINUITY.md) | Workflow guidance derived from CLI behavior, Frame contracts, and the hard read-only boundary. |
| [`docs/INSTRUCTIONS.md`](../INSTRUCTIONS.md) | Instructions workflow derived from the CLI/config contract. |
| [`docs/WSL_NATIVE_INSTALL.md`](../WSL_NATIVE_INSTALL.md) | Platform guide. Distinguish packaged installation from checkout-only symlink/build instructions and link to the Node migration owner. |
| [`docs/LEX3_POSTGRES_DOGFOOD.md`](../LEX3_POSTGRES_DOGFOOD.md) | Named acceptance canary. Preserve the Lex 3 origin of the canary while stating whether the same gate remains required for Lex 4. |

## Historical material: preserve facts

Historical documents are evidence, not current instructions. Do not bulk-replace package names,
runtime floors, tool names, version numbers, or release states inside them.

| Material | Treatment |
| --- | --- |
| [`CHANGELOG.md`](../../CHANGELOG.md) | Preserve published release facts verbatim. Add new Lex 4 notes; do not rewrite old entries to current terminology. |
| [`docs/releases/v0.3.0-release-notes.md`](./v0.3.0-release-notes.md) and other versioned release notes | Preserve the package, tag, commit, and behavior described at that release. Add a historical banner only if the file can be mistaken for a current procedure. |
| [`docs/adr`](../adr) | Preserve decisions as accepted, rejected, or superseded records. Add status/supersession links; do not silently rewrite the original decision to match current behavior. |
| [`docs/1.0.0-vertical-slice.md`](../1.0.0-vertical-slice.md) | Keep its existing historical banner and current-contract links. Its original ULID/lifecycle plan is not a current Frame contract. |
| [`docs/specs/lex-2.0.0-project-plan.md`](../specs/lex-2.0.0-project-plan.md) and other version-named plans | Preserve as planning evidence, but move under a historical/legacy location or add an unmistakable completed/superseded banner. |
| [`docs/dev/LEX-1.0.0-WORK-LOG.md`](../dev/LEX-1.0.0-WORK-LOG.md) | Preserve as a work log, never as current setup or architecture guidance. |
| [`docs/DX-003-implementation-summary.md`](../DX-003-implementation-summary.md) | Preserve the implementation receipt, but do not let its schema/migration claims override the current store contract. |
| [`docs/DOCUMENTATION_AUDIT.md`](../DOCUMENTATION_AUDIT.md) | Its 2024-12-28, version-2.1.0 audit is an immutable audit receipt. Relocate or banner it; the “verified accurate” tables are not current certification. |

## Stale rewrite candidates

### Release-blocking

| Path | Evidence | Required rewrite |
| --- | --- | --- |
| [`RELEASE.md`](../../RELEASE.md) | Uses package `lex`, imports undeclared `lex/*` paths, describes exports that do not match `package.json`, reports “currently 3.0.0,” and embeds a one-time v0.x catch-up procedure. | Replace with a short Lex package release checklist that delegates cross-repository order/recovery to `docs/releases/ecosystem-3.1.md`, uses `@smartergpt/lex`, binds npm publication to reviewed Trusted Publishing, and contains no completed catch-up campaign. |
| [`SECURITY.md`](../../SECURITY.md) | Says security fixes target current `3.x`, while the candidate package is 4.0.0. | Change only the supported release-line statement and verify every linked boundary still applies. |
| [`README.md`](../../README.md) | Declares current version 4.0.0 but immediately says “Lex 3 adds” the active runtime model. | Describe Lex 4 as the current package while preserving links to the Lex 3 canary as historical gate provenance. |
| [`docs/MCP_CONFIG.md`](../MCP_CONFIG.md) | Correctly names the canonical wrapper and separate PostgreSQL password, but does not explain hosts that filter inherited variables. A launcher can therefore reach the correct PostgreSQL port with an absent password. | Add host-neutral guidance: preserve existing `LEX_*` values, explicitly pass `LEX_POSTGRES_PASSWORD` through the host’s secret/environment allowlist, verify with redacted introspection, and restart the MCP host. Keep the legacy-entrypoint failure code and recovery command. |
| [`src/memory/mcp_server/README.md`](../../src/memory/mcp_server/README.md) | Opens with a v2.1 notice promising alias removal in v3.0, documents tools as `lex.remember`/`lex.recall`, presents the internal HTTP API as a supported peer, contains undeclared `lex/memory/*` consumer imports, and later documents the fail-closed legacy launcher. | Rewrite as maintainer internals. Generate or link the canonical fourteen-tool list, describe aliases only as runtime compatibility, link consumer setup to `README.mcp.md`, and mark HTTP code as internal/unsupported consistently with `SECURITY.md`. |
| [`docs/dev/sqlite-bindings.md`](../dev/sqlite-bindings.md) | Tells operators to delete `.smartergpt/lex/lex.db` when tests fail; the current default is `memory.db`, and deletion is an unsafe first diagnostic for a durable store. | Remove delete-first database advice. Require introspection of the selected store, an exact path, recoverable backup/quarantine, and validation against a disposable database before any operator-approved removal. |
| [`docs/PUBLIC_API.md`](../PUBLIC_API.md), [`docs/CONTRACT_SURFACE.md`](../CONTRACT_SURFACE.md), [`src/memory/store/CONTRACT.md`](../../src/memory/store/CONTRACT.md), and [`docs/RUNTIME_SCOPE_CONTRACT.md`](../RUNTIME_SCOPE_CONTRACT.md) | The contracts are current but headings/prose call the active boundary Lex 3 or Lex 3.0. | Update release-line framing to Lex 4 without changing independent schema/contract version constants or implying that Lex 3 artifacts changed. |

### High-priority consumer correctness

| Path | Evidence | Required rewrite |
| --- | --- | --- |
| [`docs/NAMING_CONVENTIONS.md`](../NAMING_CONVENTIONS.md) | Labels itself the canonical source but examples lead with `remember`, its category table describes a different naming pattern, and it says old MCP names are maintained without deriving the canonical list from the server. | Make `resource_action` names match MCP `tools/list`; keep VS Code display-prefix guidance; move aliases to a bounded compatibility table generated or checked against runtime mappings. |
| [`docs/OVERVIEW.md`](../OVERVIEW.md) | Shows unscoped `lex/...` imports and wildcard export families that do not exist in the current export map. | Remove the package-structure copy or replace it with a link to `docs/PUBLIC_API.md`; keep only product-level explanation that remains accurate. |
| [`TROUBLESHOOTING.md`](../../TROUBLESHOOTING.md) | Contains `lex/types`, `lex/policy/check`, `lex/memory/store`, `lex/shared/types`, and direct `node dist/...` advice in a consumer-facing guide. It also duplicates its “Common Build Issues” heading. | Split consumer problems from contributor build internals. Use only declared `@smartergpt/lex` exports for consumers and label any checkout-only `dist/` command as internal. |
| [`docs/ADOPTION_GUIDE.md`](../ADOPTION_GUIDE.md) | Warns that it is being updated for 1.0.0, centers `/remember` and `/recall`, duplicates Quick Start, MCP setup, policy, Mind Palace, and troubleshooting procedures, and shows a hard-coded old `/srv/lex-brain` database path later in the file. | Reduce it to a staged link map or rewrite from current owners. Prefer CLI `lex remember`/`lex recall` and canonical MCP `frame_create`/`frame_search`; remove host-specific absolute paths. |
| [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) | Its package analysis and dated 0.5/0.6/0.7 roadmap describe PostgreSQL and modularization as future work even though current contracts and exports implement those surfaces. | Preserve durable design rationale; relocate dated roadmap/package-size snapshots to history; link current architecture to contract owners. |
| [`docs/AUTH.md`](../AUTH.md) and [`docs/API_ERRORS.md`](../API_ERRORS.md) | Present the internal HTTP/OAuth surface as a supported deployment and use undeclared `@smartergpt/lex/memory/*` imports, while `SECURITY.md` says the historical HTTP server is not a supported public surface. | Move to internal historical documentation or delete after retaining any still-used maintainer notes. Do not advertise these as Lex 4 consumer APIs. |
| [`SECURITY_POLICY.md`](../../SECURITY_POLICY.md) | Contains transition-era `@guffawaffle/*` imports, an unresolved “when Epic #196 complete” state, and LexRunner merge-weave ownership material that belongs with Runner governance. | Extract any still-enforced Lex asset-ownership invariant into current security/contributor docs, link to actual gates, and move the incident-era cross-repository playbook to history. |

### Lower-priority technical narratives

| Path | Evidence | Required treatment |
| --- | --- | --- |
| [`docs/RECALL_QUALITY.md`](../RECALL_QUALITY.md) | Maintains a prose copy of ranking fields, modes, performance figures, and future plans. | Revalidate claims against current search tests and backend differences; move volatile measurements to benchmark receipts. |
| [`docs/MIND_PALACE.md`](../MIND_PALACE.md), [`docs/ARCHITECTURE_LOOP.md`](../ARCHITECTURE_LOOP.md), and [`RECEIPTS.md`](../../RECEIPTS.md) | Repeat the same Add User/TICKET-123 story and `/remember`/`/recall` workflow across hundreds of lines. | Select one product narrative, update its terminology, and delete or reduce the others to links after preserving unique contract content. |
| [`docs/CANON_ARCHITECTURE.md`](../CANON_ARCHITECTURE.md) | Duplicates `canon/README.md`, begins with `f#`, and includes a broad `rm -rf prompts schemas` cleanup command. | Merge any unique current invariant into `canon/README.md`, then delete this duplicate. Generated-directory cleanup should be performed by a bounded script or exact validated targets. |
| [`LINT_BUDGET.md`](../../LINT_BUDGET.md) and [`docs/dev/type-and-lint-status.md`](../dev/type-and-lint-status.md) | Embed v0.3.0 and 2025-11-22 warning counts that are not live status. | Keep command doctrine near the scripts; move point-in-time counts to historical receipts or delete them after confirming no unique decision is lost. |
| [`docs/PERFORMANCE.md`](../PERFORMANCE.md) | Mixes point-in-time benchmark results, current advice, and direct checkout `dist/` profiling. | Separate reproducible benchmark methodology from dated results; label `dist/` profiling as contributor-only. |

## Move-to-legacy candidates

Relocation is appropriate when a document retains decision or incident value but should disappear
from current navigation and search results:

- `docs/DOCUMENTATION_AUDIT.md`;
- `docs/dev/type-and-lint-status.md`;
- `docs/DX-003-implementation-summary.md`;
- completed version plans under `docs/specs/`, including
  `docs/specs/lex-2.0.0-project-plan.md`;
- `docs/releases/CATCH_UP_GUIDE.md`, after verifying its one-time v0.x action is complete;
- `SECURITY_POLICY.md`, after extracting any still-enforced ownership rule;
- `CONFLICT_RESOLUTION.md`, whose merge-weave and LexRunner workflow belongs with Runner
  methodology rather than the Lex public contract;
- `docs/AUTH.md` and `docs/API_ERRORS.md`, if the internal HTTP implementation remains for source
  compatibility but is not restored as a supported package surface.

Use a consistent `docs/legacy/` taxonomy and a banner that links to the current owner. A move must
preserve Git history and must not change the historical claims inside the document.

## Deletion candidates

Deletion is allowed only after a reviewer confirms that unique current content has an owner and
unique historical evidence remains reachable through Git history or an intentionally retained
legacy document.

| Candidate | Delete when |
| --- | --- |
| [`docs/releases/CATCH_UP_GUIDE.md`](./CATCH_UP_GUIDE.md) | The v0.3.0 GitHub release state is independently verified and no action remains. Keep `v0.3.0-release-notes.md` as the immutable release record. |
| [`docs/CANON_ARCHITECTURE.md`](../CANON_ARCHITECTURE.md) | Any unique current build invariant is merged into `canon/README.md`; do not retain the duplicate cleanup procedure. |
| Redundant portions of [`docs/MIND_PALACE.md`](../MIND_PALACE.md), [`docs/ARCHITECTURE_LOOP.md`](../ARCHITECTURE_LOOP.md), [`RECEIPTS.md`](../../RECEIPTS.md), and [`docs/ADOPTION_GUIDE.md`](../ADOPTION_GUIDE.md) | One maintained narrative and the normative Frame/store/tool documents cover every unique current claim. Prefer deleting whole duplicates over leaving multiple partial tutorials. |
| Point-in-time status reports such as [`LINT_BUDGET.md`](../../LINT_BUDGET.md) and [`docs/dev/type-and-lint-status.md`](../dev/type-and-lint-status.md) | Live scripts and baselines own the current state, and any useful dated result is retained as a historical receipt. |
| Unsupported HTTP consumer guides [`docs/AUTH.md`](../AUTH.md) and [`docs/API_ERRORS.md`](../API_ERRORS.md) | No declared export or supported deployment links to them, and maintainer-only information has been retained next to the internal source or in legacy history. |

No deletion wave may remove `CHANGELOG.md`, a published release note, a signed-tag fact, an ADR
decision record, or the migration/recovery guidance needed to leave a supported release.

## Execution waves

### Wave 0 — Freeze ownership and measure

1. Approve the owner and derived-document tables in this inventory.
2. Capture the current documentation validation result and broken-link inventory.
3. Generate current package exports, CLI help, MCP `tools/list`, environment keys, Node floor, and
   release-manifest values from code.
4. Record which current documents are reachable from `README.md` and which are orphaned.

### Wave 1 — Repair release and recovery truth

1. Rewrite `RELEASE.md` around manual publication and the Ecosystem 3.1 owner.
2. Update current release-line wording from Lex 3.x to Lex 4.0 in owner/entry documents.
3. Complete the Node 24, package-name, MCP launcher, PostgreSQL secret-pass-through, and
   legacy-entrypoint recovery guidance.
4. Remove destructive database deletion advice and replace it with inspect, identify, back up or
   quarantine, validate, and only then perform an exact operator-approved mutation.

This wave blocks publication.

### Wave 2 — Repair consumer paths

1. Replace undeclared `lex/*`, source, and `dist/` consumer imports with declared
   `@smartergpt/lex` exports.
2. Make the canonical MCP tool list match runtime discovery; describe aliases only in one
   compatibility section.
3. Reduce README, Quick Start, MCP README, FAQ, limitations, and platform guides to their assigned
   roles.
4. Execute every retained install, import, CLI, MCP, and recovery example in an isolated consumer.

### Wave 3 — Separate current from historical

1. Add status/supersession banners to historical plans, ADRs, audits, and implementation reports.
2. Move approved legacy candidates without editing their historical claims.
3. Extract any unique current invariant before moving a mixed current/historical document.
4. Remove moved documents from current navigation and point old entry paths to the correct owner
   when a redirect or short tombstone provides useful recovery.

### Wave 4 — Delete duplicates and seal gates

1. Delete approved duplicate/orphan documents.
2. Add executable drift checks for owner claims that are currently prose-only.
3. Run package, documentation, release-manifest, clean-consumer, and link gates.
4. Review the final tree as a new human/agent arriving from Lex 3.0.1, not as an author who already
   knows the migration.

## Invariant checks

The cleanup must prove all of the following:

- `package.json`, the lock root, README current version, changelog candidate, server manifest, and
  Ecosystem 3.1 manifest agree on the reviewed Lex 4.0 identity.
- Current runtime guidance says Node 24 or newer without an unproven upper ceiling. Statements
  about Node 20/22 or `>=20 <25` occur only in explicitly historical or migration context.
- Consumer imports use `@smartergpt/lex` and a declared export. Source and `dist/` paths appear only
  in clearly labeled contributor/internal build material or historical evidence.
- MCP launch examples use `@smartergpt/lex-mcp`; the removed source transport and shell launcher
  appear only in fail-closed migration guidance and historical evidence.
- MCP tool inventories advertise the canonical fifteen names returned by `tools/list`. Any
  accepted deprecated aliases are described as compatibility inputs, not preferred discoverable
  tools.
- PostgreSQL examples select the intended endpoint, keep credentials out of tracked files, explain
  child-process environment pass-through, and verify redacted store identity after restart.
- No current troubleshooting guide recommends deleting, dropping, or replacing an existing
  database as an initial diagnostic. Any destructive recovery names an exact target, requires a
  backup or quarantine path, and distinguishes disposable test data from user/project data.
- Only one current document owns each release, import, environment, MCP, store, and security
  procedure; derived pages link to it.
- Historical release facts retain their original version, tag, package name, runtime claim, and
  outcome even when the current product differs.

Run at minimum:

```bash
npm run validate-docs
npm run validate-schemas
npm run check:node-runtime
npm run check:public-api
npm run check:ecosystem-release
npm run guard:pack
npm run test:smoke
```

Also run an internal-link check and focused executable examples for every changed command/import
surface. The final release gate remains the repository's exhaustive release suite; touched and
adjacent checks are the iteration path, not a substitute for release evidence.

## Acceptance

The documentation recalibration is complete when:

1. A human or agent can identify the Ecosystem 3.1 train, the Lex 4.0 package version, the Node 24
   floor, and the exact public package names from one release entry point.
2. The Lex 3.0.1-to-4.0 migration has one copyable happy path and a failure matrix covering engine
   mismatch, native SQLite ABI mismatch, removed MCP entrypoint, filtered PostgreSQL password,
   wrong workspace/store identity, partial npm/tag/registry publication, and safe rollback or
   forward recovery.
3. Release instructions make authenticated npm publication, signed tag creation/push, and
   protected registry approval explicit human checkpoints.
4. Copying a current install, import, CLI, MCP, or configuration example does not rely on a source
   checkout, undeclared export, old package scope, old Node line, or deprecated transport.
5. Database recovery is conservative by construction and cannot be read as permission to discover,
   mutate, or delete an existing project/user store merely to make a test pass.
6. Current navigation contains no document that claims superseded plans or point-in-time audits
   are current certification.
7. Immutable historical release facts remain unchanged and clearly distinguishable from current
   instructions.
8. All invariant checks pass from a clean checkout, and the release manifest records the resulting
   documentation gate evidence before the train is sealed.
