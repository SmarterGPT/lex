# Lex 4.3 migration and recovery

Node 24 or newer remains required. No store/schema migration is introduced by the
4.3 additions. Existing frames, scoped credentials and workspace bindings must be
preserved. Validate the exact packed artifact before replacing an installed version.

Use the exact matching Lex and Lex-MCP 4.3.0 pair after both are public. A package
release does not change an installed scoped runtime or its trust lock; those updates
require their own qualification. Until then, the verified 4.2.0 pair remains usable.

HTTP callers may retain the returned server and call `server.close(callback)` to
drain requests. The caller still owns its database. OAuth state is not persisted or
shared between router instances; in-progress authorization must return to its
originating router and must restart after a server restart.

Policy projections do not grant effect authority. Explicit absence is distinct from
unknown proposal data; callers must not relabel unknown data as confirmed absence.
Radius zero now means seed modules only, while the omitted radius remains one hop.

Recovery uses the previously verified exact 4.2.0 package pair and its recorded
integrities, without deleting stores or rewriting immutable published versions/tags.
Stop on receipt/integrity mismatch; prepare a new version instead of republishing.

## Compatibility transport and credentials

The candidate pair is `@smartergpt/lex@4.3.0` and `@smartergpt/lex-mcp@4.3.0`.
The removed legacy transport still reports `LEX_MCP_LEGACY_ENTRYPOINT_REMOVED`.
After verifying the pair, an explicitly selected host may pin:

```toml
command = "npx"
args = ["--yes", "@smartergpt/lex-mcp@4.3.0"]
env_vars = ["LEX_POSTGRES_PASSWORD"]
```

Forward `LEX_POSTGRES_PASSWORD` only from existing host secrets, without printing it.
Environment forwarding does not grant tenant authority or replace scoped bindings.

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
| A dependent lock still resolves Lex 3.0.1 or another version | Refresh it from exact verified public Lex 4.3.0 bytes; reject directory links or mismatched integrity as release evidence. |
| Lex is public but its tag, Lex-MCP, GitHub release, or Registry entry is incomplete | Preserve the verified immutable artifact and finish stages in dependency order. Never replace public bytes under the same version. |
| Native Windows or another downstream packed consumer fails | Stop publication or sealing at that stage and retain the failing command and exact artifact identity. |

