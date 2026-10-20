# Lex 3 PostgreSQL Isolation Canary

The two-tenant/five-workspace PostgreSQL isolation canary served as the Lex 3.0 GA gate and remains
the live end-to-end security canary. It is an acceptance test, not a general PostgreSQL deployment
guide: a normal operation must not observe, mutate, count, infer, or collide with a Frame outside
its resolved tenant/workspace scope.

## Opt-in developer command

The operator must provide both `LEX_DATABASE_URL` and `LEX_POSTGRES_PASSWORD`. The administrative
database identity must be able to create and remove an isolated schema and temporary login role,
migrate objects, grant/revoke privileges, and execute the live identity checks. The canary creates
and removes temporary PostgreSQL roles and schemas; do not run it against a database where that
administrative activity is prohibited.

The canary is intentionally excluded from `npm test` and `npm run ci`. An operator supplies the
existing PostgreSQL configuration to one explicitly invoked developer wrapper:

```bash
npm run test:dogfood:postgres
```

The wrapper accepts `LEX_DATABASE_URL` and `LEX_POSTGRES_PASSWORD` from its own process and
immediately passes one explicit in-memory connection string to the canary runner. It never prints,
returns, or persists either value. Production runtime composition remains environment-independent:
authority directories, deployer-constructed pools, and the trusted selection provider still enter
through explicit constructor inputs.

Use `npm run test:dogfood:postgres -- --diagnostic` to add canonical IDs, a secret-free backend
identity, pool size, and scope-transition count. Diagnostics remain redacted and opt-in.

Use `npm run test:dogfood:postgres -- --verify-failure-cleanup` to inject a failure immediately
after the create case. That proof succeeds only when the receipt identifies the failed case and
confirms that the schema, temporary role, registries, and exports were still removed.

Use `npm run test:dogfood:postgres -- --diagnostic --verify-setup-failure` to fail before live
backend identity is read. That receipt must report the backend as `unavailable`, every case as
`not-run`, every output assertion as `not-proven`, and all cleanup assertions as complete.

## What the gate proves

The canary creates one random schema and one temporary least-privileged `LOGIN` role with a random
in-memory credential. The role is `NOINHERIT`, a non-owner, a non-superuser, and `NOBYPASSRLS`.
Normal operations connect directly as that role; `session_user` and `current_user` must both retain
that identity even after `RESET ROLE`. The canary migrates one canonical authority directory and
one scoped Frames table, then seeds this fixed topology:

```text
platform-dogfood: lex, axf
stfc-dogfood: stfc-mod, stfc-companion, majel-dev
```

One runtime pool with `max: 1` alternates all five scopes. The receipt enumerates create, get,
list, search, update, delete, count, statistics, export, CLI dispatch, MCP dispatch, pool reuse,
rollback, error, cancellation, and every required negative case. The canary also creates distinct
Windows-native and WSL SQLite registry fixtures and proves they resolve identical canonical
tenant/workspace IDs without sharing local registry identities.

Migration and cleanup use the separate privileged administration boundary; those out-of-band
connections are never passed to normal Frame operations, CLI dispatch, or MCP dispatch.

The normal agent-facing CLI JSON responses are bounded, and MCP searches explicitly exercise the
compact response contract and its abbreviated fields. Runtime-scope diagnostics are absent unless
requested, and full diagnostics contain references and explicit redactions instead of
authentication handles or host paths.

## Cleanup invariant

Cleanup runs from `finally`, including after a failed assertion. The receipt is not successful
unless all four assertions are true:

- isolated schema absent;
- runtime role absent;
- both local registry fixtures removed;
- all export fixtures removed.

The default receipt is a single JSON object with the exact expected and actual result for every
case. Execution follows one canonical order. A case failure records exactly one `failed` result;
every later case is `not-run`. Setup and other phase failures preserve a completed prefix followed
by `not-run`. Output assertions are `proven` only after their real CLI/MCP checks finish. A failed
gate exits non-zero and reports only a stable phase, optional case ID, and error code.

See [authorized destination inspection and save receipts](./DESTINATION_PROVENANCE.md) for trusted backend evidence, payload-free preflight, expected-destination restrictions, and the operation-entry freshness boundary.
