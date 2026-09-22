# KnowledgeFrames

KnowledgeFrames compile explicitly selected Markdown into a typed, disposable context snapshot.
The Markdown remains canonical and human-governed. Lex never rewrites it, and neither human nor
agent authorship makes its contents trusted instructions.

This is separate from episodic `Frame` continuity. KnowledgeFrames use a dedicated logical store,
normally `.smartergpt/lex/knowledge.db`; deleting or rebuilding derived knowledge cannot modify
`.smartergpt/lex/memory.db`.

## Opt in exact sources

List each Markdown file by exact repository-relative path in `lex.yaml`. Globs, absolute paths,
traversal, and implicit repository scans are rejected.

```yaml
version: 1
knowledge:
  sources:
    - docs/architecture.md
    - notes/probes.md
```

Repositories without `knowledge.sources` are unchanged. There is no migration and no implicit
indexing.

## Author a block

Only content between paired HTML comments is compiled. Marker-shaped text inside fenced examples
is ignored by the Markdown parser. The first heading supplies the title.

```markdown
<!-- lex:frame
id: ship-state/repair-transition-race
type: hypothesis
lifecycle: active
confidence: medium
visibility: workspace
relations:
  - type: tested-by
    target: repair-action-transition
-->

### Repair UI may observe an intermediate state

The canonical Markdown body remains useful to an ordinary reader.

<!-- lex:end -->
```

IDs are explicit repository-scoped logical identities. Moving a block or changing its type does not
change its ID. IDs must be unique in the effective snapshot, and relation targets must resolve by
logical ID.

Version 1 accepts exactly `hypothesis`, `evidence`, `seam`, and `probe`. Hypotheses require
`confidence: low | medium | high`; the other types reject confidence rather than giving it unclear
semantics. `visibility` currently supports only the conservative `workspace` value.

Lifecycle controls projection, not trust:

- `draft` is compiled and explainable but excluded from normal context.
- `active` is eligible for bounded context.
- `retired` remains explainable in its snapshot but is excluded from normal context.

Every body remains `untrusted-project-data`. Visibility affects Lex projection eligibility; it does
not secure the underlying Markdown file or grant execution authority.

## Check, index, consume, and explain

All four commands emit structured JSON.

```bash
lex knowledge check
lex knowledge index
lex knowledge context "repair transition" --limit 10 --max-bytes 12000
lex knowledge explain ship-state/repair-transition-race
```

`check` parses and validates without creating a database or writing any store. `index` fingerprints
the effective config and every selected source before and after compilation; if anything changes,
it aborts before persistence. A coherent snapshot is persisted and activated atomically.

`context` opens a detached query-only SQLite snapshot, applies one count/whole-envelope byte budget, and reports
selection reasons, provenance, freshness, and warnings. It returns bodies only from a `current`
snapshot. When sources are stale, missing, invalid, or unindexed, stored bodies are excluded.

Returned hypotheses include their stored `confidence: low | medium | high`; evidence, seam,
and probe records omit the property. Confidence is an author-supplied qualitative assessment,
not a calibrated probability or authority. It counts toward the existing compact JSON envelope
byte budget. A hypothesis that cannot fit is omitted whole; its confidence is never stripped to
make room. This additive projection field does not require reindexing unchanged sources or a
stored schema migration. A confidence change in canonical Markdown does require reindexing,
like any other source change.

This applies to the direct CLI/API context result. An adapter that selects only IDs or shadow
metadata must deliberately adopt richer record content before those fields reach its worker.

`explain` resolves the logical ID in both the stored snapshot and current Markdown, reporting the
current marker coordinates separately from stored snapshot coordinates. Coordinates are
provenance, never identity.

The same contracts and operations are exported from `@smartergpt/lex/knowledge` for provider
adapters. AXF owns provider discovery, rollout, fallback, and composition; Lex owns these semantics.
