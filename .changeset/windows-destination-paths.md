---
"@smartergpt/lex": patch
---

Use the trusted execution surface's existing registry path normalization for destination snapshots. Windows canonical-root casing and separators no longer reject an otherwise authorized active binding; expected destination identities stay stable across those spellings. Preserve exact repository-root, tenant, workspace, state and authority checks, and POSIX case sensitivity.
