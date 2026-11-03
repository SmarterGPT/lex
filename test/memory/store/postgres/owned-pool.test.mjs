import assert from "node:assert/strict";
import { test } from "node:test";
import { createOwnedPool } from "../../../../dist/memory/store/postgres/owned-pool.js";

// Pure fakes only. No fs, pg, Lex, network, child_process or Docker imports.
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const originalError = () => Object.assign(new Error("FAKE_AUTH_ONLY"), { code: "28P01" });
function fixture({ max = 10, end = "sync", poolEnd = "resolve", PromiseType = Promise } = {}) {
  let now = 0,
    timerId = 0,
    fired = 0,
    baseCalls = 0,
    networkStarts = 0,
    poolEnds = 0,
    owner;
  const timers = new Map(),
    queue = [],
    clients = [],
    trace = [];
  const setTimer = (fn, delay) => {
    const id = ++timerId;
    timers.set(id, { at: now + delay, fn });
    return id;
  };
  const clearTimer = (id) => timers.delete(id);
  class FakeClient {
    constructor(config) {
      this.config = config;
      this.endMode = end;
      this.ends = 0;
      this.endCallbacks = [];
      clients.push(this);
    }
    connect(callback) {
      baseCalls++;
      trace.push("base.connect");
      if (this.attempted) {
        const e = (this.reuseError ??= originalError());
        queue.push(() => callback.call(this, e));
        return;
      }
      assert.ok(owner.snapshot().activeReservations > 0, "Reservation must precede base connect");
      this.attempted = true;
      networkStarts++;
      this.callback = callback;
      if (this.throwConnect) throw this.throwConnect;
    }
    end(callback) {
      this.ends++;
      trace.push("base.end");
      if (owner?.snapshot().phases.cleanupPending) {
        assert.ok(
          [...timers.values()].some((t) => t.at === now + 2000),
          "Observer must precede cleanup end"
        );
      }
      if (this.endMode === "throw") throw originalError();
      if (this.endMode === "error") {
        callback(originalError());
        return;
      }
      if (this.endMode === "sync") {
        callback();
        return;
      }
      this.endCallbacks.push(callback);
    }
  }
  class FakePool {
    constructor(config) {
      this.config = config;
    }
    client() {
      return new this.config.Client(this.config);
    }
    end() {
      poolEnds++;
      trace.push("pool.end");
      if (poolEnd === "throw") throw (this.endError ??= originalError());
      if (poolEnd === "reject") return PromiseType.reject((this.endError ??= originalError()));
      return PromiseType.resolve();
    }
  }
  const password = () => Promise.resolve("FAKE_VALUE_NEVER_LOGGED");
  const config = { max, password, marker: {}, Promise: PromiseType };
  const originalKeys = Object.keys(config);
  owner = createOwnedPool({
    Client: FakeClient,
    Pool: FakePool,
    config,
    setTimer,
    clearTimer,
    enqueue: (fn) => queue.push(fn),
    PromiseType,
  });
  assert.deepEqual(Object.keys(config), originalKeys);
  assert.equal(owner.pool.config.password, password);
  function tick(delta) {
    const to = now + delta;
    while (true) {
      const item = [...timers.entries()]
        .filter(([, t]) => t.at <= to)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!item) break;
      assert.ok(++fired <= 256, "Fake timer callback budget");
      now = item[1].at;
      timers.delete(item[0]);
      item[1].fn();
    }
    now = to;
  }
  function drainQueue() {
    let n = 0;
    while (queue.length) {
      assert.ok(++n <= 256);
      queue.shift()();
    }
  }
  const observe = (promise) => {
    const value = { state: "pending" };
    promise.then(
      (result) => Object.assign(value, { state: "resolved", result }),
      (error) => Object.assign(value, { state: "rejected", error })
    );
    return value;
  };
  const start = (callback = () => {}) => {
    const c = owner.pool.client();
    c.connect(callback);
    return c;
  };
  const fail = (c, error = originalError()) =>
    c.callback.call(c, error, undefined, "FAKE_THIRD_ARGUMENT");
  const succeed = (c) => c.callback.call(c, null, c);
  const finishEnd = (c) => {
    const callbacks = c.endCallbacks.splice(0);
    for (const cb of callbacks) cb();
  };
  return {
    owner,
    FakeClient,
    FakePool,
    config,
    clients,
    trace,
    timers,
    queue,
    tick,
    drainQueue,
    observe,
    start,
    fail,
    succeed,
    finishEnd,
    get baseCalls() {
      return baseCalls;
    },
    get networkStarts() {
      return networkStarts;
    },
    get poolEnds() {
      return poolEnds;
    },
  };
}
test("owned pool lifecycle: 26 sequential fake vectors", async (context) => {
  const passed = [];
  async function vector(name, fn) {
    await context.test(name, async () => {
      await fn();
      passed.push(name);
    });
  }

  await vector(
    "callback success preserves receiver arguments config and normal ownership",
    async () => {
      const f = fixture();
      let receiver, args;
      const c = f.start(function (...v) {
        receiver = this;
        args = v;
      });
      f.succeed(c);
      assert.equal(receiver, c);
      assert.deepEqual(args, [null, c]);
      assert.equal(c.ends, 0);
      assert.equal(f.owner.snapshot().activeReservations, 0);
      assert.equal(f.owner.pool.config.max, 10);
      await f.owner.close();
      assert.equal(f.poolEnds, 1);
    }
  );
  await vector("promise success preserves Promise subclass and client identity", async () => {
    class PublicPromise extends Promise {}
    const f = fixture({ PromiseType: PublicPromise });
    const c = f.owner.pool.client();
    const p = c.connect();
    assert.ok(p instanceof PublicPromise);
    f.succeed(c);
    assert.equal(await p, c);
    assert.equal(c.ends, 0);
    await f.owner.close();
  });
  await vector(
    "error callback same Error code receiver arguments and pending-before-forward",
    async () => {
      const f = fixture();
      const e = originalError();
      let c;
      c = f.start(function (...args) {
        assert.equal(this, c);
        assert.deepEqual(args, [e, undefined, "FAKE_THIRD_ARGUMENT"]);
        assert.equal(f.owner.snapshot().phases.cleanupPending, 1);
        f.trace.push("forward.error");
      });
      f.fail(c, e);
      assert.ok(f.trace.indexOf("forward.error") < f.trace.indexOf("base.end"));
      assert.equal(c.ends, 1);
      assert.equal(f.owner.snapshot().activeReservations, 0);
      await f.owner.close();
    }
  );
  await vector("promise rejection settles with original Error before cleanup request", async () => {
    const trace = [];
    class PublicPromise extends Promise {
      constructor(fn) {
        super((resolve, reject) =>
          fn(resolve, (error) => {
            trace.push("reject");
            reject(error);
          })
        );
      }
    }
    const f = fixture({ PromiseType: PublicPromise });
    const e = originalError();
    const c = f.owner.pool.client();
    const p = c.connect();
    const state = f.observe(p);
    const oldEnd = f.FakeClient.prototype.end;
    // This is a fake class local to one vector, never pg/global patching.
    f.FakeClient.prototype.end = function (cb) {
      trace.push("end");
      return oldEnd.call(this, cb);
    };
    f.fail(c, e);
    await flush();
    assert.equal(state.error, e);
    assert.deepEqual(trace.slice(0, 2), ["reject", "end"]);
    await f.owner.close();
  });
  await vector("throwing original error callback still requests exactly one end", async () => {
    const f = fixture();
    const thrown = originalError();
    const c = f.start(() => {
      throw thrown;
    });
    assert.throws(
      () => f.fail(c),
      (error) => error === thrown
    );
    assert.equal(c.ends, 1);
    await f.owner.close();
  });
  await vector(
    "synchronous base connect throw keeps original identity and requests cleanup",
    async () => {
      const f = fixture();
      const e = originalError();
      const c = f.owner.pool.client();
      c.throwConnect = e;
      assert.throws(
        () =>
          c.connect(() => {
            assert.fail("No callback invented for base throw");
          }),
        (error) => error === e
      );
      assert.equal(c.ends, 1);
      assert.equal(f.owner.snapshot().activeReservations, 0);
      await f.owner.close();
    }
  );
  await vector(
    "close inside failure callback sees pending record and memoizes pending result",
    async () => {
      const f = fixture({ end: "manual" });
      let p;
      const c = f.start(() => {
        p = f.owner.close();
        assert.equal(f.owner.close(), p);
      });
      f.fail(c);
      const state = f.observe(p);
      await flush();
      assert.equal(state.state, "pending");
      assert.equal(c.ends, 1);
      f.finishEnd(c);
      await flush();
      assert.equal(state.state, "resolved");
      assert.equal(f.poolEnds, 1);
    }
  );
  await vector("asynchronous end never delays original authentication callback", async () => {
    const f = fixture({ end: "manual" });
    let forwarded = 0;
    const c = f.start(() => {
      forwarded++;
    });
    f.fail(c);
    assert.equal(forwarded, 1);
    assert.equal(f.owner.snapshot().phases.cleanupPending, 1);
    assert.equal(c.ends, 1);
    f.finishEnd(c);
    assert.equal(f.owner.snapshot().activeReservations, 0);
    assert.equal(f.timers.size, 0);
    await f.owner.close();
  });
  await vector("public end error latches failure and shared close rejection", async () => {
    const f = fixture({ end: "error" });
    const c = f.start();
    f.fail(c);
    const p = f.owner.close();
    assert.equal(f.owner.close(), p);
    const state = f.observe(p);
    await flush();
    assert.equal(state.state, "rejected");
    assert.equal(state.error.code, "LEX_POSTGRES_CLEANUP_UNCERTAIN");
    assert.equal(f.owner.snapshot().phases.uncertain, 1);
    assert.equal(c.ends, 1);
    assert.equal(f.timers.size, 0);
  });
  await vector(
    "public end throw latches uncertainty without masking forwarded auth error",
    async () => {
      const f = fixture({ end: "throw" });
      const e = originalError();
      let caught;
      const c = f.start((error) => {
        caught = error;
      });
      f.fail(c, e);
      assert.equal(caught, e);
      assert.equal(f.owner.snapshot().uncertain, true);
      await assert.rejects(f.owner.close(), { code: "LEX_POSTGRES_CLEANUP_UNCERTAIN" });
      assert.equal(c.ends, 1);
    }
  );
  await vector(
    "end deadline uncertainty remains latched through late completion and new refusal",
    async () => {
      const f = fixture({ end: "manual" });
      const c = f.start();
      f.fail(c);
      f.tick(1999);
      assert.equal(f.owner.snapshot().uncertain, false);
      f.tick(1);
      assert.equal(f.owner.snapshot().uncertain, true);
      f.finishEnd(c);
      assert.equal(f.owner.snapshot().activeReservations, 1);
      assert.equal(f.owner.snapshot().counters.lateEndObserved, 1);
      const before = f.baseCalls;
      let refused;
      f.start((error) => {
        refused = error;
      });
      assert.equal(refused, undefined);
      f.drainQueue();
      assert.equal(refused.code, "LEX_POSTGRES_CLEANUP_UNCERTAIN");
      assert.equal(f.baseCalls, before);
      const p = f.owner.close();
      await assert.rejects(p, { code: "LEX_POSTGRES_CLEANUP_UNCERTAIN" });
      assert.equal(f.owner.close(), p);
    }
  );
  await vector(
    "already underway public end race adds no second owner cleanup request",
    async () => {
      const f = fixture({ end: "manual" });
      const c = f.start();
      let normalEnd = false;
      c.end(() => {
        normalEnd = true;
      });
      f.fail(c);
      assert.equal(c.ends, 2);
      assert.equal(f.owner.snapshot().counters.cleanupRequested, 1);
      f.finishEnd(c);
      assert.equal(normalEnd, true);
      assert.equal(f.owner.snapshot().activeReservations, 0);
      await f.owner.close();
    }
  );
  await vector(
    "server-close race permits public end noop without overriding normal end",
    async () => {
      const f = fixture({ end: "manual" });
      const c = f.start(() => {
        c.endMode = "sync";
      });
      f.fail(c);
      assert.equal(c.ends, 1);
      assert.equal(f.owner.snapshot().uncertain, false);
      assert.equal(f.owner.snapshot().activeReservations, 0);
      await f.owner.close();
    }
  );
  await vector("64 sequential timely failures retire and allow later recovery", async () => {
    const f = fixture({ max: 1 });
    for (let i = 0; i < 64; i++) {
      const c = f.start();
      f.fail(c);
      assert.equal(f.owner.snapshot().activeReservations, 0);
    }
    const c = f.start();
    f.succeed(c);
    const s = f.owner.snapshot();
    assert.equal(s.counters.cleanupCompleted, 64);
    assert.equal(s.counters.reserved, 65);
    assert.equal(s.uncertain, false);
    assert.equal(s.counters.capacityRefused, 0);
    assert.equal(f.timers.size, 0);
    await f.owner.close();
  });
  await vector("M64 healthy simultaneous starts retain unchanged concurrency", async () => {
    const f = fixture({ max: 64 });
    const all = Array.from({ length: 64 }, () => f.start());
    assert.equal(f.baseCalls, 64);
    assert.equal(f.owner.snapshot().phases.connecting, 64);
    for (const c of all) f.succeed(c);
    assert.equal(f.owner.snapshot().activeReservations, 0);
    await f.owner.close();
  });
  await vector(
    "32 pending cleanups plus full M connecting starts fit and reserve before failure",
    async () => {
      const f = fixture({ max: 10, end: "manual" });
      const bad = [];
      for (let i = 0; i < 32; i++) {
        const c = f.start();
        f.fail(c);
        bad.push(c);
      }
      const batch = Array.from({ length: 10 }, () => f.start());
      assert.equal(f.baseCalls, 42);
      assert.equal(f.owner.snapshot().activeReservations, 42);
      for (const c of batch) f.fail(c);
      assert.equal(f.owner.snapshot().phases.cleanupPending, 42);
      for (const c of [...bad, ...batch]) f.finishEnd(c);
      assert.equal(f.owner.snapshot().activeReservations, 0);
      await f.owner.close();
    }
  );
  await vector("M64 normal concurrency remains available with32 pending failures", async () => {
    const f = fixture({ max: 64, end: "manual" });
    const bad = [];
    for (let i = 0; i < 32; i++) {
      const c = f.start();
      f.fail(c);
      bad.push(c);
    }
    const batch = Array.from({ length: 64 }, () => f.start());
    assert.equal(f.baseCalls, 96);
    for (const c of batch) f.succeed(c);
    assert.equal(f.owner.snapshot().activeReservations, 32);
    for (const c of bad) f.finishEnd(c);
    await f.owner.close();
  });
  await vector("entire pre-reserved M64 failure batch remains bounded at M plus32", async () => {
    const f = fixture({ max: 64, end: "manual" });
    const all = [];
    for (let i = 0; i < 32; i++) {
      const c = f.start();
      f.fail(c);
      all.push(c);
    }
    const batch = Array.from({ length: 64 }, () => f.start());
    for (const c of batch) f.fail(c);
    all.push(...batch);
    assert.equal(f.owner.snapshot().activeReservations, 96);
    assert.equal(f.owner.snapshot().counters.cleanupRequested, 96);
    let error;
    f.start((e) => {
      error = e;
    });
    f.drainQueue();
    assert.equal(error.code, "LEX_POSTGRES_CAPACITY_REFUSED");
    assert.equal(f.baseCalls, 96);
    for (const c of all) f.finishEnd(c);
    await f.owner.close();
  });
  await vector(
    "repeated capacity refusals allocate no slots or synchronous queue recursion",
    async () => {
      const f = fixture({ max: 1, end: "manual" });
      const all = [];
      for (let i = 0; i < 33; i++) {
        const c = f.start();
        f.fail(c);
        all.push(c);
      }
      let refusals = 0;
      for (let i = 0; i < 64; i++)
        f.start((error) => {
          assert.equal(error.code, "LEX_POSTGRES_CAPACITY_REFUSED");
          refusals++;
        });
      assert.equal(refusals, 0);
      assert.equal(f.baseCalls, 33);
      f.drainQueue();
      assert.equal(refusals, 64);
      assert.equal(f.owner.snapshot().activeReservations, 33);
      assert.equal(f.owner.snapshot().counters.cleanupRequested, 33);
      for (const c of all) f.finishEnd(c);
      const recovered = f.start();
      f.succeed(recovered);
      await f.owner.close();
    }
  );
  await vector("pool end throw or rejection memoizes exact original close failure", async () => {
    for (const poolEnd of ["throw", "reject"]) {
      const f = fixture({ poolEnd });
      const p = f.owner.close();
      const state = f.observe(p);
      await flush();
      assert.equal(state.state, "rejected");
      assert.equal(state.error, f.owner.pool.endError);
      assert.equal(f.owner.close(), p);
      assert.equal(f.owner.snapshot().uncertain, true);
      assert.equal(f.poolEnds, 1);
    }
  });
  await vector("existing external pool and base prototype remain untouched", async () => {
    const f = fixture();
    const external = new f.FakePool({ Client: f.FakeClient });
    const baseConnect = f.FakeClient.prototype.connect,
      baseEnd = f.FakeClient.prototype.end;
    const c = f.start();
    f.fail(c);
    await f.owner.close();
    assert.equal(external.config.Client, f.FakeClient);
    assert.equal(external.endError, undefined);
    assert.equal(f.FakeClient.prototype.connect, baseConnect);
    assert.equal(f.FakeClient.prototype.end, baseEnd);
    assert.notEqual(f.owner.pool.config.Client, f.FakeClient);
    assert.equal(f.poolEnds, 1);
  });
  await vector(
    "unusual existing numeric maxima stay unchanged without allocation or clamp",
    async () => {
      for (const max of [2 ** 53, 1e300, 0]) {
        const f = fixture({ max });
        const c = f.start();
        f.succeed(c);
        assert.equal(f.owner.pool.config.max, max);
        assert.equal(f.owner.snapshot().effectiveMax, max || 10);
        assert.equal(f.networkStarts, 1);
        assert.equal(f.owner.snapshot().activeReservations, 0);
        await f.owner.close();
      }
    }
  );
  await vector(
    "public already-connected error delegates without ending healthy client",
    async () => {
      const f = fixture();
      const c = f.start();
      f.succeed(c);
      let error;
      c.connect((e) => {
        error = e;
      });
      f.drainQueue();
      assert.equal(error, c.reuseError);
      assert.equal(c.ends, 0);
      assert.equal(f.networkStarts, 1);
      assert.equal(f.owner.snapshot().activeReservations, 0);
      await f.owner.close();
    }
  );
  await vector(
    "close while connecting includes its later failure and refuses new base starts",
    async () => {
      const f = fixture({ end: "manual" });
      const c = f.start();
      const p = f.owner.close();
      const state = f.observe(p);
      await flush();
      assert.equal(state.state, "pending");
      const before = f.baseCalls;
      let error;
      f.start((e) => {
        error = e;
      });
      f.drainQueue();
      assert.equal(error.code, "LEX_POSTGRES_OWNER_CLOSING");
      assert.equal(f.baseCalls, before);
      f.fail(c);
      await flush();
      assert.equal(state.state, "pending");
      f.finishEnd(c);
      await flush();
      assert.equal(state.state, "resolved");
      assert.equal(f.owner.close(), p);
      assert.equal(f.owner.snapshot().activeReservations, 0);
    }
  );
  await vector(
    "pool end throw still awaits every registered cleanup before original failure",
    async () => {
      const f = fixture({ end: "manual", poolEnd: "throw" });
      const first = f.start(),
        second = f.start();
      f.fail(first);
      f.fail(second);
      const p = f.owner.close(),
        state = f.observe(p);
      assert.equal(f.owner.close(), p);
      await flush();
      assert.equal(state.state, "pending");
      assert.equal(f.owner.snapshot().uncertain, true);
      assert.equal(f.owner.snapshot().phases.cleanupPending, 2);
      f.finishEnd(first);
      await flush();
      assert.equal(state.state, "pending");
      assert.equal(f.owner.snapshot().phases.cleanupPending, 1);
      f.finishEnd(second);
      await flush();
      assert.equal(state.state, "rejected");
      assert.equal(state.error, f.owner.pool.endError);
      assert.equal(f.owner.close(), p);
      assert.equal(f.owner.snapshot().activeReservations, 0);
      assert.equal(f.owner.snapshot().uncertain, true);
      assert.equal(first.ends, 1);
      assert.equal(second.ends, 1);
      assert.equal(f.timers.size, 0);
      assert.equal(f.poolEnds, 1);
    }
  );
  await vector(
    "pool end rejection observes bounded cleanup timeout and retains primary failure",
    async () => {
      const f = fixture({ end: "manual", poolEnd: "reject" });
      const first = f.start(),
        second = f.start();
      f.fail(first);
      f.fail(second);
      const p = f.owner.close(),
        state = f.observe(p);
      await flush();
      assert.equal(state.state, "pending");
      f.finishEnd(first);
      f.tick(1999);
      await flush();
      assert.equal(state.state, "pending");
      assert.equal(f.owner.close(), p);
      f.tick(1);
      await flush();
      assert.equal(state.state, "rejected");
      assert.equal(state.error, f.owner.pool.endError);
      assert.equal(f.owner.snapshot().activeReservations, 1);
      assert.equal(f.owner.snapshot().phases.uncertain, 1);
      assert.equal(f.owner.snapshot().counters.cleanupCompleted, 1);
      assert.equal(f.owner.snapshot().counters.cleanupUncertain, 1);
      f.finishEnd(second);
      await flush();
      assert.equal(f.owner.close(), p);
      assert.equal(state.error, f.owner.pool.endError);
      assert.equal(f.owner.snapshot().activeReservations, 1);
      assert.equal(f.owner.snapshot().uncertain, true);
      assert.equal(first.ends, 1);
      assert.equal(second.ends, 1);
      assert.equal(f.timers.size, 0);
      assert.equal(f.poolEnds, 1);
    }
  );
  assert.equal(passed.length, 26);
});
