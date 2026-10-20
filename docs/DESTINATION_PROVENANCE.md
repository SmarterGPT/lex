# Authorized destination inspection and save receipts

Trusted scope-bound hosts can expose a payload-free destination snapshot before capturing a work summary. This describes the configured backend and authorized workspace; it does not grant consent, disable an agent approval reviewer, or prove physical server placement.

## Trusted host composition

The host must verify the live PostgreSQL target before constructing the runtime store. Pass its secret-free fingerprint explicitly:

```ts
const binder = new PostgresScopedFrameStoreBackend(pool, {
  schema: "lex_store",
  verifiedBackend: {
    identity: verifiedLiveTargetIdentity,
    verifiedAt: new Date().toISOString(),
    connectionClass: "loopback",
  },
});
```

`identity` must match `<lowercase-label>:sha256:<64 lowercase hex characters>`. `verifiedAt` must be a canonical UTC ISO timestamp including milliseconds. The host remains responsible for checking that the fingerprint represents the Pool it injects. `connectionClass` describes the configured endpoint (`loopback`, `remote`, or `unknown`); loopback alone says nothing about forwarding or the server's physical location.

Lex reads this evidence only from the trusted constructor. Environment variables, frame permissions, caller provenance, CLI payload, and MCP frame fields cannot supply backend verification. The descriptor is copied and frozen. It is provenance evidence, not an independent authentication mechanism against a malicious embedding host.

An injected Pool without verified evidence reports `backendIdentity.verification: "unverified"` and `identity: null` in its backend evidence. Its legacy store `identity` is a random per-instance diagnostic reference (`postgres-scoped-unverified:...`), rather than the former constant hash of `postgresql://injected-pool#schema=...`. A parsed connection URL is descriptive and also remains unverified. A verified backend identity and a scoped destination identity are separate values.

## Preflight and write

Through the same trusted host and owning checkout:

```sh
lex destination --json
lex remember --json --summary "Completed scoped work" --modules workspace/unscoped --expected-destination "lex-destination-v1:sha256:..."
```

MCP exposes `destination_inspect` with an empty argument object, followed by `frame_create` with optional `expected_destination`. `destination_inspect` rejects frame payload and destination selectors. Its MCP annotations identify a read-only operation; `frame_create` remains a write.

Both preflights authorize the intended `remember` / `frame_create` operation, requesting the same `frame:read` and `frame:write` capabilities. They neither read frame history nor query store health nor write frames. Canonical authorization and local binding inspection can still read their authority/registry metadata. A principal that lacks the intended write capability is denied rather than receiving an asserted write destination.

The `destination` snapshot contains:

- Canonical project root, tenant, workspace, repository and binding references.
- Verified backend evidence and explicit PostgreSQL namespace/schema.
- Principal, attenuated capabilities, grant, authority version/digest and scope version.
- Authorization verification/expiry timestamps and a scoped destination digest.

The digest includes the backend identity, explicit namespace, roots, local binding identities, repository, tenant/workspace, principal, sorted capabilities, grant and authority revisions. Verification timestamps are excluded so independent preflight and write invocations can match. Unknown backend evidence yields a null destination digest, never a fabricated verified destination.

`--expected-destination` / `expected_destination` only restricts an already authorized invocation. Unknown evidence, a different backend/schema/root/binding/workspace/repository/principal/capability/grant/authority revision, or an expired authorization fails before mutation. CLI also checks before its existing history inference reads. MCP checks before returning any idempotency cache success and includes destination identity in its cache namespace.

Save receipts from both CLI and MCP return the same `destination` shape plus compatible `store` and `storeIdentity` fields. The receipt records the destination selected for that save, rather than reconstructing it from frame metadata afterward. Existing unguarded writes remain supported; verified expected-destination binding is optional. `remember --dry-run` retains read-only capability attenuation and cannot be combined with `--expected-destination`; use the separate destination preflight for intended-write inspection.

## Exact security and freshness boundary

A destination is assembled at operation entry from canonical authorization and the backend descriptor supplied by the trusted host. The descriptor records the host verification time in `verifiedAt`; a long-lived host may retain that evidence across operations. Canonical authority resolves each invocation and the store is bound to that scope before command/tool dispatch. Expected binding is checked again immediately before the save and authorization expiry is checked again. Existing PostgreSQL transaction-bound scope and RLS enforcement remain in place.

This slice does not re-query backend identity or canonical grant revocation atomically with the frame transaction. A revocation, host rebinding, or authority change after operation-entry resolution has the same in-flight freshness limitation as the existing trusted runtime. The preflight creates no persistent consent, reservation, append-only operation, payload digest, or durable idempotency grant. Its timestamps do not establish a new maximum backend-evidence age. Hosts must keep the verified Pool target fixed for the invocation; stronger transaction-coupled revocation and destination attestation require additional work.

Repository references describe the verified bootstrap association. Frames are still partitioned and protected by tenant/workspace; this change does not add per-frame repository ACLs. Do not treat frame `permissions`, module attribution, or an instruction file as an executable authorization grant.

## Installation and validation

These APIs require a Lex build containing this change and matching trusted-host/AXF wiring. Building a local checkout does not update a separately installed or pinned runtime. In the development environment that motivated this change, the audited installed runtime was 4.4.1 and the source checkout was 4.4.2; inspect the actual deployed artifact rather than assuming a source version activates the fix.

Targeted tests cover explicit unknown identities, two physical identities, separate schema/workspace destinations, real CLI/MCP capability maps, payload-free preflight, receipt parity, expected-binding drift, spoofed frame metadata, cache isolation, and bound-store cleanup. Live PostgreSQL RLS tests remain opt-in through dedicated test URLs; no production frame store is needed for these new tests.


## Execution-surface path identity in 4.4.4

Trusted CLI/MCP entrypoints pass their captured execution surface to destination construction. The same lexical identity formatter used by the local binding registry normalizes native separators and folds Windows case. POSIX identity remains case-sensitive. This fixes 4.4.3 rejecting an authorized Windows binding whose stored lowercase root differed from discovery's filesystem spelling.

Binding and discovered canonical repository roots must still be exactly equal after this formatting; sibling, nested and different-drive repository roots are not interchangeable. A valid project subdirectory stays distinct in the destination digest. This performs no filesystem lookup, symlink resolution or physical identity proof, and grants no new authority. Binding state, tenant/workspace, canonical authorization, backend verification and expected-destination restrictions remain required.

The optional fourth `createDestinationSnapshot` parameter is trusted `ExecutionSurfaceEvidenceV1`, supplied by the composition host rather than frame data, tool arguments or ambient environment. Existing three-argument direct callers retain conservative raw-root equality. Windows root formatting also applies to returned `projectRoot` and the digest inputs, so equivalent captured Windows case/separator spellings produce the same destination restriction. Re-inspect and reconcile previously captured expected identities after upgrading; never retry a mismatch by silently changing authority or rebinding a repository.
