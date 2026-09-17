# Lex package release checklist

This is the release checklist for `@smartergpt/lex`. The current coordinated release is
**Lex 4.3.0 in the Ecosystem 3.1 train**.

Use these documents as the release authority:

- [Ecosystem 3.1 release SOP](docs/releases/ecosystem-3.1.md) for dependency order, evidence,
  partial-publication recovery, signed refs, and manifest sealing;
- [Lex 4.2 migration and recovery guide](docs/releases/lex-4.2-migration.md) for the existing
  Node 24 floor, consumer migration, MCP transport migration, and rollback boundaries;
- [documentation inventory](docs/releases/ecosystem-3.1-documentation-inventory.md) for current
  documentation owners and bounded follow-up cleanup.

The machine-readable release record is
[`releases/ecosystem-3.1.json`](releases/ecosystem-3.1.json). Do not infer an ecosystem component's
package version from the train name.

## Authority and human checkpoints

Agents may prepare and verify a candidate, create a tarball, run dry-run publication checks, and
verify public metadata. A human maintainer performs signed annotated tag creation and push plus any
protected GitHub environment and MCP Registry approvals. Non-dry-run npm publication is performed
only by an explicitly selected, protected-environment dispatch of the reviewed workflow from the
exact current `main` commit through npm Trusted Publishing. No long-lived npm write token is
accepted.

The Lex tag is `v<version>`. Do not push a tag before both exact npm packages required by Lex's
Registry workflow are public.

Lex and Lex-MCP 4.0.0 are already public, but their corresponding signed tags and GitHub releases
were not completed. Lex 4.0.1 is an immutable former core-only publication at integrity
`sha512-4IcwHGJg0yOstrpa60iUv01Mj00LcKYjfA6bgD0DJuAYSc7ZBObjP2dRyP/MxlijNKFHDYRuaevks+5dDW1HuA==`;
there is no matching public Lex-MCP 4.0.1, signed release, or sealed ecosystem record. Do not create
late 4.0.0/4.0.1 tags, republish either version, or treat either incomplete public state as evidence
for this candidate. The 3.0.1 values retained in the sealed Ecosystem manifest are the last sealed
ecosystem baseline, not the current npm registry state.

Lex and Lex-MCP 4.0.2 have valid public npm artifacts and valid signed immutable tags. Lex-MCP also
has a GitHub release. Lex 4.0.2 does not have a GitHub release or MCP Registry entry: its tag run
exposed an already-public dry-run defect and a 109-character Registry description that exceeded the
schema's 100-character limit. Do not rewrite either tag or publish corrected 4.0.2 metadata from a
different commit. Version 4.0.3 supersedes that partial state with schema-bound validation and an
exact-integrity recovery path.

Lex and Lex-MCP 4.0.3 are public as an exact pair with signed immutable tags, non-draft GitHub
releases, and the Lex MCP Registry entry. Version 4.0.4 is the reviewed forward patch for exact
hyphenated and compound reference-point recall on PostgreSQL; it must preserve the established
SQLite behavior and scoped tenant/workspace containment.

## Candidate identity

Version 4.3.0 includes the already-merged non-authorizing policy-shadow projections,
explicit operation-absence support, the radius-zero recall correction, and the MCP
lifecycle/portable qualification fixes in PR #855. These additive library capabilities
require a minor version. See [4.3 release notes](docs/releases/lex-4.3.md) and the
[migration guide](docs/releases/lex-4.3-migration.md). The public 4.2.0 package pair
remains the operational baseline until the exact 4.3.0 pair is verified. This release
does not activate a policy host, alter protected authority, or install a new scoped runtime.

For Lex 4.3.0, these values must agree:

- `package.json` and the package-lock root: `@smartergpt/lex@4.3.0`;
- `server.json`: `dev.smartergpt/lex@4.3.0`, transporting
  `@smartergpt/lex-mcp@4.3.0`;
- Ecosystem 3.1 manifest Lex and Lex-MCP targets: `4.3.0`;
- README and changelog current release: `4.3.0`;
- Node engine: exactly `>=24`, with no speculative upper bound.

Run:

```bash
npm run check:node-runtime
npm run check:ecosystem-release
npm run check:mcp-registry-contract
npm run validate-docs
```

`npm run check:release-drift` is a post-tag audit. It is expected to report the missing `v4.3.0`
tag while an untagged candidate is under review.

## Candidate gates

Use touched and adjacent gates during implementation. Run the exhaustive gate once on the final,
clean candidate:

```bash
npm ci --ignore-scripts
npm rebuild better-sqlite3-multiple-ciphers
npm run check-sqlite
npm run validate-schemas
npm run validate-docs
npm run check:node-runtime
npm run check:ecosystem-release
npm run check:mcp-registry-contract
npm run ci:full
npm run release:candidate
```

`ci:full` already includes the build, public API check, tests, and an exploratory pack guard.
`release:candidate` then creates one retained tarball from the clean exact commit, validates that
same file with the pack guard and clean-consumer smoke test, dry-runs publication of that file, and
writes `release-candidate.json` with the commit, npm integrity, SHA-1, SHA-256, size, commands,
durations, exit codes, and bounded output. Its `artifactStatus: verified` covers artifact gates only;
`acceptanceStatus: external-required` remains until the PR links the native Windows, MCP,
PostgreSQL, and other exact-SHA evidence listed below. Preserve the tarball, receipt, and GitHub
attestation bundle together. The clean-consumer proof must install the retained tarball without a
workspace link or `file:` directory dependency.

Before publication, also require:

- native Windows Node 24 packed-consumer proof;
- ESM exports and CommonJS dynamic `import()` proof;
- CLI version/help;
- MCP initialization, notification silence, and the canonical fourteen-tool inventory;
- disposable SQLite create/write/read;
- isolated PostgreSQL credential-pass-through proof that never queries or mutates an existing
  project or user database.

Stop at the first failing gate and record what was not run.

## Review and candidate receipt

The release PR must contain:

- the SemVer decision and Ecosystem 3.1 relationship;
- exact candidate commit;
- gate results and artifact integrity;
- migration/recovery documentation;
- any known warning that does not change acceptance;
- downstream proof links; and
- an explicit statement that nothing was published or tagged.

The worktree must be clean before recording the final commit. Review changes to package identity,
the lockfile, `server.json`, current docs, workflows, and generated artifacts together.

## Trusted npm publication

The npm package must configure `SmarterGPT/lex`, workflow `release.yml`, and GitHub environment
`npm-release` as its Trusted Publisher. An explicit `publish: true` dispatch validates the exact
current `origin/main` commit, immutable Actions artifact ID/digest, receipt identity, Windows
packed-consumer result, and remote main identity before it exchanges GitHub OIDC for npm
publication authority. A build-only dispatch keeps `publish: false`.

After both npm packages are public, the tag-triggered GitHub release lane additionally verifies the
annotated tag object and embedded name, authorized tag and commit signer fingerprints, current
remote main, exact public npm integrity, and the public Lex-MCP 4.3.0 dependency edge. Release tags
are protected against update and deletion by the active repository tag ruleset. The lane has no npm
publication authority.

The workflow publishes the exact retained `smartergpt-lex-4.3.0.tgz` with provenance. It never
repacks, and recovery continues only when an existing public 4.3.0 integrity exactly equals the
receipt and npm's verified SLSA attestation binds it to this repository, the protected
`release.yml` dispatch, current `main`, and the exact reviewed commit. Different immutable bytes or
missing/mismatched provenance are hard failures requiring a new version and a fresh review.
`npm run release` remains a hard stop so a local agent or maintainer shell cannot bypass the
protected workflow dispatch.

Verify the immutable public artifact:

```powershell
$receipt = Get-Content ./release-candidate.json -Raw | ConvertFrom-Json
$public = npm view @smartergpt/lex@4.3.0 version engines dist.integrity --json |
  ConvertFrom-Json
if ($public.dist.integrity -ne $receipt.artifact.integrity) {
  throw "Published npm integrity does not match the attested candidate"
}
```

Record the matching `sha512-` integrity in the Ecosystem 3.1 manifest. Do not use `latest` or a
successful publish exit code as the sole identity proof.

## Dependent package and tag order

After Lex is public:

1. refresh and verify each dependent lock from public `@smartergpt/lex@4.3.0`;
2. complete the manifest-selected LexSona, LexRunner, AXF, and STFC-Mod proofs;
3. publish exact `@smartergpt/lex-mcp@4.3.0` from its own reviewed checkout;
4. verify both public npm artifacts and their exact dependency edge;
5. create, verify, and push the signed Lex `v4.3.0` tag;
6. create, verify, and push the signed Lex-MCP `v4.3.0` tag;
7. verify both non-draft GitHub releases;
8. approve and verify the protected MCP Registry publication; and
9. rerun native downstream acceptance before sealing the manifest.

The Lex tag comes first because it triggers the protected Registry workflow after both npm packages
exist. On that tag, the GitHub release workflow rebuilds and attests the deterministic candidate,
then fails closed
unless its receipt and tarball still match the immutable public npm `dist.integrity`; it never
creates a release for independently rebuilt or incorrectly published bytes. The Lex-MCP release
workflow then consumes the matching Lex tag.

For each approved repository tag:

```bash
git tag -s "<approved-tag>" -m "Release <approved-tag>"
git tag -v "<approved-tag>"
git push origin "<approved-tag>"
```

Tag creation and push are human-only. The protected `npm-release` environment may also require a
human approval before the OIDC publication job starts.

## Recovery

Never overwrite an npm version or move a published tag.

- If Lex is not published, fix the candidate and rerun its gates.
- If Lex is public but a dependent package is not, keep the verified Lex artifact and repair the
  dependent candidate forward.
- If npm packages are public but a tag or GitHub release failed, retry that immutable publication
  step without republishing npm.
- If Registry publication failed, retry it from the reviewed signed Lex tag after both public
  package contracts pass.
- If published bytes or metadata are wrong, deprecate the affected version when appropriate and
  publish a reviewed patch. Do not unpublish or replace it as routine recovery.

Package release recovery is not permission to initialize, repair, discover, delete, or recreate a
Frame store. Follow the migration guide's store-specific stop conditions and recovery boundaries.
