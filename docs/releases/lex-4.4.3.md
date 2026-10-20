# Lex 4.4.3

This patch corrects destination provenance for trusted scope-bound Frame stores. It does not change stored Frame schemas or tenant/workspace enforcement and needs no database migration.

An injected PostgreSQL Pool without verified host evidence now reports an explicit unknown backend plus a per-instance diagnostic reference. The old placeholder-derived identity was identical for unrelated injected Pools using the same schema and must not be used as destination proof. Trusted hosts can explicitly supply a secret-free verified backend fingerprint; the selected schema also participates in the destination identity.

The new `lex destination --json` command and fifteenth canonical MCP tool, `destination_inspect`, return an authorized workspace destination snapshot without reading Frame history, probing store health, or writing Frames. They request the intended `remember` / `frame_create` capabilities. Optional `--expected-destination` and `expected_destination` restrictions reject a mismatched or unverified destination before writes, and CLI/MCP save receipts report the same destination shape. The restriction grants no authority or persistent consent.

Destination identity binds backend, schema, roots, binding, tenant/workspace, repository, principal, capabilities and authority revisions. MCP checks before cached success and isolates idempotency responses by destination. Authoritative backend/grant verification occurs at operation entry; expiry and expected binding are checked again before save. This is not transaction-coupled backend or revocation revalidation. Read the [destination contract](../DESTINATION_PROVENANCE.md) before treating a receipt as evidence.

Existing consumers need no API migration. Compatibility hosts can keep their existing workflow but cannot supply trusted workspace destination proof. `remember --dry-run` remains read-only and cannot be combined with expected write-destination binding. Module scope, frame permissions, caller provenance and environment variables never supply this verification.

Publish the exact Lex 4.4.3 artifact first, then its matching Lex-MCP 4.4.3 wrapper, before signed release tags and Registry publication. Retain the existing qualified 4.4.2 package pair and installed-runtime lock for recovery. Package publication does not install or activate a new scoped runtime; host/AXF deployment and actual consumer qualification remain separate. See the [4.4 migration and recovery guide](lex-4.4-migration.md).

The regression suite covers two backend fingerprints, unknown Pools, separate schemas/workspaces, real CLI/MCP capability alignment, zero Frame access in preflight, receipt parity, binding drift, payload spoofing, idempotency boundaries and request-local cleanup. Native Windows packed-consumer and protected publication receipts must qualify the exact release artifact. This document describes the candidate and is not evidence that publication or runtime activation occurred.
