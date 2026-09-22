---
"@smartergpt/lex": patch
---

Recover older branch and policy-module context beyond the recent candidate window.
Search bounded relevant subsets only when the recent pool is capped, preserve query
and store scope, and expose coverage in context schema 1.5.0. Add exact branch search
filters and apply SQLite module filters before the result limit. Output budgets and
explicit supersession behavior are preserved.
