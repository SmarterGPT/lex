# Ecosystem 3.1 release dependency and publication SOP

Ecosystem 3.1 is a compatibility release train across the Lex toolset. It is not a shared package
version. Each repository selects semver from its own reviewed user-visible delta, while the release
manifest records the exact set proven to work together.

Lex selects package version 4.3.0 for additive non-authorizing policy projections and explicit operation absence. The 4.0 line's Node
20-to-24 support-floor change remains the existing breaking runtime baseline. Lex-MCP
preserves exact major/version alignment with Lex.
Neither package version renames the Ecosystem 3.1 train.

The public 4.0.2 npm pair and signed tags remain valid, but Lex 4.0.2 did not complete its GitHub
release or MCP Registry publication. The coordinated 4.0.3 pair completed npm publication, signed
tags, non-draft GitHub releases, and Lex MCP Registry publication. Version 4.0.4 added the PostgreSQL
compound-reference recall correction. The released 4.1.0 pair added Slice 1A1's experimental policy
contracts. The released 4.2.0 pair combines Slices 1A2 and 1A3. The 4.3.0 candidate adds
projections, explicit absence and lifecycle corrections without rewriting those immutable
releases; see [4.3 release notes](./lex-4.3.md).

The canonical machine-readable draft is [`releases/ecosystem-3.1.json`](../../releases/ecosystem-3.1.json).
Its schema is
[`canon/schemas/ecosystem-release-v1.schema.json`](../../canon/schemas/ecosystem-release-v1.schema.json).
Lex consumers migrate through the
[Lex 4.3 migration and recovery guide](./lex-4.3-migration.md). The
[delete-first documentation inventory](./ecosystem-3.1-documentation-inventory.md) records current
owners, historical boundaries, and bounded follow-up cleanup.

Validate the draft at any time:

```bash
npm run check:ecosystem-release
```

The final release gate additionally requires sealed evidence:

```bash
node scripts/validate-ecosystem-release.mjs --sealed
```

## What “required” means

A component can be required for the release train without becoming a mandatory runtime dependency.

| Component   | Release-train role                                                        | Runtime relationship |
| ----------- | ------------------------------------------------------------------------- | -------------------- |
| Lex         | Memory, authority, scoped storage, and KnowledgeFrame provider semantics  | Required foundation  |
| Lex-MCP     | Exact-version transport for Lex's MCP server and Registry entry           | Requires exact Lex   |
| LexSona     | Deterministic, scoped behavioral constraints                             | Optional             |
| LexRunner   | Attempt lifecycle and immutable constraint-snapshot consumption           | Works with LexSona off or enabled |
| AXF         | Provider-neutral routing, budgeting, fallback, and conformance             | No Lex runtime dependency |
| STFC-Mod    | Real-corpus knowledge-context proof                                       | Source proof only    |

LexSona is therefore required in the *tested compatible set* while remaining optional during an
ordinary LexRunner execution. AXF and STFC-Mod evidence must never be encoded as npm dependencies.

## Product dependency graph

### Knowledge context

```text
Lex #734 KnowledgeFrame_v1
        ↓
AXF #42 off/shadow provider routing
        ↓
STFC-Mod #165 real-corpus shadow pilot
```

### Behavioral constraints

```text
LexSona #126 snapshot contract ─┐
LexSona #128 content audit ─────┼─→ LexSona #127 scoped bindings
Lex #779 authorized store ──────┘              ↓
                                     LexRunner #820 lifecycle binding
                                                ↓
                                      LexSona #125 dogfood gates
```

Lex #775 separately completes the supported operator path for quarantined legacy Frames. The
release cannot describe scoped migration as operationally complete while that preserved data has no
explicit inspect/plan/apply recovery path.

Lex #792 is likewise release-blocking. It owns the package-specific SemVer decision, one canonical
human-and-agent migration and recovery contract, a delete-first audit of current documentation, and
executable documentation gates. The train cannot publish, tag, or seal while that issue remains
unresolved.

## Release-manifest states

The manifest has two top-level states:

- `draft` permits unknown target versions and incomplete evidence. It must still contain the entire
  component set, a valid graph, the Node 24 policy, and an exact Lex-MCP-to-Lex edge.
- `sealed` permits no unresolved component. Every component is `verified`; every required gate is
  `passed`; package versions and integrity, source commits and tags, and evidence links are complete.

Component status progresses monotonically:

```text
baseline or planned → candidate → published → verified
```

`excluded` is not a quiet escape hatch. Changing a required component to excluded requires a
reviewed scope change to the umbrella issue, release notes, schema-valid manifest, and advertised
compatible set.

## Evidence rules

The sealed record uses immutable evidence:

- full commit SHA, never a branch name;
- repository-approved signed annotated tag for every packaged component;
- exact commit plus immutable proof evidence for source-proof components;
- exact npm version and `sha512-` integrity;
- non-draft GitHub release;
- completed CI/release/registry run URL;
- downstream proof issue or immutable artifact tied to a commit;
- no local `file:` dependency, workspace link, mutable `latest` assertion, or unreviewed output.

Normal validator output reports only the state, component count, and edge count. Failures identify
the inconsistent field or edge. Credentials, environment values, database URLs, and secret-bearing
logs do not belong in the manifest or issue receipts.

## Candidate preparation

For each participating repository:

1. inventory CLI, MCP, exports, schemas, storage, configuration, runtime, and documentation changes;
2. write the semver and migration decision before changing package identity;
3. raise active metadata, workflows, and current guidance to Node 24;
4. validate touched and adjacent behavior during implementation;
5. run the repository's exhaustive release gate at the release candidate;
6. pack the candidate and validate a clean consumer without workspace links;
7. merge the reviewed, signed release commit;
8. record its full SHA in the draft manifest.

Full-suite release evidence is mandatory even when implementation uses deterministic touched and
adjacent gates for iteration speed.

## Publication order

The final package sequence follows real dependency direction:

1. Publish Lex.
2. Refresh every dependent lock from the public Lex artifact and verify its integrity.
3. Publish LexSona after its selected Lex contract and packed consumers pass.
4. Publish LexRunner after both its no-LexSona baseline and selected LexSona modes pass.
5. Publish AXF after provider conformance and the STFC shadow proof pass; AXF does not add Lex as a
   runtime dependency.
6. Publish Lex-MCP last with an exact dependency on the published Lex version.
7. Push signed tags and verify GitHub releases.
8. Approve and verify the protected MCP Registry publication for Lex-MCP.
9. Re-run native consumers against public artifacts.
10. Seal the manifest and merge the immutable evidence update.

Publishing order may wait between steps. It must not reverse a dependency edge or use unpublished
local state to manufacture a dependent lock.

## Human-only checkpoints

An agent may prepare commits, run gates, pack artifacts, perform dry runs, and verify public
metadata. The authenticated maintainer creates and pushes signed annotated tags and performs any
protected environment or Registry approvals. Lex non-dry-run npm publication is delegated only to
the reviewed `release.yml` job through npm Trusted Publishing and GitHub OIDC.

For Lex 4.2.0, an explicit `publish: true` dispatch from the exact current `main` builds the
`npm-candidate-<commit>` artifact, verifies its service-record digest and receipt, runs the Windows
packed-consumer gate, and publishes that exact retained file with provenance. Verify both the
tarball and `release-candidate.json` with `gh attestation verify` constrained to
`Guffawaffle/lex/.github/workflows/release.yml` and the reviewed source digest. After Lex-MCP is
public, the signed tag lane deterministically rebuilds and attests the candidate, verifies its
signed receipt, exact public integrity, and the public Lex-MCP dependency edge, and only then
creates the GitHub release. The npm publication and recovery lanes additionally require verified
SLSA provenance bound to the protected `release.yml` dispatch and exact source commit. An active
repository ruleset prevents release-tag update or deletion.

Other repositories must follow their own artifact-bound release checklist. Where that checklist
has not yet defined a retained artifact, the applicable access command remains:

```bash
# Public packages other than Lex
npm publish --access public

# Restricted packages
npm publish --access restricted
```

Use public access for Lex and Lex-MCP. Preserve the reviewed access policy for AXF. Use restricted
access for LexSona and LexRunner unless their release issue explicitly changes that policy.

After npm reports success, verify before continuing:

```bash
npm view <package>@<version> version engines dist.integrity --json
```

For a dependency edge, also query the relevant dependency or peer dependency. Do not rely on the
mutable `latest` tag as the sole proof.

## Signed refs and GitHub releases

Tags are created only after npm exposes the immutable package and the repository release workflow's
preconditions pass. Use the tag format enforced by that repository's workflow. Lex and Lex-MCP use
`v<version>`; LexRunner uses `lexrunner-v<version>`.

The maintainer creates and verifies an annotated signed tag from the exact release commit:

```bash
git tag -s "<approved-tag>" -m "Release <approved-tag>"
git tag -v "<approved-tag>"
git push origin "<approved-tag>"
```

The GitHub release must be non-draft and point through the tag to the recorded commit. A successful
tag push is not by itself a successful release.

## MCP Registry boundary

Only the Lex/Lex-MCP server entry is published as part of this release train. After both exact npm
packages and their GitHub releases exist:

1. approve the protected `mcp-publish` environment for the tag-triggered run;
2. wait for the publisher's live-entry verification;
3. independently run the repository verification script for the exact version;
4. record the completed run and live version evidence in the manifest.

Participation does not automatically authorize AXF, LexSona, or LexRunner MCP Registry entries.

## Partial-publication recovery

Published npm versions and pushed tags are immutable. Recovery advances from observed state; it does
not overwrite history.

| Observed state | Recovery |
| -------------- | -------- |
| Candidate merged, package absent | Re-run gates against the same commit, then ask the maintainer to publish. |
| Package published, tag absent | Verify package integrity and commit identity, then create the signed tag. |
| Tag pushed, GitHub release failed | Re-run or repair the release workflow against the same immutable tag. |
| Lex published, dependent lock stale | Refresh the dependent lock from npm, review/merge that commit, then publish the dependent. |
| Dependent package published with wrong metadata | Stop the train; create a new patch version. Never republish the same version. |
| MCP Registry approval pending | Leave the manifest unsealed and request the protected-environment approval. |
| Registry publication failed | Diagnose/retry the immutable release workflow; do not publish a replacement npm artifact unless metadata is wrong. |
| Native consumer fails | Keep the component below `verified`; fix through a new reviewed package version when published bytes are at fault. |

Every recovery receipt identifies the observed immutable artifact, the missing transition, and why
the next action is safe.

## Sealing the release

The final manifest update occurs after all external systems are already verified. It changes:

- top-level state to `sealed`;
- every component to `verified`;
- package target/published versions and integrity;
- exact source commits and signed tags;
- immutable evidence links;
- every required gate to `passed` with evidence.

Run both validators, review the diff, and merge the signed manifest commit:

```bash
npm run check:ecosystem-release
node scripts/validate-ecosystem-release.mjs --sealed
```

The sealed manifest is a release receipt and compatibility statement. It is not an authority
database, credential vault, runtime orchestrator, or substitute for each repository's own release
contract.
