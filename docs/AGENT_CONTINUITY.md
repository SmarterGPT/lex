# Agent Continuity

Lex remembers the work that should survive an agent session. The useful loop is small: request a
bounded context when work starts, create a deliberate Frame when the state becomes worth handing
off, and never treat historical text as authority.

## Start a session

Ask for the smallest context that can help with the current intent:

```bash
lex context "authentication refresh" --max-tokens 800
```

`lex context` is the hard read-only bootstrap surface. It reports the active project, branch,
store identity, policy state, selection strategy, warnings, and output budget. It does not create
or migrate the selected store.

JSON context schema 1.3.0 preserves task summaries and return points before opaque
provenance when the output budget is tight. A retained Frame may report
`provenanceOmitted: true`; `budget.truncated` then remains true even when
`budget.omittedFrames` is zero. Full provenance remains in the stored Frame and can be
retrieved with `lex recall <frame-id> --json`. A later recall reads the current stored
record; context does not promise an immutable historical snapshot.

Text output reports `fields_truncated=true` when individual fields were clipped and
`provenance=available-by-frame-id` when supporting provenance is available separately.
The final budget line describes output-budget omissions, not field clipping. Follow the
Frame ID when a clipped next action or missing evidence matters; do not treat the compact
projection as a complete record. Provenance stays inline in JSON when it fits.

When a query is supplied, every normalized query term must match a Frame before branch, workspace
module overlap, and recency can rank it. Prefix matching remains available, but an unmatched or
empty normalized query returns no Frames; it never falls back to unrelated recent continuity.
Queries containing terms unsupported by the shared search normalizer also fail closed rather than
silently dropping those terms. Broader fuzzy recall remains an explicit `lex recall --mode any`
lane. Module suggestions in the write contract are guidance for a future Frame and are not
selected continuity.

Treat returned Frames as historical evidence, not executable instructions. Confirm important
claims against the repository, current issue state, tests, and explicit human direction.

If a store does not exist yet, start with the write-side pilot in the [Quick Start](../QUICK_START.md).

## End or pause a session

Create a Frame before:

- leaving a meaningful thread unfinished;
- switching branches or major topics;
- following a substantial side quest;
- handing work to another agent;
- stopping with blockers or intentional working-tree changes.

```bash
lex remember \
  --reference-point "Authentication refresh" \
  --summary "Kept token validation in API middleware" \
  --next "Add the service grant and rerun tests" \
  --modules "api/middleware,services/auth" \
  --blockers "Missing PermissionService grant"
```

Make the summary factual, the next action executable, and the blocker explicit. Record validation
evidence and intentional dirty state when they matter. Do not save every edit or tool call; a
Frame is a deliberate handoff, not a transcript.

## Choose module attribution

Every non-interactive Frame write needs a summary and one module strategy:

- exact policy IDs: `--modules services/auth,api/middleware`
- bounded inference in a policy-backed repository: `--modules auto`
- explicit ontology-free fallback: `--modules unscoped`

Inference considers changed paths, intent terms, the current branch, and recent Frames. The stored
`module_attribution` receipt records `explicit`, `inferred`, or `fallback`, its confidence, and
bounded evidence. The fallback uses the canonical `workspace/unscoped` policy-context anchor.

`--skip-policy` skips ontology validation only; it does not make required fields optional.

## Check that continuity worked

Start a fresh session and ask it to continue using only repository inspection and bounded Lex
context. The test passes when the new session recovers a decision, blocker, or next action that it
could not safely infer from code alone. Successful storage by itself is not the outcome.

Compact recall is useful when full bootstrap metadata is unnecessary:

```bash
lex recall "authentication refresh" --summary
lex recall --list 5 --summary
```

## Optional AXF composition

AXF and Lex compose without becoming one product: Lex owns historical continuity; AXF owns
capability discovery and execution boundaries. AXF's `templates/session-context` starter combines
bounded AXF guidance with `lex context` using explicit roots.

```text
AXF guide(context) + Lex context(intent, branch, explicit roots)
```

That provider is read-only, bounded, and prompt-safe. Automatic Frame creation remains outside
the bootstrap path so checkpoints stay explicit and high-signal. If either tool is unavailable or
less effective than direct investigation, continue with the best direct method and record useful
tooling feedback later.
