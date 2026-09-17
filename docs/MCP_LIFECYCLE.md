# MCP lifecycle and qualification

`startHttpServer(db, options)` resolves to the listening Node HTTP `Server`.
Callers own graceful shutdown through `server.close(callback)` and remain responsible
for closing their database after outstanding work has finished. Bind failures reject
the startup promise. Port zero requests an ephemeral port; inspect `server.address()`.

OAuth CSRF state belongs to each router. Expired state is pruned on the next OAuth
request, without a module-level interval. Idle expired entries remain in memory until
another request or router reclamation; they cannot become valid again merely because
cleanup did not run. State remains single-use and is not shared across routers or
persisted across restart. This is still a single-instance in-memory implementation.

The default test runner has a 20-minute hard deadline per group. It starts Node with
the tsx loader directly, avoiding an intermediate CLI wrapper. A deadline fails the
gate and identifies the group and file count; inherited output retains the last
reported test. This is a last-resort watchdog, not graceful application shutdown or
proof that every descendant has exited. CI job deadlines provide an outer bound.
The existing default suite's force-exit flag remains; dedicated lifecycle tests also
exercise natural process exit without that flag.

Functional TypeScript, JavaScript, and the memory benchmark run sequentially as
separate groups. The benchmark's assertions and thresholds are unchanged: running
it alongside hundreds of functional tests measures additional scheduling contention.
This isolated benchmark is not a loaded-system latency claim.

The canonical CI workflow runs build/coverage on Linux and Windows for PRs and main.
Manual minimal qualification may omit tests; manual full qualification also requires
integration and packaging jobs. Workflow configuration alone does not prove those
jobs executed. Release candidate jobs are independently bounded at 60 minutes.
