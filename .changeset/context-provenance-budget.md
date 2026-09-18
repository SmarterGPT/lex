---
"@smartergpt/lex": patch
---

Preserve useful session context by explicitly deferring oversized provenance before
dropping Frames. Context JSON schema 1.3.0 adds `provenanceOmitted`; text output now
identifies clipped fields and separately available provenance. Full stored Frames and
recall remain unchanged, and budget accounting includes omission warnings.
