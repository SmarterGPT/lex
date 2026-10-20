# Lex 4.4.2

This patch strengthens session-context selection without changing stored Frame
schemas, authorization, or write behavior.

Context composition now follows explicit Frame supersession and returns the current
replacement without replaying retired guidance. Unresolved or cyclic chains are
reported instead of falling back to superseded content. Context schema 1.4.0
identifies the selection contract and warning code; full historical recall remains
unchanged.

When the recent candidate window is capped, Lex also searches bounded relevant
branch and policy-module subsets. Query and store scope remain enforced, SQLite
module filters run before the result limit, and context schema 1.5.0 reports pool
coverage. Output budgets and explicit supersession behavior are preserved.

KnowledgeFrame hypothesis context now includes the stored low, medium, or high
confidence value before byte budgeting. Other record types omit confidence, and a
hypothesis that cannot fit is omitted whole.

No store migration is needed. Retain the previously qualified 4.4.1 runtime lock
for rollback; activate the new package pair only after consumer qualification. The
exact Lex-MCP 4.4.2 wrapper must depend on public Lex 4.4.2. This document is
candidate metadata, not evidence of publication or installed activation.

Regression coverage verifies supersession traversal and failure reporting, bounded
relevant-pool recovery and coverage metadata, scoped SQLite filtering, confidence
projection, and byte-budget behavior. These tests establish deterministic context
composition; downstream host and transport qualification remain separate release
evidence.
