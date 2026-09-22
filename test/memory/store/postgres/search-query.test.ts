import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Pool, PoolClient } from "pg";

import { buildPostgresTextSearchQuery } from "@app/memory/store/postgres/search-query.js";
import { PostgresFrameStore } from "@app/memory/store/postgres/frame-store.js";
import { POSTGRES_COMPATIBILITY_FRAME_STORE_SCHEMA_VERSION } from "@app/memory/store/postgres/compatibility-migrations.js";

test("compatibility PostgreSQL search applies parameterized relevance before limit", async () => {
  const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
  const query = async (sql: string, values: readonly unknown[] = []) => {
    queries.push({ sql: sql.replace(/\s+/g, " ").trim(), values });
    return {
      rows: sql.includes("MAX(version)")
        ? [{ version: POSTGRES_COMPATIBILITY_FRAME_STORE_SCHEMA_VERSION }]
        : [],
    };
  };
  const pool = {
    query,
    connect: async () => ({ query, release: () => undefined }) as unknown as PoolClient,
  } as unknown as Pool;
  const store = new PostgresFrameStore(pool, { accessMode: "read-only" });
  const branch = "feature/recovery_%";
  await store.searchFrames({
    query: "retrieval",
    exact: true,
    branch,
    moduleScope: ["target/search"],
    since: new Date("2026-01-01T00:00:00.000Z"),
    until: new Date("2026-02-01T00:00:00.000Z"),
    userId: "selected-user",
    limit: 2,
  });
  const search = queries.find(({ sql }) => sql.includes("search_vector @@"));
  assert.ok(search);
  assert.match(
    search.sql,
    /AND module_scope && \$3::text\[\] AND branch = \$4 AND "timestamp" >= \$5 AND "timestamp" <= \$6 AND user_id = \$7 ORDER BY "timestamp" DESC, id DESC LIMIT \$8$/
  );
  assert.deepEqual(search.values, [
    "retrieval",
    "retrieval",
    ["target/search"],
    branch,
    "2026-01-01T00:00:00.000Z",
    "2026-02-01T00:00:00.000Z",
    "selected-user",
    2,
  ]);
  assert.equal(search.sql.includes(branch), false);
  await store.close();
});

describe("PostgreSQL text-search query parity", () => {
  test("retains normalized exact tokens and raw compound text", () => {
    assert.deepEqual(
      buildPostgresTextSearchQuery({
        query: "aligned-stack-dogfood-2026-08-28",
        exact: true,
      }),
      {
        normalizedTsQuery: "aligned & stack & dogfood & 2026 & 08 & 28",
        rawPlainQuery: "aligned-stack-dogfood-2026-08-28",
      }
    );
  });

  test("preserves prefix and any-mode normalization", () => {
    assert.deepEqual(buildPostgresTextSearchQuery({ query: "AX-001 release", mode: "any" }), {
      normalizedTsQuery: "ax:* | 001:* | release:*",
      rawPlainQuery: "AX-001 release",
    });
  });

  test("keeps punctuation-only input on the existing no-query path", () => {
    assert.equal(buildPostgresTextSearchQuery({ query: "--- !!!", exact: true }), null);
  });
});
