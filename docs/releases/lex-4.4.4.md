# Lex 4.4.4

This forward patch corrects Windows root comparison in trusted workspace destination snapshots. It changes no Frame schema, database format, cipher or key derivation and needs no store migration.

## Windows destination correction

Lex 4.4.3 compared registry and discovered roots as raw strings. On Windows, the registry could hold a lowercase root while discovery retained the path's case. The strings then disagreed even though they named the same path, so destination inspection and guarded saves rejected an active binding.

Lex 4.4.4 uses trusted captured execution-surface evidence for lexical root comparison and stable root identity. Trusted CLI/MCP bootstrap supplies that evidence; library hosts can supply the optional fourth `createDestinationSnapshot` argument. Existing three-argument callers remain supported and retain conservative raw root equality. Frame/MCP request payloads and ambient environment variables do not supply destination authority.

Equivalent Windows lexical path spelling and case normalize consistently. Different roots remain different, and POSIX roots remain case-sensitive. This does not prove physical path identity, resolve symlinks or equate different UNC aliases. Hosts must not reconstruct trusted execution-surface evidence from Frame content or caller-supplied destination fields.

Tenant, workspace, repository, principal, backend, binding, capability and authority checks remain in force. Expected-destination restrictions still reject drift before writing. Unverified backend evidence remains unverified; Windows path normalization does not upgrade it. See the [destination provenance contract](../DESTINATION_PROVENANCE.md).

## Upgrade and recovery

Publish the exact Lex 4.4.4 artifact, then the matching Lex-MCP 4.4.4 wrapper, before signed release tags and Registry publication. Verify the exact retained bytes and provenance. The public 4.4.3 artifact and its [release notes](lex-4.4.3.md) remain immutable; do not replace, republish or retag that version to repair the Windows failure.

Canonical Windows root identity can change an expected-destination hash captured with an earlier version. Inspect the destination again and reconcile its roots, backend, tenant, workspace and binding before recording a fresh expected binding. Do not silently rebind or retry a rejected write. Preserve existing stores, credentials, bindings and backups.

Keep each host's last qualified runtime and exact installed lock recoverable until the new exact pair passes native Windows destination preflight, save and read-back on that host. Package publication and packed-consumer success do not install or qualify the active scoped runtime. The [4.4 migration and recovery guide](lex-4.4-migration.md) owns the operator recovery steps.

Node remains >=24. SQLite remains pinned to 13.0.3 with the same bundled Node-API, native-platform and normal/lifecycle-disabled install boundaries described in the [4.4.3 notes](lex-4.4.3.md) and [native support guide](../dev/sqlite-bindings.md). This patch does not refresh dependencies or change those claims.

## Qualification boundary

The release candidate must cover equivalent Windows roots, genuinely different roots, POSIX case distinctions, trusted CLI/MCP bootstrap plumbing and unchanged expected-destination rejection. Complete normal release, packed-consumer and exact native Windows host gates before claiming acceptance. This document describes candidate behavior; it is not evidence of publication, runtime activation or completed Windows host qualification.


The normal and lifecycle-disabled packed-consumer gates now exercise declared public entrypoints through real native filesystem discovery, an in-memory SQLite binding registry, synthetic canonical authority, and CLI/MCP destination preflight and guarded memory writes. Preflight performs no Frame reads or mutations; a mismatched expected destination performs neither. This bounded proof complements exact installed-host qualification rather than replacing it.

Registry live verification now reads the exact version-indexed entry with a bounded request timeout and retains strict active/latest, server, package, version and stdio checks. The workflow retains its existing finite retry budget. Exact version visibility is not a claim that the separate search index has propagated; no publication authority changes.
