# Lex 4.4 migration and recovery

Node 24 or newer remains required. Use the exact verified Lex/Lex-MCP 4.4.4 pair
after publication. This release introduces no store/schema migration. Preserve
existing data, credentials, bindings and runtime locks.

For the 4.4.3 bundled SQLite driver, Linux glibc requires >=2.35; Windows x86
and Linux armv7 are unsupported. Node remains >=24. Install without a compiler
or rebuild and qualify the exact package on the target platform. See the
[native support boundaries](../dev/sqlite-bindings.md) and
[4.4.3 dependency and type notes](lex-4.4.3.md).

Existing CLI/MCP consumers need no API migration. Help accepts deprecated names
but identifies their canonical replacement in its response. Hosts choosing the new
`@smartergpt/lex/context` API must follow its [scope and lifecycle contract](../SESSION_CONTEXT_API.md).
Keep required behavioral constraints separate and mandatory where the operation
requires them; frame context alone is not execution readiness.

Publish packages through the protected workflow and verify exact retained bytes,
provenance, signed tags and the matching wrapper. Publishing does not replace an
installed scoped runtime or authorize reducing verification coverage. Keep that
activation separate and qualified against the real consumer.

The existing public 4.4.2 package pair remains available as a package recovery baseline.
Keep each host's last qualified installed runtime and exact lock until its update is
qualified. Package availability is not proof that a specific installed host works.
On artifact, database identity or authority mismatch, stop and retain the evidence;
do not recreate stores, rewrite public versions or silently downgrade authority.

The deprecated transport still returns `LEX_MCP_LEGACY_ENTRYPOINT_REMOVED`.
Use `@smartergpt/lex-mcp@4.4.4` only after the exact pair is verified; preserve explicit
`LEX_POSTGRES_PASSWORD` forwarding from the host's existing secret source. Do not
print credentials. See the [4.3 recovery matrix](lex-4.3-migration.md) for unchanged
partial-publication and consumer-failure procedures.

The exact core package is `@smartergpt/lex@4.4.4`. An explicitly qualified host may use:

```toml
command = "npx"
args = ["--yes", "@smartergpt/lex-mcp@4.4.4"]
env_vars = ["LEX_POSTGRES_PASSWORD"]
```

## Human-only publication boundary

Local npm publication remains prohibited. Publication uses the protected release
workflow from reviewed current main, with its required approval and retained artifact
checks. Operator-authorized CLI environment approval follows workspace policy; personal
signing prompts remain with the signer. Do not substitute a local token or repack bytes.

## Failure and recovery matrix

| Observation                                                                         | Required response                                                                                                                  |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Windows build fails because `chmod` is unavailable                                  | Stop the build and use the reviewed portable scripts; do not substitute another artifact or claim executable-bit proof.            |
| SCRAM says the password must be a string                                            | Check explicit `LEX_POSTGRES_PASSWORD` forwarding without printing it. Preserve the selected store and authentication.             |
| Workspace, branch, or credential-free store identity is unexpected                  | Stop store access and reconcile identity before mutation.                                                                          |
| Quarantined legacy Frames exist                                                     | Use the existing explicit inspect/plan/apply workflow from the 4.0 guide. Installation grants no repair permission.                |
| A dependent lock still resolves Lex 3.0.1 or another version                        | Refresh it from exact verified public Lex 4.4.4 bytes; reject directory links or mismatched integrity as release evidence.         |
| Lex is public but its tag, Lex-MCP, GitHub release, or Registry entry is incomplete | Preserve the verified immutable artifact and finish stages in dependency order. Never replace public bytes under the same version. |
| Native Windows or another downstream packed consumer fails                          | Stop publication or sealing at that stage and retain the failing command and exact artifact identity.                              |

## Windows destination recovery

Lex 4.4.3 compared destination roots as raw strings. A registry root recorded in
lowercase could disagree with discovery's case-preserving Windows path and reject
an otherwise active binding. Do not change store roots, recreate a binding or
relax authority to work around that failure.

Lex 4.4.4 uses the execution surface captured by trusted CLI/MCP bootstrap to
normalize lexical root comparison and destination identity. Equivalent Windows
path spelling and case compare consistently; different roots remain different and
POSIX paths remain case-sensitive. This does not prove physical path identity,
resolve symlinks or equate different UNC aliases. Frame/MCP request payloads and
ambient environment variables do not supply destination authority.

After upgrading, run authorized destination preflight and reconcile roots,
backend, tenant, workspace and binding before saving. Canonical Windows root
identity can change a previously captured expected-destination hash. Obtain a
fresh expected binding only after verifying the snapshot; never silently rebind
or retry a rejected write without checking its destination. Keep the previous
qualified runtime recoverable until the exact new pair passes native Windows
preflight, save and read-back on the intended host.

Direct library hosts may supply the optional fourth `createDestinationSnapshot`
argument with trusted captured execution-surface evidence. Existing three-argument
callers retain conservative raw root equality. No Frame schema, database, cipher
or key-derivation migration is required.

See [4.4.4 release notes](lex-4.4.4.md) and the
[destination provenance contract](../DESTINATION_PROVENANCE.md). The immutable
[4.4.3 notes](lex-4.4.3.md) retain the original destination and native-driver changes.
An unverified injected Pool still has a per-instance diagnostic reference; only
explicit trusted host verification supports a stable destination restriction.
