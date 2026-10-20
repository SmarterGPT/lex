import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { MCPServer } from "../../../src/memory/mcp_server/server.js";
import { MemoryScopedFrameStoreBackend } from "../../../src/memory/store/memory/index.js";
import type { ScopedFrameStoreBinder } from "../../../src/memory/store/index.js";
import { run } from "../../../src/shared/cli/index.js";
import {
  SqliteLocalBindingRegistry,
  InMemoryAuthorityDirectory,
  detectExecutionSurface,
  resolveRuntimeScope,
  createDestinationSnapshot,
  verifiedBackendIdentity,
  capabilitiesForCliOperation,
  type InvocationContextV1,
  type TrustedRuntimeScopeEntrypointGuardV1,
  type TrustedRuntimeScopeBootstrapResultV1,
} from "../../../src/shared/runtime-scope/index.js";

const now = "2026-10-20T12:00:00.000Z";
const expires = "2099-10-20T12:00:00.000Z";
const tenantId = "01900000-0000-7000-8000-000000000001" as never;
const workspaceId = "01900000-0000-7000-8000-000000000101" as never;
const principalId = "01900000-0000-7000-8000-000000000201" as never;
const repositoryId = "repository" as never;
const backend = {
  kind: "postgres" as const,
  identity: verifiedBackendIdentity({
    identity: `postgres-live-v1:sha256:${"a".repeat(64)}`,
    verifiedAt: now,
    connectionClass: "loopback",
  }),
};

async function windowsFixture(actualFilesystem = false) {
  const temporary = actualFilesystem
    ? mkdtempSync(join(tmpdir(), "Lex-MixedCase-Destination-"))
    : undefined;
  const initialRoot = temporary ?? "D:\\Synthetic\\Lex";
  let projectRoot = initialRoot;
  let canonicalRoot = projectRoot;
  const surface = detectExecutionSurface({ platform: "win32", installationRef: "synthetic-node" });
  const common = {
    schemaVersion: 1 as const,
    state: "active" as const,
    authorityVersion: "v1" as never,
  };
  const authority = new InMemoryAuthorityDirectory(
    {
      principals: [{ ...common, principalId }],
      tenants: [{ ...common, tenantId, tenantSlug: "tenant" as never }],
      workspaces: [{ ...common, tenantId, workspaceId, workspaceSlug: "workspace" as never }],
      repositories: [{ ...common, repositoryId, repositorySlug: "repository" as never }],
      authentication: [{ authenticationRef: "auth:synthetic" as never, principalId }],
      grants: [
        {
          grant: {
            schemaVersion: 1,
            grantId: "grant" as never,
            tenantId,
            workspaceId,
            principalId,
            capabilities: capabilitiesForCliOperation("remember"),
            authorityVersion: "v1" as never,
            scopeVersion: "v1" as never,
            authorityDigest: "sha256:authority" as never,
            verifiedAt: now,
            expiresAt: expires,
          },
        },
      ],
    },
    () => now
  );
  const registry = SqliteLocalBindingRegistry.initialize({
    databasePath: ":memory:",
    registryInstanceId: "registry" as never,
    executionSurfaceId: "surface" as never,
    executionSurface: surface,
    createdAt: now,
    now: () => now,
  });
  await registry.registerBinding({
    tenantId,
    workspaceId,
    repositoryId,
    repositoryInstanceId: "repository-instance" as never,
    workspaceInstanceId: "workspace-instance" as never,
    evidence: { schemaVersion: 1, canonicalRoot },
    authorityEvidence: {
      schemaVersion: 1,
      authoritySource: "test",
      authorityVersion: "v1" as never,
      authorityDigest: "sha256:authority" as never,
      verifiedAt: now,
      expiresAt: expires,
    },
    registeredByPrincipalId: principalId,
  });
  const memory = new MemoryScopedFrameStoreBackend();
  const counts = { bind: 0, list: 0, save: 0 };
  const binder: ScopedFrameStoreBinder = {
    bind(scope) {
      counts.bind++;
      const store = memory.bind(scope);
      store.getMetadata = () => ({
        backend: "postgres",
        location: "synthetic",
        canonicalLocation: "synthetic",
        identity: backend.identity.identity!,
        backendIdentity: backend.identity,
        capabilities: { encryption: false, images: false },
      });
      const list = store.listFrames.bind(store);
      store.listFrames = async (options) => {
        counts.list++;
        return list(options);
      };
      const save = store.saveFrame.bind(store);
      store.saveFrame = async (frame) => {
        counts.save++;
        return save(frame);
      };
      return store;
    },
  };
  let latest: Extract<TrustedRuntimeScopeBootstrapResultV1, { resolved: true }> | undefined;
  const guard: TrustedRuntimeScopeEntrypointGuardV1 = {
    request: {
      schemaVersion: 1,
      runtimeId: "runtime" as never,
      traceId: "trace" as never,
      bootstrap: {
        schemaVersion: 1,
        cwd: projectRoot,
        argv: ["node", "lex"],
        allowedEnvironment: {},
        platform: "win32",
        executionSurface: surface,
        capturedAt: now,
      },
    },
    bootstrap: {
      async resolve(request) {
        const result = await resolveRuntimeScope(
          {
            schemaVersion: 1,
            bootstrap: request.bootstrap,
            projectRoot,
            authenticationRef: "auth:synthetic" as never,
            requestedWorkspace: { workspaceId },
            requestedCapabilities: request.requestedCapabilities,
            repositoryEvidence: { schemaVersion: 1, canonicalRoot },
            runtimeSurface: {
              schemaVersion: 1,
              registryInstanceId: "registry" as never,
              executionSurfaceId: "surface" as never,
              runtimeId: "runtime" as never,
            },
            authoritySource: "test",
            authorityCacheExpiresAt: expires,
          },
          { authorityDirectory: authority, localRegistry: registry }
        );
        if (result.resolved) latest = result;
        return result;
      },
    },
  };
  return {
    guard,
    initialRoot,
    binder,
    counts,
    surface,
    get latest() {
      assert.ok(latest);
      return latest;
    },
    roots(project: string, canonical = project) {
      projectRoot = project;
      canonicalRoot = canonical;
    },
    async close() {
      registry.close();
      await memory.close();
      if (temporary) {
        assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
        rmSync(temporary, { recursive: true, force: true });
      }
    },
  };
}

async function cli(f: Awaited<ReturnType<typeof windowsFixture>>, args: string[]) {
  const output: string[] = [];
  const stdout = mock.method(process.stdout, "write", (chunk: string) => {
    output.push(String(chunk));
    return true;
  });
  const stderr = mock.method(process.stderr, "write", (chunk: string) => {
    output.push(String(chunk));
    return true;
  });
  const prior = process.exitCode;
  try {
    await run(["node", "lex", "--json", ...args], {
      runtimeScope: { ...f.guard, frameStoreBinder: f.binder, emitDiagnostics() {} },
    });
    return output
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .at(-1);
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.exitCode = prior;
  }
}
const remember = [
  "remember",
  "--summary",
  "synthetic canonicalization",
  "--reference-point",
  "test",
  "--next",
  "continue",
  "--modules",
  "workspace/unscoped",
  "--skip-policy",
];
const frame = {
  reference_point: "test",
  summary_caption: "synthetic canonicalization",
  status_snapshot: { next_action: "continue" },
  module_scope: ["workspace/unscoped"],
};

test("actual Windows registry/resolver normalizes snapshot identity on every host", async () => {
  const f = await windowsFixture();
  try {
    await cli(f, ["destination"]);
    const first = createDestinationSnapshot(
      f.latest.invocationContext,
      f.latest.authorizedScope,
      backend,
      f.surface
    );
    assert.equal(f.latest.invocationContext.binding!.evidence.canonicalRoot, "d:\\synthetic\\lex");
    assert.equal(f.latest.invocationContext.repositoryEvidence.canonicalRoot, "D:\\Synthetic\\Lex");
    f.roots("d:/synthetic/lex");
    await cli(f, ["destination"]);
    assert.deepEqual(
      createDestinationSnapshot(
        f.latest.invocationContext,
        f.latest.authorizedScope,
        backend,
        f.surface
      ),
      first
    );
  } finally {
    await f.close();
  }
});

test(
  "native Windows actual registry/resolver supports CLI/MCP preflight and writes",
  { skip: process.platform !== "win32" },
  async () => {
    const f = await windowsFixture(true);
    const server = new MCPServer({ runtimeScope: f.guard, frameStoreBinder: f.binder });
    const call = (name: string, args: Record<string, unknown> = {}) =>
      server.handleRequest({ method: "tools/call", params: { name, arguments: args } });
    try {
      const first = await cli(f, ["destination"]);
      assert.equal(
        f.latest.invocationContext.binding!.evidence.canonicalRoot,
        f.initialRoot.toLowerCase()
      );
      assert.equal(f.latest.invocationContext.repositoryEvidence.canonicalRoot, f.initialRoot);
      const expected = first.data.destination.identity;
      assert.equal(first.data.destination.projectRoot, f.initialRoot.toLowerCase());
      const mcp = await call("destination_inspect");
      assert.equal(mcp.error, undefined);
      assert.deepEqual(mcp.data?.destination, first.data.destination);
      assert.equal(f.counts.list, 0);
      assert.equal(f.counts.save, 0);
      f.roots(f.initialRoot.toLowerCase().replace(/\\/g, "/"));
      const next = await cli(f, ["destination"]);
      assert.deepEqual(next.data.destination, first.data.destination);
      const saved = await cli(f, [...remember, "--expected-destination", expected]);
      assert.equal(saved.code, "FRAME_CREATED");
      const savedMcp = await call("frame_create", { ...frame, expected_destination: expected });
      assert.equal(savedMcp.error, undefined);
      assert.equal(f.counts.save, 2);
      const mismatch = await call("frame_create", {
        ...frame,
        expected_destination: `lex-destination-v1:sha256:${"f".repeat(64)}`,
      });
      assert.equal(mismatch.error?.code, "LEX_DESTINATION_MISMATCH");
      assert.equal(f.counts.save, 2);
    } finally {
      await server.close();
      await f.close();
    }
  }
);

test("actual Windows resolver rejects sibling, nested and different-drive repository evidence before CLI/MCP frame access", async () => {
  for (const root of ["D:\\Synthetic\\Other", "D:\\Synthetic\\Lex\\Nested", "E:\\Synthetic\\Lex"]) {
    const f = await windowsFixture();
    const server = new MCPServer({ runtimeScope: f.guard, frameStoreBinder: f.binder });
    try {
      f.roots(root);
      await assert.rejects(() => cli(f, ["destination"]));
      await assert.rejects(() => cli(f, remember));
      for (const name of ["destination_inspect", "frame_create"]) {
        const response = await server.handleRequest({
          method: "tools/call",
          params: { name, arguments: name === "frame_create" ? frame : {} },
        });
        assert.ok(response.error);
      }
      assert.deepEqual(f.counts, { bind: 0, list: 0, save: 0 });
    } finally {
      await server.close();
      await f.close();
    }
  }
});

test("normalized destination guard retains exact repository-root, state and scope checks and permits project subdirectories", async () => {
  const f = await windowsFixture();
  try {
    await cli(f, ["destination"]);
    const { invocationContext: invocation, authorizedScope: scope } = f.latest;
    for (const root of [
      "D:\\Synthetic\\Other",
      "D:\\Synthetic\\Lex\\Nested",
      "D:\\Synthetic",
      "E:\\Synthetic\\Lex",
      "relative",
    ]) {
      assert.throws(
        () =>
          createDestinationSnapshot(
            { ...invocation, repositoryEvidence: { schemaVersion: 1, canonicalRoot: root } },
            scope,
            backend,
            f.surface
          ),
        /matching authorized/
      );
    }
    for (const patch of [{ state: "revoked" }, { tenantId: "other" }, { workspaceId: "other" }]) {
      assert.throws(
        () =>
          createDestinationSnapshot(
            {
              ...invocation,
              binding: { ...invocation.binding!, ...patch } as InvocationContextV1["binding"],
            },
            scope,
            backend,
            f.surface
          ),
        /matching authorized/
      );
    }
    assert.throws(
      () => createDestinationSnapshot(invocation, scope, backend),
      /matching authorized/
    );
    f.roots("D:\\Synthetic\\Lex\\Subdir", "D:\\Synthetic\\Lex");
    const nested = await cli(f, ["destination"]);
    assert.equal(nested.data.destination.projectRoot, "d:\\synthetic\\lex\\subdir");
  } finally {
    await f.close();
  }
});

test("POSIX surfaces retain case-sensitive repository identity and malformed Windows input fails closed", async () => {
  const f = await windowsFixture();
  try {
    await cli(f, ["destination"]);
    const { invocationContext: original, authorizedScope: scope } = f.latest;
    for (const platform of ["linux", "darwin"] as const) {
      const surface = detectExecutionSurface({ platform, installationRef: "synthetic" });
      const invocation: InvocationContextV1 = {
        ...original,
        projectRoot: "/Synthetic/Lex",
        repositoryEvidence: { schemaVersion: 1, canonicalRoot: "/Synthetic/Lex" },
        binding: {
          ...original.binding!,
          evidence: { schemaVersion: 1, canonicalRoot: "/Synthetic/Lex" },
        },
      };
      const exact = createDestinationSnapshot(invocation, scope, backend, surface);
      assert.equal(exact.projectRoot, "/Synthetic/Lex");
      assert.throws(
        () =>
          createDestinationSnapshot(
            {
              ...invocation,
              repositoryEvidence: { schemaVersion: 1, canonicalRoot: "/synthetic/lex" },
            },
            scope,
            backend,
            surface
          ),
        /matching authorized/
      );
    }
    assert.throws(
      () =>
        createDestinationSnapshot(
          { ...original, projectRoot: "relative" },
          scope,
          backend,
          f.surface
        ),
      /matching authorized/
    );
  } finally {
    await f.close();
  }
});
