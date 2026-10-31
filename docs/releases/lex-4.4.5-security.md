# Lex 4.4.5 security patch plan

Status: unreleased 4.4.5 source candidate. Focused matcher and containment checks
passed before preparing the coordinated candidate metadata; full release acceptance
remains pending.
No publication, installed-runtime update, or Windows helper qualification is claimed.

## SemVer decision and migration

Propose a patch release, 4.4.5, because this change repairs vulnerable dependency
ranges while retaining Lex's public APIs, data formats, policy authority and store
schema. It does not introduce a store migration. Node.js remains >=24 and
better-sqlite3-multiple-ciphers remains exactly 13.0.3. Existing SQLite backup,
recovery and native-binding qualification requirements remain in force.

Use glob ^14.0.3 and minimatch ^11.0.3. These dependency majors replace matching
internals; Lex uses their retained named glob/minimatch functions, not removed AST
or regular-expression internals. Windows separators, dot files, ignore patterns,
repository containment and policy matching must pass focused checks before a
release claim. A discovered public behavior break requires reconsidering this
SemVer decision rather than silently changing a policy boundary.

Raise the direct Zod floor to ^4.6.6 and refresh body-parser to 2.4.0 and qs to
6.16.1 through Express's existing compatible ranges. Refresh follow-redirects to
1.16.2 through Axios's existing range. Express remains on major 5. The source-only
lock refresh is not a universal guarantee for consumer locks. HTTP/security and
configuration validation checks must cover these adjacent updates.

## Security scope and consumer recovery

The targeted advisories are GHSA-3g3m-2fjr-6pw4 (glob cancellation),
GHSA-g3hv-75wg-m249 (minimatch pattern amplification), and
GHSA-mrwp-f3q8-3g9p (follow-redirects cross-realm sensitive header configuration).
Additional current findings are GHSA-27r3-jxmh-p828 (compressed request parsing),
GHSA-6pq8-jhm2-2vcw (qs comma-format serialization), and
GHSA-mrhx-c7xc-m3w5 (Zod collection validation). Their presence in a dependency tree
is not proof of exploitation in Lex.

After an independently reviewed package is actually published, fresh consumers
can install that public version and verify the resolved dependency tree and
production audit. Existing consumers must update Lex and their direct vulnerable
matcher ranges, deliberately refresh their lock's follow-redirects resolution to
1.16.2, body-parser to 2.4.0 and qs to 6.16.1 (or reviewed later fixes), then rerun
audit and application qualification. Update any direct Zod dependency to the fixed
floor too. Existing Express/Axios ranges permit older vulnerable transitive
versions; this release does not manufacture stronger upstream minimums.
Lex's package-lock is not imposed on dependents, and root-only npm overrides are
not a published dependency fix. Do not discard a consumer lock or use audit --force
as a substitute for a reviewed update. Retain the prior qualified lock/runtime for
rollback; restore backups if independent application work changed a store.

## Remaining release gates

Align the actual metadata owners,
prepare the paired Lex-MCP candidate without local file dependencies, then retain
exact-source build, full tests, validators, pack checks, normal and ignore-scripts
consumer evidence. Require independent exact-head review and required CI. Publish
only through the protected release workflow at its reviewed current-main source;
no local npm publish, tag, activation, or helper installation is authorized by
this source preparation. Held Runner and LexSona release PRs remain separate.
