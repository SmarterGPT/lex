# Lex 4.4 migration and recovery

Node 24 or newer remains required. Use the exact verified Lex/Lex-MCP 4.4.1 pair
after publication. This release introduces no store/schema migration. Preserve
existing data, credentials, bindings and runtime locks.

Existing CLI/MCP consumers need no API migration. Help accepts deprecated names
but identifies their canonical replacement in its response. Hosts choosing the new
`@smartergpt/lex/context` API must follow its [scope and lifecycle contract](../SESSION_CONTEXT_API.md).
Keep required behavioral constraints separate and mandatory where the operation
requires them; frame context alone is not execution readiness.

Publish packages through the protected workflow and verify exact retained bytes,
provenance, signed tags and the matching wrapper. Publishing does not replace an
installed scoped runtime or authorize reducing verification coverage. Keep that
activation separate and qualified against the real consumer.

The prior verified public 4.3.0 package pair is the package recovery baseline.
An installed scoped 4.2.0 runtime may remain pinned until its own update is qualified.
On artifact, database identity or authority mismatch, stop and retain the evidence;
do not recreate stores, rewrite public versions or silently downgrade authority.

The deprecated transport still returns `LEX_MCP_LEGACY_ENTRYPOINT_REMOVED`.
Use `@smartergpt/lex-mcp@4.4.1` only after the exact pair is verified; preserve explicit
`LEX_POSTGRES_PASSWORD` forwarding from the host's existing secret source. Do not
print credentials. See the [4.3 recovery matrix](lex-4.3-migration.md) for unchanged
partial-publication and consumer-failure procedures.

The exact core package is `@smartergpt/lex@4.4.1`. An explicitly qualified host may use:

```toml
command = "npx"
args = ["--yes", "@smartergpt/lex-mcp@4.4.1"]
env_vars = ["LEX_POSTGRES_PASSWORD"]
```

## Human-only publication boundary

Local npm publication remains prohibited. Publication uses the protected release
workflow from reviewed current main, with its required approval and retained artifact
checks. Operator-authorized CLI environment approval follows workspace policy; personal
signing prompts remain with the signer. Do not substitute a local token or repack bytes.

## Failure and recovery matrix

| Observation | Required response |
| --- | --- |
| Windows build fails because `chmod` is unavailable | Stop the build and use the reviewed portable scripts; do not substitute another artifact or claim executable-bit proof. |
| SCRAM says the password must be a string | Check explicit `LEX_POSTGRES_PASSWORD` forwarding without printing it. Preserve the selected store and authentication. |
| Workspace, branch, or credential-free store identity is unexpected | Stop store access and reconcile identity before mutation. |
| Quarantined legacy Frames exist | Use the existing explicit inspect/plan/apply workflow from the 4.0 guide. Installation grants no repair permission. |
| A dependent lock still resolves Lex 3.0.1 or another version | Refresh it from exact verified public Lex 4.4.1 bytes; reject directory links or mismatched integrity as release evidence. |
| Lex is public but its tag, Lex-MCP, GitHub release, or Registry entry is incomplete | Preserve the verified immutable artifact and finish stages in dependency order. Never replace public bytes under the same version. |
| Native Windows or another downstream packed consumer fails | Stop publication or sealing at that stage and retain the failing command and exact artifact identity. |
