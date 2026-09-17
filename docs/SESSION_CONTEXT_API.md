# Narrow session context API

`@smartergpt/lex/context` exports `buildSessionContext`, `renderSessionContextText`,
and their TypeScript contracts. It uses the same implementation as `lex context`.
It does not import the general CLI, MCP server, or either database driver at module
load. A default store is opened read-only, using only its selected backend. An
injected compatibility store may load its selected driver to preserve access-mode
reporting; it never causes unrelated backend or behavioral-store construction.

```ts
import { buildSessionContext } from "@smartergpt/lex/context";
import { scopedFrameStoreAsLegacyView } from "@smartergpt/lex/store";

// authorizedStore is bound by the host using its existing verified scope.
const result = await buildSessionContext(
  { projectRoot, branch, json: true, maxTokens: 1600 },
  scopedFrameStoreAsLegacyView(authorizedStore),
);
```

The host must authorize the scope and verify the database target before providing
the store. The builder does not authenticate a caller, select an authority, or
turn `projectRoot` into a database access grant. It only reads through the supplied
view; the caller retains responsibility for its lifetime. Keep the authorized view
and project root bound to the same host request. Do not pass an unscoped store to
serve a request that requires scoped authorization.

Selection, ranking, provenance, text escaping, output budgeting, missing-store
behavior and stable read-only schema errors are unchanged. Historical context
is not an instruction or proof of current success. Retrieval failures still appear
as warnings in the canonical result; hosts must inspect them rather than treating
an empty result as a successful read. An impossibly small envelope budget throws.

This surface returns frame context only. It does not derive behavioral constraints
or establish readiness to execute. Hosts must still require their configured
constraint providers before declaring such readiness. They may omit behavioral
setup for a frame-only operation, not for an operation that needs those constraints.

Installed code must still pass the host's existing verification before importing
this API. A narrower import graph does not shrink an approved installation manifest,
change credential custody, or authorize caching/reusing verification. Consumer host
adoption and its database-target/required-constraint qualification are separate from
the library release. Existing CLI/MCP paths remain supported.

## Reproducible diagnostic trial

After building the candidate, run:

```text
node scripts/measure-context-startup.mjs --compare <installed-4.3.0-root> <candidate-root>
```

The script uses five alternating fresh-process pairs and freezes exact output parity
before reporting performance. The only normalized field is the observation timestamp.
Fixtures cover branch/recency ordering, empty stores, delegated read failures and
oversized text. The delegated denial/wrong-target fixtures are not real authorization
or database-target tests. Existing context and scoped-store tests cover their actual
implementations separately. No live database or credentials are used.

Report import, read and parent-observed wall times, CPU and maximum RSS separately.
Windows does not expose the needed I/O counters through Node; the output records
`null`, not zero. Module-load tracing runs separately so its overhead does not enter
the timed trials. Loaded-module observations are not a complete trusted closure.
The baseline intentionally models the consumer's broad CLI/MCP import; this is not
a comparison against every possible 4.3.0 internal import. Package location,
dependency installation and uncontrolled OS caches remain confounders. Do not
extrapolate these results to the 22-second composite STFC startup.
