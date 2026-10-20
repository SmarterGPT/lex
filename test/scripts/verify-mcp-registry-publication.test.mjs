import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertRegistryPublicationEntry,
  verifyRegistryPublication,
} from "../../scripts/verify-mcp-registry-publication.mjs";

const entry = {
  server: {
    name: "dev.smartergpt/lex",
    version: "4.4.4",
    packages: [
      {
        registryType: "npm",
        identifier: "@smartergpt/lex-mcp",
        version: "4.4.4",
        transport: { type: "stdio" },
      },
    ],
  },
  _meta: { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true } },
};

test("exact version endpoint verifies active/latest identity without search propagation", async () => {
  let requested;
  const result = await verifyRegistryPublication({
    version: "4.4.4",
    fetchImpl: async (url, options) => {
      requested = url;
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true, json: async () => structuredClone(entry) };
    },
  });
  assert.equal(
    requested,
    "https://registry.modelcontextprotocol.io/v0.1/servers/dev.smartergpt%2Flex/versions/4.4.4"
  );
  assert.deepEqual(result.entry, entry);
  assert.ok(!requested.includes("search="));
});

test("exact visibility does not bypass server/package/version/transport/status/latest checks", () => {
  for (const change of [
    (e) => (e.server.name = "other/server"),
    (e) => (e.server.version = "4.4.3"),
    (e) => (e.server.packages[0].registryType = "oci"),
    (e) => (e.server.packages[0].identifier = "other-package"),
    (e) => (e.server.packages[0].version = "4.4.3"),
    (e) => (e.server.packages[0].transport.type = "sse"),
    (e) => (e._meta["io.modelcontextprotocol.registry/official"].status = "deleted"),
    (e) => (e._meta["io.modelcontextprotocol.registry/official"].isLatest = false),
    (e) => delete e._meta,
  ]) {
    const altered = structuredClone(entry);
    change(altered);
    assert.throws(() => assertRegistryPublicationEntry(altered, "4.4.4"), /active\/latest/);
  }
});

test("unavailable or malformed exact records fail closed", async () => {
  await assert.rejects(
    () =>
      verifyRegistryPublication({
        version: "4.4.4",
        fetchImpl: async () => ({ ok: false, status: 404, statusText: "Not Found" }),
      }),
    /404/
  );
  await assert.rejects(
    () =>
      verifyRegistryPublication({
        version: "4.4.4",
        fetchImpl: async () => ({
          ok: true,
          json: async () => {
            throw new SyntaxError("invalid JSON");
          },
        }),
      }),
    /invalid JSON/
  );
  await assert.rejects(
    () =>
      verifyRegistryPublication({
        version: "4.4.4",
        fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
      }),
    /active\/latest/
  );
});

test("stalled request is aborted within its bounded attempt and invalid budgets are rejected", async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      () =>
        verifyRegistryPublication({
          version: "4.4.4",
          timeoutMs: 15,
          fetchImpl: async (_url, { signal }) =>
            new Promise((_resolve, reject) =>
              signal.addEventListener("abort", () => reject(signal.reason), { once: true })
            ),
        }),
      { name: "TimeoutError" }
    );
  } finally {
    clearTimeout(keepAlive);
  }
  for (const timeoutMs of [0, -1, 30001, Infinity])
    await assert.rejects(
      () => verifyRegistryPublication({ version: "4.4.4", timeoutMs }),
      /bounded/
    );
  await assert.rejects(() => verifyRegistryPublication({ version: "4.4.4/../latest" }), /semver/);
});
