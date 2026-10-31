// Separate process: substitute only the private factory, then use actual compiled
// public owner classes and the captured actual typed lifecycle core with fakes.
import assert from "node:assert/strict";
import { mock } from "node:test";

const coreUrl = new URL("../../../../../dist/memory/store/postgres/owned-pool.js", import.meta.url);
const { createOwnedPool } = await import(coreUrl.href);
let selected,
  created = [];
const replacement = mock.module(coreUrl, {
  namedExports: {
    createOwnedPostgresPool(config) {
      const scenario = selected;
      let id = 0;
      const timers = new Map();
      let owner;
      class Client {
        constructor() {
          this.callbacks = [];
        }
        connect(callback) {
          this.callback = callback;
        }
        end(callback) {
          this.callbacks.push(callback);
        }
      }
      class Pool {
        constructor(options) {
          this.options = options;
          this.ends = 0;
        }
        connect() {
          this.client = new this.options.Client();
          return new Promise((resolve, reject) =>
            this.client.connect((error) => (error ? reject(error) : resolve(this.client)))
          );
        }
        end() {
          this.ends++;
          return scenario.poolError ? Promise.reject(scenario.poolError) : Promise.resolve();
        }
      }
      owner = createOwnedPool({
        Client,
        Pool,
        config,
        setTimer: (fn, delay) => {
          assert.equal(delay, 2000);
          timers.set(++id, fn);
          return id;
        },
        clearTimer: (key) => timers.delete(key),
        enqueue: queueMicrotask,
      });
      created.push({ ...owner, config, timers });
      return { pool: owner.pool, close: owner.close };
    },
  },
});
try {
  const { PostgresFrameStore } =
    await import("../../../../../dist/memory/store/postgres/frame-store.js");
  const { PostgresScopedFrameStoreBackend, PostgresFrameStoreAdministration } =
    await import("../../../../../dist/memory/store/postgres/scoped-frame-store.js");
  const { PostgresBehavioralStoreBackend } =
    await import("../../../../../dist/memory/store/postgres/behavioral-store.js");
  const { FRAME_STORE_CAPABILITIES } =
    await import("../../../../../dist/memory/store/scoped-frame-store.js");
  const { BEHAVIORAL_STORE_CAPABILITIES } =
    await import("../../../../../dist/memory/store/behavioral-store.js");
  const flush = async () => {
    for (let i = 0; i < 16; i++) await Promise.resolve();
  };
  const observe = (p) => {
    const state = { kind: "pending" };
    p.then(
      () => {
        state.kind = "resolved";
      },
      (error) => {
        state.kind = "rejected";
        state.error = error;
      }
    );
    return state;
  };
  const source = "postgresql://lex:FAKE_ONLY@127.0.0.1:12345/lex";
  const specs = [
    {
      name: "compatibility",
      make: (connection) => new PostgresFrameStore(connection),
      app: "lex-frame-store",
      timeout: 5000,
    },
    {
      name: "scoped runtime",
      make: (connection) =>
        new PostgresScopedFrameStoreBackend(connection, { schema: "lex_owner_test" }),
      app: "lex-scoped-frame-store-runtime",
      timeout: 5000,
    },
    {
      name: "scoped administration",
      make: (connection) =>
        new PostgresFrameStoreAdministration(connection, { schema: "lex_owner_test" }),
      app: "lex-scoped-frame-store-admin",
      timeout: 5000,
    },
    {
      name: "behavioral",
      make: (connection) =>
        new PostgresBehavioralStoreBackend(connection, { schema: "lex_owner_test" }),
      app: undefined,
      timeout: undefined,
    },
  ];
  let physicalCases = 0,
    externalCases = 0,
    logicalCases = 0;
  for (const spec of specs)
    for (const mode of ["deferred-success", "pool-error", "cleanup-expiry"]) {
      selected = { poolError: mode === "pool-error" ? new Error("FAKE_POOL_END_FAILURE") : null };
      const object = spec.make(source),
        resource = created.at(-1);
      assert.equal(resource.config.application_name, spec.app);
      assert.equal(resource.config.connectionTimeoutMillis, spec.timeout);
      assert.equal(resource.config.allowExitOnIdle, true);
      assert.equal(resource.snapshot().effectiveMax, spec.name === "compatibility" ? 64 : 10);
      const auth = new Error("FAKE_AUTH_FAILURE");
      const connected = resource.pool.connect().catch((error) => error);
      resource.pool.client.callback(auth);
      assert.equal(await connected, auth);
      assert.equal(resource.snapshot().phases.cleanupPending, 1);
      const pending = object.close();
      assert.equal(object.close(), pending);
      const state = observe(pending);
      await flush();
      assert.equal(state.kind, "pending");
      assert.equal(resource.pool.ends, 1);
      if (mode === "cleanup-expiry") {
        for (const callback of [...resource.timers.values()]) callback();
        await flush();
        assert.equal(state.kind, "rejected");
        assert.equal(state.error.code, "LEX_POSTGRES_CLEANUP_UNCERTAIN");
        resource.pool.client.callbacks[0]();
        await flush();
        assert.equal(resource.snapshot().uncertain, true);
      } else {
        resource.pool.client.callbacks[0]();
        await flush();
        assert.equal(state.kind, mode === "pool-error" ? "rejected" : "resolved");
        if (mode === "pool-error") assert.equal(state.error, selected.poolError);
      }
      assert.equal(object.close(), pending);
      assert.equal(resource.pool.ends, 1);
      assert.equal(resource.timers.size, 0);
      physicalCases++;
    }
  class ExternalPool {
    constructor() {
      this.ends = 0;
      this.connectError = new Error("FAKE_EXTERNAL_CALLER_OWNS_POOL");
      this.connects = 0;
    }
    end() {
      this.ends++;
      throw new Error("CALLER_POOL_MUST_NOT_BE_ENDED");
    }
    query() {
      return Promise.resolve({ rows: [] });
    }
    connect() {
      this.connects++;
      return Promise.reject(this.connectError);
    }
  }
  for (const spec of specs) {
    const external = new ExternalPool(),
      count = created.length,
      object = spec.make(external);
    await object.close();
    await object.close();
    assert.equal(external.ends, 0);
    assert.equal(created.length, count);
    assert.deepEqual((await external.query()).rows, []);
    assert.equal(Object.hasOwn(external, "Client"), false);
    externalCases++;
  }
  const scope = {
    schemaVersion: 1,
    grantId: "50000000-0000-4000-8000-000000000001",
    tenantId: "20000000-0000-4000-8000-000000000001",
    workspaceId: "30000000-0000-4000-8000-000000000001",
    principalId: "10000000-0000-4000-8000-000000000001",
    capabilities: Object.values(FRAME_STORE_CAPABILITIES),
    authorityVersion: "authority-v1",
    scopeVersion: "scope-v1",
    authorityDigest: "sha256:fixture",
    verifiedAt: "2026-07-22T00:00:00.000Z",
  };
  {
    const pool = new ExternalPool(),
      backend = new PostgresScopedFrameStoreBackend(pool, { schema: "lex_owner_test" });
    const first = backend.bind(scope),
      second = backend.bind(scope);
    await first.close();
    assert.throws(() => first.getMetadata());
    assert.equal(second.getMetadata().backend, "postgres");
    assert.equal(pool.ends, 0);
    await backend.close();
    assert.throws(() => second.getMetadata());
    logicalCases++;
  }
  {
    const pool = new ExternalPool(),
      backend = new PostgresFrameStoreAdministration(pool, { schema: "lex_owner_test" });
    const first = backend.bindAdmin(scope),
      second = backend.bindAdmin(scope);
    await first.close();
    assert.throws(() => first.getMetadata());
    assert.equal(second.getMetadata().backend, "postgres");
    assert.equal(pool.ends, 0);
    await backend.close();
    logicalCases++;
  }
  {
    const pool = new ExternalPool(),
      backend = new PostgresBehavioralStoreBackend(pool, { schema: "lex_owner_test" });
    const binding = {
      schemaVersion: 1,
      authorizedScope: { ...scope, capabilities: Object.values(BEHAVIORAL_STORE_CAPABILITIES) },
      repositoryId: "40000000-0000-4000-8000-000000000001",
      repositoryInstanceId: "60000000-0000-4000-8000-000000000001",
    };
    const first = backend.bindRead(binding),
      second = backend.bindRead(binding);
    await first.close();
    await assert.rejects(
      first.getSnapshot(),
      (error) => error.code === "LEX_BEHAVIORAL_STORE_CLOSED"
    );
    await assert.rejects(second.getSnapshot(), (error) => error === pool.connectError);
    assert.equal(pool.ends, 0);
    await backend.close();
    logicalCases++;
  }
  // eslint-disable-next-line no-console -- bounded JSON result for the isolated parent test
  console.log(
    JSON.stringify({
      result: "PASS_ACTUAL_OWNER_WRAPPERS_FAKE_RESOURCES",
      physicalCases,
      externalCases,
      logicalCases,
      actualCompiledCore: true,
      moduleMock: "private factory only in isolated process",
      databaseOrNetwork: false,
      productFixQualified: false,
    })
  );
} finally {
  replacement.restore();
}
