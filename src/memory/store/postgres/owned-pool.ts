import { Client, Pool, type PoolConfig } from "pg";

// Internal public-API binding types. The core only uses connect/end; the fixed
// production binding below selects actual pg and never accepts caller factories.
type ConnectCallback = (this: LifecycleClient, ...args: unknown[]) => unknown;
interface LifecycleClient {
  connect(callback?: ConnectCallback | null): unknown;
  end(callback: (error?: unknown) => void): unknown;
}
interface LifecycleClientConstructor {
  new (...args: unknown[]): LifecycleClient;
  readonly prototype: LifecycleClient;
}
interface LifecyclePool {
  end(): unknown;
}
type OwnedPoolConfig = Omit<PoolConfig, "Client"> & { poolSize?: number };
interface LifecyclePoolConstructor<TPool extends LifecyclePool> {
  new (config: OwnedPoolConfig & { Client: LifecycleClientConstructor }): TPool;
}
interface CleanupRecord {
  client: LifecycleClient;
  phase: "connecting" | "cleanup-pending" | "uncertain" | "closed" | "pool-owned";
  done: Promise<void>;
  complete: (() => void) | undefined;
  cleanupRequested: boolean;
  cleanupTerminal: boolean;
  lateEndObserved: boolean;
  timer: unknown;
}
interface OwnedPoolDependencies<TPool extends LifecyclePool> {
  Client: LifecycleClientConstructor;
  Pool: LifecyclePoolConstructor<TPool>;
  config: OwnedPoolConfig;
  setTimer?: (callback: () => void, delay: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  enqueue?: (callback: () => void) => void;
  PromiseType?: PromiseConstructor;
}

// Internal owned-pool lifecycle core, ported from qualified artifact EFDF3CD7.
// No global patches or private pg state; only public Client connect/end.
export function createOwnedPool<TPool extends LifecyclePool>({
  Client,
  Pool,
  config,
  setTimer = setTimeout,
  clearTimer = clearTimeout as unknown as (handle: unknown) => void,
  enqueue = queueMicrotask,
  PromiseType = (config.Promise as PromiseConstructor | undefined) || Promise,
}: OwnedPoolDependencies<TPool>) {
  const effectiveMax = config.max || config.poolSize || 10;
  if (typeof effectiveMax !== "number" || !Number.isInteger(effectiveMax) || effectiveMax <= 0) {
    throw new TypeError("owned_pool_requires_existing_positive_integer_max");
  }
  const records = new Map<LifecycleClient, CleanupRecord>(),
    states = new WeakMap<LifecycleClient, { started: boolean }>();
  const counters = {
    reserved: 0,
    connected: 0,
    connectFailed: 0,
    cleanupRequested: 0,
    cleanupCompleted: 0,
    cleanupUncertain: 0,
    capacityRefused: 0,
    ownerRefused: 0,
    lateEndObserved: 0,
  };
  let saturated = false,
    uncertain = false,
    closing = false,
    closePromise: Promise<void> | undefined;
  const count = (name: keyof typeof counters) => {
    if (counters[name] < 0xffffffff) counters[name]++;
    else saturated = true;
  };
  const failure = (code: string) => Object.assign(new Error(code), { code });
  const uncertaintyError = failure("LEX_POSTGRES_CLEANUP_UNCERTAIN");
  // Avoid M+32 floating-point rounding/clamping. Map.size is the exact current
  // count; compare with the existing numeric M before applying the extra32.
  const hasCapacity = () => records.size < effectiveMax || records.size - effectiveMax < 32;
  function reserve(client: LifecycleClient): CleanupRecord | null {
    if (closing || uncertain) {
      count("ownerRefused");
      return null;
    }
    if (!hasCapacity()) {
      count("capacityRefused");
      return null;
    }
    let complete: (() => void) | undefined;
    const done = new PromiseType<void>((resolve) => {
      complete = resolve;
    });
    const record: CleanupRecord = {
      client,
      phase: "connecting",
      done,
      complete,
      cleanupRequested: false,
      cleanupTerminal: false,
      lateEndObserved: false,
      timer: undefined,
    };
    records.set(client, record);
    count("reserved");
    return record;
  }
  function markUncertain(record: CleanupRecord) {
    if (record.cleanupTerminal) return;
    record.cleanupTerminal = true;
    record.phase = "uncertain";
    uncertain = true;
    clearTimer(record.timer);
    count("cleanupUncertain");
    record.complete!();
    // The bounded record remains owned. No late settlement erases uncertainty.
  }
  function cleanup(record: CleanupRecord) {
    if (record.cleanupRequested) return;
    record.cleanupRequested = true;
    count("cleanupRequested");
    // Observe before public end, which may call back synchronously or throw.
    record.timer = setTimer(() => markUncertain(record), 2000);
    const ended = (error?: unknown) => {
      if (record.cleanupTerminal) {
        if (record.phase === "uncertain" && !record.lateEndObserved) {
          record.lateEndObserved = true;
          count("lateEndObserved");
        }
        return;
      }
      if (error) {
        markUncertain(record);
        return;
      }
      record.cleanupTerminal = true;
      record.phase = "closed";
      clearTimer(record.timer);
      records.delete(record.client);
      count("cleanupCompleted");
      record.complete!();
    };
    try {
      Client.prototype.end.call(record.client, ended);
    } catch {
      markUncertain(record);
    }
  }
  function connectFailed(record: CleanupRecord, forward: () => unknown) {
    // record.done was allocated before base connect. This phase is visible to
    // close() called synchronously from the original error callback.
    record.phase = "cleanup-pending";
    count("connectFailed");
    try {
      return forward();
    } finally {
      cleanup(record);
    }
  }
  class OwnedClient extends Client {
    constructor(...args: unknown[]) {
      super(...args);
      states.set(this, { started: false });
    }
    connect(callback?: ConnectCallback | null): unknown {
      const client = this,
        state = states.get(client)!;
      // pg.Client initial connect is single-use. Subsequent calls retain the
      // base public already-connected error contract, never another cleanup.
      if (state.started)
        return Client.prototype.connect.apply(client, arguments as unknown as [ConnectCallback?]);
      const callbackMode = typeof callback === "function";
      const perform = (forward: (receiver: unknown, args: unknown[]) => unknown) => {
        const record = reserve(client);
        if (!record) {
          const code = uncertain
            ? "LEX_POSTGRES_CLEANUP_UNCERTAIN"
            : closing
              ? "LEX_POSTGRES_OWNER_CLOSING"
              : "LEX_POSTGRES_CAPACITY_REFUSED";
          // No base connect or ledger allocation on refusal; no synchronous
          // pool-queue recursion. This client has not started a network attempt.
          enqueue(() => forward(undefined, [failure(code)]));
          return;
        }
        state.started = true;
        let completed = false;
        function bridge(this: LifecycleClient, ...args: unknown[]) {
          if (completed) return;
          completed = true;
          if (args[0]) return connectFailed(record!, () => forward(this, args));
          record!.phase = "pool-owned";
          records.delete(client);
          count("connected");
          record!.complete!();
          return forward(this, args);
        }
        try {
          Client.prototype.connect.call(client, bridge);
        } catch (error) {
          // A thrown user callback already completed the connect bridge. Its
          // finally requested cleanup if appropriate; never request it twice.
          if (completed) throw error;
          completed = true;
          return connectFailed(record, () => {
            if (callbackMode) throw error;
            return forward(undefined, [error]);
          });
        }
      };
      if (callbackMode)
        return perform((receiver, args) => Reflect.apply(callback!, receiver, args));
      return new PromiseType((resolve, reject) =>
        perform((_receiver, args) => {
          if (args[0]) reject(args[0]);
          else resolve(client);
        })
      );
    }
  }
  // Only this new pool receives the private class; config and its auth values
  // are otherwise forwarded unchanged, never interpreted as password policy.
  const pool = new Pool({ ...config, Client: OwnedClient });
  function close(): Promise<void> {
    if (closePromise) return closePromise;
    closing = true;
    let resolve: (() => void) | undefined, reject: ((error: unknown) => void) | undefined;
    closePromise = new PromiseType<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // Memoize before pool.end can synchronously reenter close from a callback.
    const observeRegistered = async (poolFailed: boolean, poolError?: unknown) => {
      // Closing prevents new reservations. Existing connecting records can only
      // transfer to cleanup or normal pool ownership, never become unaccounted.
      // Observe them on BOTH pool-end outcomes; a failure cannot skip their
      // existing bounded cleanup observers or settle owner close prematurely.
      await PromiseType.all([...records.values()].map((record) => record.done));
      if (poolFailed) throw poolError; // Preserve the primary pool error identity.
      if (uncertain || records.size) throw uncertaintyError;
    };
    let poolEnd: Promise<unknown>;
    try {
      poolEnd = PromiseType.resolve(pool.end());
    } catch (error) {
      uncertain = true;
      poolEnd = PromiseType.reject!(error);
    }
    poolEnd
      .then(
        () => observeRegistered(false),
        (error) => {
          uncertain = true;
          return observeRegistered(true, error);
        }
      )
      .then(resolve, (error) => {
        uncertain = true;
        reject!(error);
      });
    return closePromise;
  }
  function snapshot() {
    const phases = { connecting: 0, cleanupPending: 0, uncertain: 0 };
    for (const record of records.values()) {
      if (record.phase === "connecting") phases.connecting++;
      else if (record.phase === "cleanup-pending") phases.cleanupPending++;
      else if (record.phase === "uncertain") phases.uncertain++;
    }
    return {
      effectiveMax,
      extraFailureAllowance: 32,
      activeReservations: records.size,
      phases,
      uncertain,
      closing,
      counters: { ...counters },
      countersSaturated: saturated,
    };
  }
  return { pool, close, snapshot };
}

/** Create only an internally owned pg pool. Caller-supplied pools never enter here. */
export function createOwnedPostgresPool(config: PoolConfig): {
  pool: Pool;
  close: () => Promise<void>;
} {
  // The only structural casts are the fixed public pg constructors. They expose
  // no generic factory through store options and access no private pg members.
  const owner = createOwnedPool({
    Client: Client as unknown as LifecycleClientConstructor,
    Pool: Pool as unknown as LifecyclePoolConstructor<Pool>,
    config,
  });
  return { pool: owner.pool, close: owner.close };
}
