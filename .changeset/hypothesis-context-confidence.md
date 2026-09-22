---
"@smartergpt/lex": patch
---

Preserve stored hypothesis confidence in KnowledgeFrame context output. The existing low,
medium, or high value is included before byte budgeting; other record types omit it.
Hypotheses are omitted whole when they cannot fit. Stored schemas and freshness rules are unchanged.
