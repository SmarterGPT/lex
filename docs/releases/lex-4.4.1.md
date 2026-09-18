# Lex 4.4.1

This patch preserves useful session context when supporting provenance would
otherwise consume the response budget. JSON context schema 1.3.0 adds the optional
`provenanceOmitted: true` marker: the projection can defer provenance before
dropping a Frame. `budget.truncated` includes that deferral; `omittedFrames` still
counts only whole Frames omitted. Budget fitting includes omission warnings.

Text context now identifies clipped fields and separately available provenance.
Stored Frames, scope, ranking and authorization are unchanged. Use
`lex recall <frame-id> --json` for the full current record; recall is not a promise
of an immutable historical snapshot. Consumers enforcing an exact context schema
version should accept 1.3.0 and recognize these explicit omission markers.

No store migration is needed. Retain the previously qualified 4.4.0 runtime lock
for rollback; activate the new package pair only after consumer qualification.
The exact Lex-MCP 4.4.1 wrapper must depend on public Lex 4.4.1. This document is
candidate metadata, not evidence of publication or installed activation.

The regression test reproduces oversized provenance, verifies retained continuity
and unchanged stored evidence, and covers output markers within the budget.
This establishes projection behavior, not end-to-end model-token savings.
