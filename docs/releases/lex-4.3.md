# Lex 4.3.0

This additive minor release includes deterministic Codex/Copilot policy-shadow
projections and explicit confirmed operation absence. Projections remain
non-authorizing, with fidelity and enforcement reported separately. Unknown proposal
data keeps its existing fail-closed meaning.

Recall preserves explicit fold radius zero and rejects invalid radii before store
access. HTTP startup returns a closeable server and rejects bind failures; OAuth
state belongs to each router and expires on requests without an import-time timer.
Runtime discovery compares canonical caller and repository paths, including Windows
short-name and junction aliases. Unrelated roots are still rejected.

Qualification adds bounded test/release jobs and Linux/Windows coverage. The memory
benchmark remains required, with unchanged limits, but runs apart from functional
test contention. The SQL source guard no longer depends on grep. Patch dependencies
address the sharp and js-yaml audit findings observed during qualification.

This is a release candidate, not evidence of publication. It requires matching
`@smartergpt/lex-mcp@4.3.0` with an exact Lex dependency. No scoped host/runtime lock is
updated by publishing these packages. Startup work #854 and help repair #852 remain
follow-up work; this release does not claim either is implemented.

See [migration and recovery](lex-4.3-migration.md) and [MCP lifecycle](../MCP_LIFECYCLE.md).
