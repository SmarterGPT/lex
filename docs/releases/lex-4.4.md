# Lex 4.4.0

The additive `@smartergpt/lex/context` API exposes the canonical session-context
builder and renderer without the general CLI/MCP import graph. Database drivers
load only when selected; frame-context retrieval does not construct behavioral
stores. Existing CLI/MCP behavior, ranking, provenance and failure meaning remain.

MCP help now advertises canonical names, accepts existing deprecated aliases and
returns canonical help. All fourteen shipped tools have help entries. No tool or
authorization capability is added by the help repair.

Five alternating fresh-process diagnostic pairs on Windows preserved identical
fixture output, excluding the observation timestamp. Initial median import time
was 718 ms for the consumer-style 4.3.0 CLI/MCP import and 86 ms for the narrow
candidate; parent wall time was 801 ms versus 152 ms. These are uncontrolled
warm-cache library measurements with different package locations, not a live STFC
startup claim. Windows I/O counters were unavailable. Reproduce and interpret them
using the [API and trial contract](../SESSION_CONTEXT_API.md).

This is candidate metadata, not publication evidence. Release requires the exact
Lex-MCP 4.4.0 wrapper and retained-artifact checks. #852 is implemented; #854's
library prerequisite is implemented, while consumer adoption, database-target and
required-constraint qualification remain follow-through. Installation verification,
credential custody and scoped runtime activation are unchanged.

See [migration and recovery](lex-4.4-migration.md).
