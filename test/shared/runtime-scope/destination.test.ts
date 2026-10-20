import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, mock } from "node:test";
import type { Pool } from "pg";
import { MCP_TOOLS } from "../../../src/memory/mcp_server/tools.js";
import { MCPServer } from "../../../src/memory/mcp_server/server.js";
import { MemoryScopedFrameStoreBackend } from "../../../src/memory/store/memory/index.js";
import {
  PostgresScopedFrameStoreBackend,
  type ScopedFrameStoreBinder,
} from "../../../src/memory/store/index.js";
import { run } from "../../../src/shared/cli/index.js";
import {
  createDestinationSnapshot,
  assertExpectedDestination,
  verifiedBackendIdentity,
  UNVERIFIED_BACKEND_IDENTITY,
  capabilitiesForCliOperation,
  capabilitiesForMcpTool,
  type AuthorizedScopeV1,
  type DestinationSnapshotV1,
  type InvocationContextV1,
  type TrustedRuntimeScopeEntrypointGuardV1,
} from "../../../src/shared/runtime-scope/index.js";

const backendEvidence = {
  identity: `postgres-live-v1:sha256:${"a".repeat(64)}`,
  verifiedAt: "2026-10-20T12:00:00.000Z",
  connectionClass: "loopback" as const,
};
const backend = { kind: "postgres" as const, identity: verifiedBackendIdentity(backendEvidence) };
function scope(overrides: Partial<AuthorizedScopeV1> = {}): AuthorizedScopeV1 {
  return {
    schemaVersion: 1,
    grantId: "grant-1" as never,
    tenantId: "01900000-0000-7000-8000-000000000001" as never,
    workspaceId: "01900000-0000-7000-8000-000000000101" as never,
    principalId: "01900000-0000-7000-8000-000000000201" as never,
    capabilities: capabilitiesForCliOperation("remember"),
    authorityVersion: "v1" as never,
    scopeVersion: "v1" as never,
    authorityDigest: "sha256:authority" as never,
    verifiedAt: "2026-10-20T12:00:00.000Z",
    ...overrides,
  };
}
function invocation(root = "/repo"): InvocationContextV1 {
  return {
    schemaVersion: 1,
    projectRoot: root,
    requestedWorkspace: { workspaceId: "01900000-0000-7000-8000-000000000101" as never },
    repositoryEvidence: { schemaVersion: 1, canonicalRoot: root },
    binding: {
      schemaVersion: 1,
      bindingId: "binding-1" as never,
      registryInstanceId: "registry-1" as never,
      executionSurfaceId: "surface-1" as never,
      workspaceInstanceId: "workspace-instance-1" as never,
      repositoryInstanceId: "repository-instance-1" as never,
      tenantId: "01900000-0000-7000-8000-000000000001" as never,
      workspaceId: "01900000-0000-7000-8000-000000000101" as never,
      repositoryId: "repository-1" as never,
      evidence: { schemaVersion: 1, canonicalRoot: root },
      state: "active",
      createdAt: "2026-10-20T12:00:00.000Z",
    },
    runtimeSurface: {
      schemaVersion: 1,
      executionSurfaceId: "surface-1" as never,
      registryInstanceId: "registry-1" as never,
      runtimeId: "runtime-1" as never,
    },
  };
}

test("unverified injected pools have explicit unknown backend and distinct diagnostic identities", async () => {
  const one = new PostgresScopedFrameStoreBackend({} as Pool, { schema: "lex_store" });
  const two = new PostgresScopedFrameStoreBackend({} as Pool, { schema: "lex_store" });
  try {
    const a = one.bind(scope()).getMetadata();
    const b = two.bind(scope()).getMetadata();
    assert.deepEqual(a.backendIdentity, UNVERIFIED_BACKEND_IDENTITY);
    assert.match(a.identity, /^postgres-scoped-unverified:/);
    assert.notEqual(a.identity, b.identity);
    assert.equal(
      createDestinationSnapshot(invocation(), scope(), {
        kind: a.backend,
        identity: a.backendIdentity!,
        namespace: a.namespace,
      }).identity,
      null
    );
  } finally {
    await one.close();
    await two.close();
  }
});

test("verified pool identity is supplied explicitly, cloned, and separated from scoped destination identity", async () => {
  const one = new PostgresScopedFrameStoreBackend({} as Pool, {
    schema: "lex_store",
    verifiedBackend: backendEvidence,
  });
  const two = new PostgresScopedFrameStoreBackend({} as Pool, {
    schema: "lex_store",
    verifiedBackend: { ...backendEvidence, identity: `postgres-live-v1:sha256:${"b".repeat(64)}` },
  });
  try {
    const a = one.bind(scope()).getMetadata();
    const b = two.bind(scope()).getMetadata();
    assert.equal(a.identity, backendEvidence.identity);
    assert.notEqual(a.identity, b.identity);
    assert.notEqual(createDestinationSnapshot(invocation(), scope(), backend).identity, a.identity);
    assert.notEqual(
      createDestinationSnapshot(invocation(), scope(), backend).identity,
      createDestinationSnapshot(invocation(), scope(), {
        kind: b.backend,
        identity: b.backendIdentity!,
        namespace: b.namespace,
      }).identity
    );
    assert.equal(Object.isFrozen(a.backendIdentity), true);
  } finally {
    await one.close();
    await two.close();
  }
});

test("trusted backend evidence rejects URLs, malformed fingerprints and noncanonical timestamps", () => {
  for (const identity of [
    "postgres://user:password@host/db",
    "postgres-scoped-v3:placeholder",
    "",
  ]) {
    assert.throws(
      () => verifiedBackendIdentity({ ...backendEvidence, identity }),
      /Invalid trusted backend/
    );
  }
  for (const verifiedAt of ["yesterday", "2026-10-20T12:00:00Z", ""]) {
    assert.throws(
      () => verifiedBackendIdentity({ ...backendEvidence, verifiedAt }),
      /Invalid trusted backend/
    );
  }
});

test("destination identity is stable across timestamps and capability ordering, changes for scope and authority", () => {
  const original = createDestinationSnapshot(invocation(), scope(), backend);
  assert.equal(
    original.identity,
    createDestinationSnapshot(
      invocation(),
      scope({
        verifiedAt: "2026-10-21T12:00:00.000Z",
        capabilities: [...scope().capabilities].reverse(),
      }),
      backend
    ).identity
  );
  for (const changes of [
    { principalId: "other" },
    { authorityVersion: "v2" },
    { authorityDigest: "sha256:other" },
    { grantId: "grant-2" },
    { scopeVersion: "v2" },
    { capabilities: ["frame:read"] },
  ]) {
    assert.notEqual(
      original.identity,
      createDestinationSnapshot(invocation(), scope(changes as Partial<AuthorizedScopeV1>), backend)
        .identity
    );
  }
  const otherWorkspace = invocation();
  assert.notEqual(
    original.identity,
    createDestinationSnapshot(
      {
        ...otherWorkspace,
        binding: { ...otherWorkspace.binding!, workspaceId: "workspace-2" as never },
      },
      scope({ workspaceId: "workspace-2" as never }),
      backend
    ).identity
  );
  assert.notEqual(
    original.identity,
    createDestinationSnapshot(invocation("/other"), scope(), backend).identity
  );
  const otherRepo = invocation();
  assert.notEqual(
    original.identity,
    createDestinationSnapshot(
      { ...otherRepo, binding: { ...otherRepo.binding!, repositoryId: "repository-2" as never } },
      scope(),
      backend
    ).identity
  );
});

test("expected destination never grants authority and rejects unknown, mismatched, expired and unbound snapshots", () => {
  const snapshot = createDestinationSnapshot(invocation(), scope(), backend);
  assert.doesNotThrow(() => assertExpectedDestination(snapshot, snapshot.identity));
  assert.throws(() => assertExpectedDestination(undefined, snapshot.identity), /does not match/);
  assert.throws(
    () => assertExpectedDestination({ ...snapshot, identity: null }, snapshot.identity),
    /does not match/
  );
  assert.throws(
    () => assertExpectedDestination(snapshot, "lex-destination-v1:sha256:" + "f".repeat(64)),
    /does not match/
  );
  assert.throws(
    () =>
      assertExpectedDestination(
        { ...snapshot, expiresAt: "2000-01-01T00:00:00.000Z" },
        snapshot.identity
      ),
    /expired/
  );
  assert.throws(
    () => createDestinationSnapshot({ ...invocation(), binding: undefined }, scope(), backend),
    /matching authorized/
  );
  assert.throws(
    () =>
      createDestinationSnapshot(invocation(), scope({ workspaceId: "other" as never }), backend),
    /matching authorized/
  );
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "lex-destination-"));
  const memory = new MemoryScopedFrameStoreBackend();
  const counts = { list: 0, health: 0, save: 0, close: 0 };
  let currentEvidence = backendEvidence;
  let version = "v1";
  let metadataThrows = false;
  let verified = true;
  const requests: string[][] = [];
  const binder: ScopedFrameStoreBinder = {
    bind(authorizedScope) {
      const store = memory.bind(authorizedScope);
      store.getMetadata = () => {
        if (metadataThrows) throw new Error("metadata unavailable");
        return {
          backend: "postgres",
          location: "injected",
          canonicalLocation: "injected",
          identity: currentEvidence.identity,
          backendIdentity: verified
            ? verifiedBackendIdentity(currentEvidence)
            : UNVERIFIED_BACKEND_IDENTITY,
          namespace: "lex_store",
          capabilities: { encryption: false, images: false },
        };
      };
      const list = store.listFrames.bind(store);
      store.listFrames = async (options) => {
        counts.list++;
        return list(options);
      };
      store.getHealth = async () => {
        counts.health++;
        throw new Error("preflight must not probe health");
      };
      const save = store.saveFrame.bind(store);
      store.saveFrame = async (frame) => {
        counts.save++;
        return save(frame);
      };
      const close = store.close.bind(store);
      store.close = async () => {
        counts.close++;
        return close();
      };
      return store;
    },
  };
  const guard: TrustedRuntimeScopeEntrypointGuardV1 = {
    request: {
      schemaVersion: 1,
      bootstrap: {
        schemaVersion: 1,
        cwd: root,
        argv: ["node", "lex"],
        allowedEnvironment: {},
        platform: "win32",
        capturedAt: "2026-10-20T12:00:00.000Z",
        executionSurface: {
          schemaVersion: 1,
          nativePlatform: "win32",
          kind: "windows-native",
          installationRef: "test-node",
          evidenceDigest: "sha256:surface" as never,
        },
      },
      runtimeId: "runtime-1" as never,
      traceId: "trace-1" as never,
    },
    bootstrap: {
      async resolve(request) {
        requests.push([...request.requestedCapabilities]);
        return {
          resolved: true,
          invocationContext: invocation(root),
          authorizedScope: scope({
            capabilities: request.requestedCapabilities,
            authorityVersion: version as never,
          }),
        };
      },
    },
  };
  return {
    root,
    memory,
    counts,
    binder,
    guard,
    requests,
    changeBackend() {
      currentEvidence = {
        ...backendEvidence,
        identity: `postgres-live-v1:sha256:${"b".repeat(64)}`,
      };
    },
    changeAuthority() {
      version = "v2";
    },
    removeVerification() {
      verified = false;
    },
    breakMetadata() {
      metadataThrows = true;
    },
    async close() {
      await memory.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
async function cli(f: ReturnType<typeof fixture>, args: string[], trusted = true) {
  const output: string[] = [];
  const write = mock.method(process.stdout, "write", (chunk: string) => {
    output.push(String(chunk));
    return true;
  });
  const errorWrite = mock.method(process.stderr, "write", (chunk: string) => {
    output.push(String(chunk));
    return true;
  });
  const previousExitCode = process.exitCode;
  try {
    await run(
      ["node", "lex", "--json", ...args],
      trusted
        ? {
            runtimeScope: { ...f.guard, frameStoreBinder: f.binder, emitDiagnostics() {} },
          }
        : {}
    );
    return output
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .at(-1);
  } finally {
    write.mock.restore();
    errorWrite.mock.restore();
    process.exitCode = previousExitCode;
  }
}
const rememberArgs = [
  "remember",
  "--summary",
  "safe test",
  "--reference-point",
  "test",
  "--next",
  "continue",
  "--modules",
  "unscoped",
  "--skip-policy",
];
const frameArgs = {
  reference_point: "test",
  summary_caption: "safe test",
  status_snapshot: { next_action: "continue" },
  module_scope: ["workspace/unscoped"],
};

test("CLI and MCP preflights use actual intended-write capabilities with zero frame access and identical destination", async () => {
  const f = fixture();
  const server = new MCPServer({ runtimeScope: f.guard, frameStoreBinder: f.binder });
  try {
    const cliPreflight = await cli(f, ["destination"]);
    const mcpPreflight = await server.handleRequest({
      method: "tools/call",
      params: { name: "destination_inspect", arguments: {} },
    });
    assert.equal(mcpPreflight.error, undefined);
    assert.deepEqual(cliPreflight.data.destination, mcpPreflight.data?.destination);
    assert.deepEqual(f.counts, { list: 0, health: 0, save: 0, close: 2 });
    assert.deepEqual(f.requests, [
      capabilitiesForCliOperation("remember"),
      capabilitiesForMcpTool("frame_create"),
    ]);
    const expected = cliPreflight.data.destination.identity;
    const receipt = await cli(f, [...rememberArgs, "--expected-destination", expected]);
    assert.equal(receipt.code, "FRAME_CREATED");
    assert.deepEqual(receipt.data.destination, cliPreflight.data.destination);
    const mcpReceipt = await server.handleRequest({
      method: "tools/call",
      params: { name: "frame_create", arguments: { ...frameArgs, expected_destination: expected } },
    });
    assert.equal(mcpReceipt.error, undefined);
    assert.deepEqual(mcpReceipt.data?.destination, cliPreflight.data.destination);
    assert.equal(mcpReceipt.data?.storeIdentity, receipt.data.storeIdentity);
    assert.deepEqual(mcpReceipt.data?.store, receipt.data.store);
    assert.equal(f.counts.save, 2);
  } finally {
    await server.close();
    await f.close();
  }
});

test("CLI rejects backend and authority changes before any history read or write", async () => {
  for (const change of ["changeBackend", "changeAuthority"] as const) {
    const f = fixture();
    try {
      const preflight = await cli(f, ["destination"]);
      f[change]();
      const result = await cli(f, [
        ...rememberArgs,
        "--expected-destination",
        preflight.data.destination.identity,
      ]);
      assert.equal(result.code, "LEX_DESTINATION_MISMATCH");
      assert.equal(f.counts.list, 0);
      assert.equal(f.counts.save, 0);
    } finally {
      await f.close();
    }
  }
});

test("MCP rejects expected mismatch before cached success and namespaces cache by backend destination", async () => {
  const f = fixture();
  const server = new MCPServer({ runtimeScope: f.guard, frameStoreBinder: f.binder });
  const call = (name: string, args: Record<string, unknown>) =>
    server.handleRequest({ method: "tools/call", params: { name, arguments: args } });
  try {
    const preflight = await call("destination_inspect", {});
    const expected = (preflight.data?.destination as DestinationSnapshotV1).identity;
    const first = await call("frame_create", {
      ...frameArgs,
      request_id: "same",
      expected_destination: expected,
    });
    assert.equal(first.error, undefined);
    const bad = await call("frame_create", {
      ...frameArgs,
      request_id: "same",
      expected_destination: "lex-destination-v1:sha256:" + "f".repeat(64),
    });
    assert.equal(bad.error?.code, "LEX_DESTINATION_MISMATCH");
    assert.equal(f.counts.save, 1);
    f.changeBackend();
    const rebound = await call("frame_create", { ...frameArgs, request_id: "same" });
    assert.equal(rebound.error, undefined);
    assert.equal(f.counts.save, 2);
    assert.notEqual(first.data?.frame_id, rebound.data?.frame_id);
    const payload = await call("destination_inspect", { summary_caption: "unexpected payload" });
    assert.ok(payload.error);
    assert.equal(f.counts.list, 0);
  } finally {
    await server.close();
    await f.close();
  }
});

test("CLI and MCP close the request-local bound store when destination metadata fails", async () => {
  const f = fixture();
  const server = new MCPServer({ runtimeScope: f.guard, frameStoreBinder: f.binder });
  try {
    f.breakMetadata();
    await assert.rejects(() => cli(f, ["destination"]), /metadata unavailable/);
    assert.equal(f.counts.close, 1);
    const result = await server.handleRequest({
      method: "tools/call",
      params: { name: "destination_inspect", arguments: {} },
    });
    assert.ok(result.error);
    assert.equal(f.counts.close, 2);
    assert.equal(f.counts.save, 0);
  } finally {
    await server.close();
    await f.close();
  }
});

test("different configured schemas produce different destinations even when a host reuses verified evidence", async () => {
  const one = new PostgresScopedFrameStoreBackend({} as Pool, {
    schema: "first",
    verifiedBackend: backendEvidence,
  });
  const two = new PostgresScopedFrameStoreBackend({} as Pool, {
    schema: "second",
    verifiedBackend: backendEvidence,
  });
  try {
    const snapshot = (store: PostgresScopedFrameStoreBackend) => {
      const metadata = store.bind(scope()).getMetadata();
      return createDestinationSnapshot(invocation(), scope(), {
        kind: metadata.backend,
        identity: metadata.backendIdentity!,
        namespace: metadata.namespace,
      });
    };
    const a = snapshot(one);
    const b = snapshot(two);
    assert.notEqual(a.identity, b.identity);
    assert.equal(a.backend.namespace, "first");
    assert.equal(b.backend.namespace, "second");
  } finally {
    await one.close();
    await two.close();
  }
});

test("frame permissions, provenance and backend fields cannot promote an unverified host", async () => {
  const f = fixture();
  const server = new MCPServer({ runtimeScope: f.guard, frameStoreBinder: f.binder });
  try {
    const preflight = await cli(f, ["destination"]);
    const expected = preflight.data.destination.identity;
    f.removeVerification();
    const cliResult = await cli(f, [
      ...rememberArgs,
      "--expected-destination",
      expected,
      "--permissions",
      "approved",
      "--provenance-json",
      JSON.stringify({
        backendIdentity: backend.identity,
        destination: preflight.data.destination,
      }),
    ]);
    assert.equal(cliResult.code, "LEX_DESTINATION_MISMATCH");
    const result = await server.handleRequest({
      method: "tools/call",
      params: {
        name: "frame_create",
        arguments: {
          ...frameArgs,
          expected_destination: expected,
          permissions: ["approved"],
          provenance: { destination: preflight.data.destination },
          backendIdentity: backend.identity,
        },
      },
    });
    assert.equal(result.error?.code, "LEX_DESTINATION_MISMATCH");
    assert.equal(f.counts.list, 0);
    assert.equal(f.counts.save, 0);
  } finally {
    await server.close();
    await f.close();
  }
});

test("untrusted CLI expected binding fails before opening a default store; dry-run combination is explicit", async () => {
  const f = fixture();
  const originalDb = process.env.LEX_DB_PATH;
  const path = join(f.root, "must-not-create.db");
  process.env.LEX_DB_PATH = path;
  try {
    const expected = createDestinationSnapshot(invocation(), scope(), backend).identity!;
    const result = await cli(f, [...rememberArgs, "--expected-destination", expected], false);
    assert.equal(result.code, "LEX_DESTINATION_MISMATCH");
    assert.equal(existsSync(path), false);
    const dryRun = await cli(f, [...rememberArgs, "--expected-destination", expected, "--dry-run"]);
    assert.match(dryRun.message, /binds writes; omit it for --dry-run/);
    assert.equal(f.counts.list, 0);
    assert.equal(f.counts.save, 0);
  } finally {
    if (originalDb === undefined) delete process.env.LEX_DB_PATH;
    else process.env.LEX_DB_PATH = originalDb;
    await f.close();
  }
});

test("MCP advertises destination preflight as read-only and frame_create as a write", () => {
  const inspect = MCP_TOOLS.find((tool) => tool.name === "destination_inspect")!;
  const create = MCP_TOOLS.find((tool) => tool.name === "frame_create")!;
  assert.equal(inspect.annotations?.readOnlyHint, true);
  assert.equal(inspect.inputSchema.additionalProperties, false);
  assert.deepEqual(inspect.inputSchema.properties, {});
  assert.equal(create.annotations?.readOnlyHint, false);
  assert.ok(create.inputSchema.properties.expected_destination);
});
