import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createTestSymlinkOrSkip } from "../../helpers/symlink.js";

import { MCPServer } from "../../../src/memory/mcp_server/server.js";
import {
  MemoryFrameStore,
  MemoryScopedFrameStoreBackend,
} from "../../../src/memory/store/memory/index.js";
import {
  SCOPED_FRAME_STORE_ERROR_CODES,
  type FrameStore,
  type ScopedFrameStoreBinder,
} from "../../../src/memory/store/index.js";
import { run } from "../../../src/shared/cli/index.js";
import { AXErrorException } from "../../../src/shared/errors/ax-error.js";
import {
  DIAGNOSTIC_CONTRACT_VERSION,
  type AuthorizedScopeV1,
  type BootstrapInputSnapshotV1,
  type CapabilityId,
  type ContentDigest,
  type DiagnosticEnvelopeV1,
  type InvocationContextV1,
  type RuntimeId,
  type TraceId,
  type TrustedRuntimeScopeBootstrapRequestV1,
  type TrustedRuntimeScopeBootstrapResultV1,
  type TrustedRuntimeScopeBootstrapV1,
} from "../../../src/shared/runtime-scope/index.js";

const FRAME_READ = "frame:read" as CapabilityId;
const TEST_REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function fakeInvocationContext(projectRoot = TEST_REPO_ROOT): InvocationContextV1 {
  return {
    schemaVersion: 1,
    projectRoot,
    requestedWorkspace: { workspaceId: "workspace-lex" as never },
    repositoryEvidence: {
      schemaVersion: 1,
      canonicalRoot: projectRoot,
    },
    binding: {
      schemaVersion: 1,
      bindingId: "binding-1" as never,
      registryInstanceId: "registry-1" as never,
      executionSurfaceId: "surface-1" as never,
      workspaceInstanceId: "workspace-instance-1" as never,
      repositoryInstanceId: "repo-instance-1" as never,
      tenantId: "tenant-1" as never,
      workspaceId: "workspace-lex" as never,
      repositoryId: "repo-1" as never,
      evidence: { schemaVersion: 1, canonicalRoot: projectRoot },
      state: "active",
      createdAt: "2026-07-18T12:00:00.000Z",
    },
    runtimeSurface: {
      schemaVersion: 1,
      executionSurfaceId: "surface-1" as never,
      registryInstanceId: "registry-1" as never,
      runtimeId: "runtime-1" as RuntimeId,
    },
  };
}

function fakeAuthorizedScope(capabilities: readonly CapabilityId[]): AuthorizedScopeV1 {
  return {
    schemaVersion: 1,
    grantId: "grant-1" as never,
    tenantId: "tenant-1" as never,
    workspaceId: "workspace-lex" as never,
    principalId: "principal-1" as never,
    capabilities,
    authorityVersion: "authority-v1" as never,
    scopeVersion: "scope-v1" as never,
    authorityDigest: "sha256:authority" as ContentDigest,
    verifiedAt: "2026-07-18T12:00:00.000Z",
  };
}

function fakeDiagnostics(request: TrustedRuntimeScopeBootstrapRequestV1): DiagnosticEnvelopeV1 {
  return {
    schemaVersion: DIAGNOSTIC_CONTRACT_VERSION,
    runtimeId: request.runtimeId,
    traceId: request.traceId,
    resolutionDigest: "sha256:resolution" as ContentDigest,
    decisions: [
      {
        code: "LEX_RUNTIME_SCOPE_RESOLVED",
        outcome: "accepted",
        summary: "Resolved.",
      },
    ],
    warnings: [],
    redactions: [{ field: "projectRoot", reason: "topology" }],
  };
}

function successfulBootstrap(seen: TrustedRuntimeScopeBootstrapRequestV1[]) {
  const bootstrap: TrustedRuntimeScopeBootstrapV1 = {
    async resolve(request): Promise<TrustedRuntimeScopeBootstrapResultV1> {
      seen.push(request);
      return {
        resolved: true,
        invocationContext: fakeInvocationContext(),
        authorizedScope: fakeAuthorizedScope(request.requestedCapabilities),
        ...(request.diagnosticRequest ? { diagnostics: fakeDiagnostics(request) } : {}),
      };
    },
  };
  return bootstrap;
}

function deniedBootstrap(seen: TrustedRuntimeScopeBootstrapRequestV1[]) {
  const bootstrap: TrustedRuntimeScopeBootstrapV1 = {
    async resolve(request): Promise<TrustedRuntimeScopeBootstrapResultV1> {
      seen.push(request);
      return {
        resolved: false,
        error: {
          code: "LEX_WORKSPACE_UNBOUND",
          message: "No trusted local workspace binding matched this invocation.",
        },
      };
    },
  };
  return bootstrap;
}

const invocationRequest = {
  schemaVersion: 1 as const,
  bootstrap: {
    schemaVersion: 1,
    cwd: "/srv/lex",
    argv: ["node", "lex"],
    allowedEnvironment: {},
    platform: "linux",
    executionSurface: {
      schemaVersion: 1,
      nativePlatform: "linux",
      kind: "linux-native",
      installationRef: "/usr/bin/node",
      evidenceDigest: "sha256:surface" as ContentDigest,
    },
    capturedAt: "2026-07-18T12:00:00.000Z",
  } as BootstrapInputSnapshotV1,
  runtimeId: "runtime-1" as RuntimeId,
  traceId: "trace-1" as TraceId,
};

function writeTrustedWorkspacePolicy(projectRoot: string, moduleId: string): void {
  const policyDirectory = join(projectRoot, "policies");
  mkdirSync(policyDirectory, { recursive: true });
  writeFileSync(
    join(projectRoot, ".lex.config.json"),
    JSON.stringify({ paths: { policy: "./policies/lexmap.policy.json" } }),
    "utf8"
  );
  writeFileSync(
    join(policyDirectory, "lexmap.policy.json"),
    JSON.stringify({
      version: "1.0.0",
      modules: {
        [moduleId]: {
          owns_paths: [`src/${moduleId}/**`],
          allowed_callers: ["*"],
          forbidden_callers: [],
        },
      },
    }),
    "utf8"
  );
}

function validationArguments(moduleId: string): Record<string, unknown> {
  return {
    reference_point: `validate-${moduleId}`,
    summary_caption: `Validate ${moduleId}`,
    status_snapshot: { next_action: "continue" },
    module_scope: [moduleId],
  };
}

function responseText(response: { content?: unknown[] }): string {
  return ((response.content?.[0] as { text?: string } | undefined)?.text ?? "").toString();
}

describe("trusted runtime-scope entrypoint guards", () => {
  test("CLI resolves before dispatch and emits diagnostics only when requested", async () => {
    const seen: TrustedRuntimeScopeBootstrapRequestV1[] = [];
    const emitted: DiagnosticEnvelopeV1[] = [];
    let resolved = false;

    await run(["node", "lex", "--diagnostic", "hints", "--list"], {
      runtimeScope: {
        bootstrap: successfulBootstrap(seen),
        request: invocationRequest,
        onResolved: () => {
          resolved = true;
        },
        emitDiagnostics: (diagnostics) => {
          emitted.push(diagnostics);
        },
      },
    });

    assert.equal(resolved, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.entrypoint, "cli");
    assert.deepEqual(seen[0]?.requestedCapabilities, []);
    assert.equal(seen[0]?.diagnosticRequest?.level, "summary");
    assert.equal(emitted.length, 1);
  });

  test("CLI denial prevents command dispatch with the stable scope error", async () => {
    const seen: TrustedRuntimeScopeBootstrapRequestV1[] = [];
    await assert.rejects(
      () =>
        run(["node", "lex", "hints", "--list"], {
          runtimeScope: {
            bootstrap: deniedBootstrap(seen),
            request: invocationRequest,
            emitDiagnostics: () => {},
          },
        }),
      (error: unknown) =>
        error instanceof AXErrorException && error.axError.code === "LEX_WORKSPACE_UNBOUND"
    );
    assert.equal(seen.length, 1);
  });

  test("CLI diagnostic controls do not cross the passthrough boundary", async () => {
    const seen: TrustedRuntimeScopeBootstrapRequestV1[] = [];

    await assert.rejects(
      () =>
        run(["node", "lex", "hints", "--", "--diagnostic", "--diagnostic-level=full"], {
          runtimeScope: {
            bootstrap: deniedBootstrap(seen),
            request: invocationRequest,
            emitDiagnostics: () => {},
          },
        }),
      (error: unknown) =>
        error instanceof AXErrorException && error.axError.code === "LEX_WORKSPACE_UNBOUND"
    );

    assert.equal(seen[0]?.diagnosticRequest, undefined);
  });

  test("MCP resolves per tool call and attaches opt-in diagnostics", async () => {
    const seen: TrustedRuntimeScopeBootstrapRequestV1[] = [];
    const backend = new MemoryScopedFrameStoreBackend();
    const server = new MCPServer({
      frameStore: new MemoryFrameStore(),
      frameStoreBinder: backend,
      runtimeScope: {
        bootstrap: successfulBootstrap(seen),
        request: invocationRequest,
      },
    });
    try {
      const response = await server.handleRequest({
        method: "tools/call",
        params: {
          name: "frame_list",
          arguments: { diagnostics: "summary" },
        },
      });

      assert.equal(response.error, undefined);
      assert.ok(response.data?.diagnostics);
      assert.equal(seen[0]?.entrypoint, "mcp");
      assert.deepEqual(seen[0]?.requestedCapabilities, [FRAME_READ]);
      assert.equal(seen[0]?.diagnosticRequest?.level, "summary");

      const tools = await server.handleRequest({ method: "tools/list" });
      const listed = tools.tools as Array<{
        name: string;
        inputSchema: { properties: Record<string, unknown> };
      }>;
      assert.ok(listed.every((tool) => "diagnostics" in tool.inputSchema.properties));
    } finally {
      await server.close();
      await backend.close();
    }
  });

  test("MCP removes diagnostic controls before public tool validation", async () => {
    const seen: TrustedRuntimeScopeBootstrapRequestV1[] = [];
    const server = new MCPServer({
      frameStore: new MemoryFrameStore(),
      runtimeScope: {
        bootstrap: successfulBootstrap(seen),
        request: invocationRequest,
      },
    });
    try {
      const response = await server.handleRequest({
        method: "tools/call",
        params: {
          name: "frame_validate",
          arguments: {
            diagnostics: "summary",
            reference_point: "diagnostic-control-boundary",
            summary_caption: "Diagnostic metadata is not a Frame field",
            status_snapshot: { next_action: "none" },
            module_scope: ["runtime-scope"],
          },
        },
      });

      assert.equal(response.error, undefined);
      assert.ok(response.data?.diagnostics);
      const validated = response.data?.frame as Record<string, unknown> | undefined;
      assert.equal(validated?.diagnostics, undefined);
    } finally {
      await server.close();
    }
  });

  test("MCP denial blocks a mutating tool before the store is called", async () => {
    const seen: TrustedRuntimeScopeBootstrapRequestV1[] = [];
    const store = new MemoryFrameStore();
    const backend = new MemoryScopedFrameStoreBackend();
    const server = new MCPServer({
      frameStore: store,
      frameStoreBinder: backend,
      runtimeScope: {
        bootstrap: deniedBootstrap(seen),
        request: invocationRequest,
      },
    });
    try {
      const response = await server.handleRequest({
        method: "tools/call",
        params: {
          name: "frame_create",
          arguments: {
            reference_point: "must-not-write",
            summary_caption: "Denied before dispatch",
            status_snapshot: { next_action: "none" },
            module_scope: ["runtime-scope"],
          },
        },
      });

      assert.equal(response.error?.code, "LEX_WORKSPACE_UNBOUND");
      assert.equal(store.size(), 0);
      assert.equal(seen.length, 1);
    } finally {
      await server.close();
      await backend.close();
    }
  });

  test("CLI refuses Frame dispatch when trusted scope has no binder", async () => {
    const seen: TrustedRuntimeScopeBootstrapRequestV1[] = [];
    await assert.rejects(
      () =>
        run(["node", "lex", "recall", "scope-required"], {
          runtimeScope: {
            bootstrap: successfulBootstrap(seen),
            request: invocationRequest,
            emitDiagnostics: () => {},
          },
        }),
      (error: unknown) =>
        error instanceof AXErrorException &&
        error.axError.code === SCOPED_FRAME_STORE_ERROR_CODES.INVALID_SCOPE
    );
    assert.equal(seen.length, 0);
  });

  test("CLI does not route legacy physical database administration through a normal binder", async () => {
    const seen: TrustedRuntimeScopeBootstrapRequestV1[] = [];
    const backend = new MemoryScopedFrameStoreBackend();
    await assert.rejects(
      () =>
        run(["node", "lex", "db", "stats"], {
          runtimeScope: {
            bootstrap: successfulBootstrap(seen),
            request: invocationRequest,
            frameStoreBinder: backend,
            emitDiagnostics: () => {},
          },
        }),
      (error: unknown) =>
        error instanceof AXErrorException &&
        error.axError.code === SCOPED_FRAME_STORE_ERROR_CODES.INVALID_SCOPE
    );
    assert.equal(seen.length, 0);
    await backend.close();
  });

  test("MCP refuses Frame dispatch when trusted scope has no binder", async () => {
    const seen: TrustedRuntimeScopeBootstrapRequestV1[] = [];
    const store = new MemoryFrameStore();
    const server = new MCPServer({
      frameStore: store,
      runtimeScope: {
        bootstrap: successfulBootstrap(seen),
        request: invocationRequest,
      },
    });
    try {
      const response = await server.handleRequest({
        method: "tools/call",
        params: { name: "frame_list", arguments: {} },
      });
      assert.equal(response.error?.code, SCOPED_FRAME_STORE_ERROR_CODES.INVALID_SCOPE);
      assert.equal(seen.length, 0);
      assert.equal(store.size(), 0);
    } finally {
      await server.close();
    }
  });

  test("MCP trusted-scope misconfiguration never eagerly opens the legacy store", async () => {
    const seen: TrustedRuntimeScopeBootstrapRequestV1[] = [];
    const server = new MCPServer({
      runtimeScope: {
        bootstrap: successfulBootstrap(seen),
        request: invocationRequest,
      },
    });
    try {
      assert.equal((server as unknown as { frameStore?: FrameStore }).frameStore, undefined);
      const response = await server.handleRequest({
        method: "tools/call",
        params: {
          name: "frame_validate",
          arguments: {
            reference_point: "validation-needs-no-store",
            summary_caption: "No legacy initialization",
            status_snapshot: { next_action: "retain fail-closed startup" },
            module_scope: ["runtime-scope"],
          },
        },
      });
      assert.equal(response.error, undefined);
      assert.deepEqual(
        seen.map(({ requestedCapabilities }) => requestedCapabilities),
        [[]]
      );
    } finally {
      await server.close();
    }
  });

  test("MCP binds the resolved scope lexically without eagerly opening a legacy store", async () => {
    const seen: TrustedRuntimeScopeBootstrapRequestV1[] = [];
    const backend = new MemoryScopedFrameStoreBackend();
    const server = new MCPServer({
      frameStoreBinder: backend,
      runtimeScope: {
        bootstrap: successfulBootstrap(seen),
        request: invocationRequest,
      },
    });
    try {
      const created = await server.handleRequest({
        method: "tools/call",
        params: {
          name: "frame_create",
          arguments: {
            reference_point: "lexical-scope-handoff",
            summary_caption: "Bound after authorization",
            status_snapshot: { next_action: "verify isolated recall" },
            module_scope: ["memory/store"],
          },
        },
      });
      assert.equal(created.error, undefined);

      const listed = await server.handleRequest({
        method: "tools/call",
        params: { name: "frame_list", arguments: { limit: 10, format: "compact" } },
      });
      assert.equal(listed.error, undefined);
      assert.equal((listed.data?.frames as unknown[] | undefined)?.length, 1);
      assert.deepEqual(
        seen.map(({ requestedCapabilities }) => requestedCapabilities),
        [["frame:read", "frame:write"], ["frame:read"]]
      );
    } finally {
      await server.close();
      await backend.close();
    }
  });

  test("MCP idempotency responses cannot bleed across authorized workspaces", async () => {
    let workspace = "workspace-a";
    const bootstrap: TrustedRuntimeScopeBootstrapV1 = {
      async resolve(request) {
        return {
          resolved: true,
          invocationContext: {
            ...fakeInvocationContext(),
            binding: { ...fakeInvocationContext().binding!, workspaceId: workspace as never },
          },
          authorizedScope: {
            ...fakeAuthorizedScope(request.requestedCapabilities),
            workspaceId: workspace as never,
          },
        };
      },
    };
    const backend = new MemoryScopedFrameStoreBackend();
    const server = new MCPServer({
      frameStoreBinder: backend,
      runtimeScope: { bootstrap, request: invocationRequest },
    });
    const call = () =>
      server.handleRequest({
        method: "tools/call",
        params: {
          name: "frame_create",
          arguments: {
            request_id: "same-agent-retry-key",
            reference_point: "idempotency-scope",
            summary_caption: `Created in ${workspace}`,
            status_snapshot: { next_action: "verify scope partition" },
            module_scope: ["memory/store"],
          },
        },
      });
    try {
      const first = await call();
      workspace = "workspace-b";
      const second = await call();
      assert.equal(first.error, undefined);
      assert.equal(second.error, undefined);
      assert.notEqual(first.data?.frame_id, second.data?.frame_id);
    } finally {
      await server.close();
      await backend.close();
    }
  });

  test("MCP idempotency responses cannot bleed across repositories in one workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "lex-mcp-idempotency-repos-"));
    const repositoryA = join(root, "repository-a");
    const repositoryB = join(root, "repository-b");
    mkdirSync(repositoryA);
    mkdirSync(repositoryB);
    let projectRoot = repositoryA;
    const bootstrap: TrustedRuntimeScopeBootstrapV1 = {
      async resolve(request) {
        return {
          resolved: true,
          invocationContext: fakeInvocationContext(projectRoot),
          authorizedScope: fakeAuthorizedScope(request.requestedCapabilities),
        };
      },
    };
    const backend = new MemoryScopedFrameStoreBackend();
    const server = new MCPServer({
      frameStoreBinder: backend,
      runtimeScope: { bootstrap, request: invocationRequest },
    });
    const create = (summary: string) =>
      server.handleRequest({
        method: "tools/call",
        params: {
          name: "frame_create",
          arguments: {
            request_id: "same-retry-key",
            reference_point: "repository-partition",
            summary_caption: summary,
            status_snapshot: { next_action: "continue" },
            module_scope: ["repository/scope"],
          },
        },
      });

    try {
      const first = await create("repository A");
      projectRoot = repositoryB;
      const second = await create("repository B");
      assert.equal(first.error, undefined);
      assert.equal(second.error, undefined);
      assert.notEqual(first.data?.frame_id, second.data?.frame_id);
    } finally {
      await server.close();
      await backend.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("MCP resolves distinct trusted workspace policies for every alternating call", async () => {
    const root = mkdtempSync(join(tmpdir(), "lex-mcp-policy-scope-"));
    const workspaceA = join(root, "workspace-a");
    const workspaceB = join(root, "workspace-b");
    mkdirSync(workspaceA);
    mkdirSync(workspaceB);
    writeTrustedWorkspacePolicy(workspaceA, "workspace/a");
    writeTrustedWorkspacePolicy(workspaceB, "workspace/b");
    const originalPolicyPath = process.env.LEX_POLICY_PATH;
    process.env.LEX_POLICY_PATH = join(workspaceA, "policies", "lexmap.policy.json");

    let projectRoot = workspaceA;
    let workspaceId = "workspace-a";
    const bootstrap: TrustedRuntimeScopeBootstrapV1 = {
      async resolve(request) {
        return {
          resolved: true,
          invocationContext: fakeInvocationContext(projectRoot),
          authorizedScope: {
            ...fakeAuthorizedScope(request.requestedCapabilities),
            workspaceId: workspaceId as never,
          },
        };
      },
    };
    const server = new MCPServer({
      repoRoot: workspaceA,
      runtimeScope: { bootstrap, request: invocationRequest },
    });
    const validate = (moduleId: string) =>
      server.handleRequest({
        method: "tools/call",
        params: { name: "frame_validate", arguments: validationArguments(moduleId) },
      });

    try {
      assert.match(responseText(await validate("workspace/a")), /Validation passed/);
      assert.match(responseText(await validate("workspace/b")), /Validation failed/);

      projectRoot = workspaceB;
      workspaceId = "workspace-b";
      assert.match(responseText(await validate("workspace/b")), /Validation passed/);
      assert.match(responseText(await validate("workspace/a")), /Validation failed/);

      projectRoot = workspaceA;
      workspaceId = "workspace-a";
      assert.match(responseText(await validate("workspace/a")), /Validation passed/);
    } finally {
      await server.close();
      if (originalPolicyPath === undefined) delete process.env.LEX_POLICY_PATH;
      else process.env.LEX_POLICY_PATH = originalPolicyPath;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("MCP does not reuse a previous trusted policy for a no-policy workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "lex-mcp-no-policy-scope-"));
    const workspaceA = join(root, "workspace-a");
    const workspaceB = join(root, "workspace-b");
    mkdirSync(workspaceA);
    mkdirSync(workspaceB);
    writeTrustedWorkspacePolicy(workspaceA, "workspace/a");

    let projectRoot = workspaceA;
    const bootstrap: TrustedRuntimeScopeBootstrapV1 = {
      async resolve(request) {
        return {
          resolved: true,
          invocationContext: fakeInvocationContext(projectRoot),
          authorizedScope: fakeAuthorizedScope(request.requestedCapabilities),
        };
      },
    };
    const server = new MCPServer({ runtimeScope: { bootstrap, request: invocationRequest } });
    const validate = () =>
      server.handleRequest({
        method: "tools/call",
        params: { name: "frame_validate", arguments: validationArguments("workspace/a") },
      });

    try {
      assert.match(responseText(await validate()), /Validation passed/);
      projectRoot = workspaceB;
      const noPolicy = await validate();
      assert.equal(noPolicy.error, undefined);
      assert.match(responseText(noPolicy), /Policy not loaded/);
      assert.doesNotMatch(responseText(noPolicy), /Validation failed/);
      projectRoot = workspaceA;
      assert.match(responseText(await validate()), /Validation passed/);
    } finally {
      await server.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("MCP fails closed when trusted workspace config points policy outside its root", async () => {
    const root = mkdtempSync(join(tmpdir(), "lex-mcp-policy-escape-"));
    const workspaceA = join(root, "workspace-a");
    const workspaceB = join(root, "workspace-b");
    mkdirSync(workspaceA);
    mkdirSync(workspaceB);
    writeTrustedWorkspacePolicy(workspaceA, "workspace/a");
    writeFileSync(
      join(workspaceB, ".lex.config.json"),
      JSON.stringify({ paths: { policy: "../workspace-a/policies/lexmap.policy.json" } }),
      "utf8"
    );

    let projectRoot = workspaceB;
    const bootstrap: TrustedRuntimeScopeBootstrapV1 = {
      async resolve(request) {
        return {
          resolved: true,
          invocationContext: fakeInvocationContext(projectRoot),
          authorizedScope: fakeAuthorizedScope(request.requestedCapabilities),
        };
      },
    };
    const server = new MCPServer({ runtimeScope: { bootstrap, request: invocationRequest } });
    const validate = () =>
      server.handleRequest({
        method: "tools/call",
        params: { name: "frame_validate", arguments: validationArguments("workspace/a") },
      });

    try {
      const escaped = await validate();
      assert.equal(escaped.error?.code, "POLICY_INVALID");
      projectRoot = workspaceA;
      assert.match(responseText(await validate()), /Validation passed/);
    } finally {
      await server.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("MCP rejects a config symlink that physically escapes the trusted root", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "lex-mcp-config-escape-"));
    const external = join(root, "external");
    const configEscape = join(root, "config-escape");
    mkdirSync(external);
    mkdirSync(configEscape);
    writeFileSync(
      join(external, "config.json"),
      JSON.stringify({ paths: { policy: "./policy.json" } }),
      "utf8"
    );
    if (
      !createTestSymlinkOrSkip(
        t,
        join(external, "config.json"),
        join(configEscape, ".lex.config.json")
      )
    ) {
      rmSync(root, { recursive: true, force: true });
      return;
    }

    const bootstrap: TrustedRuntimeScopeBootstrapV1 = {
      async resolve(request) {
        return {
          resolved: true,
          invocationContext: fakeInvocationContext(configEscape),
          authorizedScope: fakeAuthorizedScope(request.requestedCapabilities),
        };
      },
    };
    const server = new MCPServer({ runtimeScope: { bootstrap, request: invocationRequest } });
    const validate = () =>
      server.handleRequest({
        method: "tools/call",
        params: { name: "frame_validate", arguments: validationArguments("external/module") },
      });

    try {
      assert.equal((await validate()).error?.code, "POLICY_INVALID");
    } finally {
      await server.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("MCP rejects a linked policy ancestor that physically escapes the trusted root", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "lex-mcp-policy-escape-"));
    const external = join(root, "external");
    const policyEscape = join(root, "policy-escape");
    mkdirSync(external);
    mkdirSync(policyEscape);
    writeFileSync(
      join(external, "policy.json"),
      JSON.stringify({ version: "1.0.0", modules: { "external/module": {} } }),
      "utf8"
    );
    writeFileSync(
      join(policyEscape, ".lex.config.json"),
      JSON.stringify({ paths: { policy: "./linked/policy.json" } }),
      "utf8"
    );
    if (!createTestSymlinkOrSkip(t, external, join(policyEscape, "linked"), "dir")) {
      rmSync(root, { recursive: true, force: true });
      return;
    }

    const bootstrap: TrustedRuntimeScopeBootstrapV1 = {
      async resolve(request) {
        return {
          resolved: true,
          invocationContext: fakeInvocationContext(policyEscape),
          authorizedScope: fakeAuthorizedScope(request.requestedCapabilities),
        };
      },
    };
    const server = new MCPServer({ runtimeScope: { bootstrap, request: invocationRequest } });

    try {
      const response = await server.handleRequest({
        method: "tools/call",
        params: { name: "frame_validate", arguments: validationArguments("external/module") },
      });
      assert.equal(response.error?.code, "POLICY_INVALID");
    } finally {
      await server.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("MCP binds volatile config path tokens to the captured invocation time", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "lex-mcp-captured-tokens-"));
    const policyDirectory = join(projectRoot, "policies");
    mkdirSync(policyDirectory);
    writeFileSync(
      join(projectRoot, ".lex.config.json"),
      JSON.stringify({
        paths: { policy: "./policies/lexmap-{{today}}-{{now}}.json" },
      }),
      "utf8"
    );
    writeFileSync(
      join(policyDirectory, "lexmap-2026-07-18-20260718T120000.json"),
      JSON.stringify({ version: "1.0.0", modules: { "captured/time": {} } }),
      "utf8"
    );
    const bootstrap: TrustedRuntimeScopeBootstrapV1 = {
      async resolve(request) {
        return {
          resolved: true,
          invocationContext: fakeInvocationContext(projectRoot),
          authorizedScope: fakeAuthorizedScope(request.requestedCapabilities),
        };
      },
    };
    const server = new MCPServer({ runtimeScope: { bootstrap, request: invocationRequest } });

    try {
      const first = await server.handleRequest({
        method: "tools/call",
        params: { name: "frame_validate", arguments: validationArguments("captured/time") },
      });
      const second = await server.handleRequest({
        method: "tools/call",
        params: { name: "frame_validate", arguments: validationArguments("captured/time") },
      });
      assert.match(responseText(first), /Validation passed/);
      assert.match(responseText(second), /Validation passed/);
    } finally {
      await server.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("trusted introspection does not inspect ambient SQLite candidates", async () => {
    const root = mkdtempSync(join(tmpdir(), "lex-mcp-introspect-boundary-"));
    const projectRoot = join(root, "project");
    const ambientPath = join(root, ".smartergpt", "lex", "memory.db");
    const boundPath = join(root, "trusted-bound-store.db");
    mkdirSync(projectRoot);
    mkdirSync(join(root, ".smartergpt", "lex"), { recursive: true });
    writeFileSync(ambientPath, "ambient-store-probe", "utf8");
    const memoryBackend = new MemoryScopedFrameStoreBackend();
    const binder: ScopedFrameStoreBinder = {
      bind(scope) {
        const store = memoryBackend.bind(scope);
        store.getMetadata = () => ({
          backend: "sqlite",
          location: boundPath,
          canonicalLocation: boundPath,
          identity: "trusted-bound-identity",
          capabilities: { encryption: false, images: false },
        });
        return store;
      },
    };
    const bootstrap: TrustedRuntimeScopeBootstrapV1 = {
      async resolve(request) {
        return {
          resolved: true,
          invocationContext: fakeInvocationContext(projectRoot),
          authorizedScope: fakeAuthorizedScope(request.requestedCapabilities),
        };
      },
    };
    const server = new MCPServer({
      frameStoreBinder: binder,
      runtimeScope: { bootstrap, request: invocationRequest },
    });

    try {
      const response = await server.handleRequest({
        method: "tools/call",
        params: { name: "system_introspect", arguments: { format: "compact" } },
      });
      assert.equal(response.error, undefined);
      assert.doesNotMatch(responseText(response), new RegExp(ambientPath.replaceAll("/", "\\/")));
      const database = (response.data?.ctx as { database: { candidates: unknown[] } }).database;
      assert.deepEqual(database.candidates, []);
      assert.deepEqual(response.data?.warnings, []);
    } finally {
      await server.close();
      await memoryBackend.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("trusted atlas runs in-process without output and skips physically escaping sources", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "lex-mcp-atlas-boundary-"));
    const projectRoot = join(root, "project");
    const requestedRoot = join(projectRoot, "requested");
    const privateRoot = join(projectRoot, "private");
    mkdirSync(join(requestedRoot, "src"), { recursive: true });
    mkdirSync(privateRoot);
    writeFileSync(join(requestedRoot, "package.json"), JSON.stringify({ name: "safe-project" }));
    writeFileSync(
      join(requestedRoot, "src", "safe.ts"),
      "export function safeFunction(): string { return 'safe'; }\n",
      "utf8"
    );
    writeFileSync(
      join(privateRoot, "secret.ts"),
      "export function exfiltratedSecret(): string { return 'secret'; }\n",
      "utf8"
    );
    if (!createTestSymlinkOrSkip(t, privateRoot, join(requestedRoot, "src", "linked"), "dir")) {
      rmSync(root, { recursive: true, force: true });
      return;
    }
    const bootstrap: TrustedRuntimeScopeBootstrapV1 = {
      async resolve(request) {
        return {
          resolved: true,
          invocationContext: fakeInvocationContext(projectRoot),
          authorizedScope: fakeAuthorizedScope(request.requestedCapabilities),
        };
      },
    };
    const server = new MCPServer({ runtimeScope: { bootstrap, request: invocationRequest } });
    const originalPath = process.env.PATH;
    const originalLog = console.log;
    const originalError = console.error;
    let consoleCalls = 0;
    process.env.PATH = "";
    console.log = () => {
      consoleCalls++;
    };
    console.error = () => {
      consoleCalls++;
    };

    try {
      const response = await server.handleRequest({
        method: "tools/call",
        params: { name: "atlas_analyze", arguments: { path: "requested" } },
      });
      assert.equal(response.error, undefined);
      assert.match(responseText(response), /safeFunction/);
      assert.doesNotMatch(responseText(response), /exfiltratedSecret/);
      assert.match(responseText(response), /"filesScanned": \[\s*"src\/safe\.ts"\s*\]/);
      assert.equal(consoleCalls, 0);
    } finally {
      console.log = originalLog;
      console.error = originalError;
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      await server.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
