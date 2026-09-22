---
"@smartergpt/lex": patch
---

Follow explicit Frame supersession when building session context. Return the current replacement
without replaying retired guidance, preserve scoped read-only lookup, and report unresolved chains
instead of falling back to superseded content. Context schema 1.4.0 distinguishes this selection
contract and its new warning code. Full historical recall remains unchanged.
