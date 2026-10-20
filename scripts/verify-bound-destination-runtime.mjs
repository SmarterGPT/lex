#!/usr/bin/env node
/* eslint-disable no-console -- CLI verification evidence and failures */
/** Public-package trusted-path proof. Synthetic authority, disposable files and in-memory stores only. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function verifyBoundDestinationRuntime(packageRoot) {
  const root = realpathSync(packageRoot);
  const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(metadata.name, "@smartergpt/lex");
  const load = (subpath) => {
    const target = metadata.exports[`./${subpath}`]?.import;
    assert.ok(
      typeof target === "string" && target.startsWith("./"),
      "Use a declared public import entrypoint"
    );
    const filename = resolve(root, target);
    assert.ok(
      filename.startsWith(root + sep),
      "Public target must stay inside the installed package"
    );
    return import(pathToFileURL(filename).href);
  };
  const runtime = await load("runtime-scope");
  const { run } = await load("cli");
  const { MCPServer } = await load("mcp-server");
  const { MemoryScopedFrameStoreBackend } = await load("store");
  const temporaryParent = realpathSync.native(tmpdir());
  const temporary = realpathSync.native(
    mkdtempSync(join(temporaryParent, "Lex-MixedCase-Packed-Destination-"))
  );
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 3600000).toISOString();
  const ids = {
    tenantId: "01900000-0000-7000-8000-000000000001",
    workspaceId: "01900000-0000-7000-8000-000000000101",
    principalId: "01900000-0000-7000-8000-000000000201",
    repositoryId: "synthetic-repository",
  };
  const capabilities = runtime.capabilitiesForCliOperation("remember");
  const common = { schemaVersion: 1, state: "active", authorityVersion: "v1" };
  const authority = new runtime.InMemoryAuthorityDirectory(
    {
      principals: [{ ...common, principalId: ids.principalId }],
      tenants: [{ ...common, tenantId: ids.tenantId, tenantSlug: "synthetic" }],
      workspaces: [
        {
          ...common,
          tenantId: ids.tenantId,
          workspaceId: ids.workspaceId,
          workspaceSlug: "synthetic",
        },
      ],
      repositories: [{ ...common, repositoryId: ids.repositoryId, repositorySlug: "synthetic" }],
      authentication: [
        { authenticationRef: "auth:synthetic-packed", principalId: ids.principalId },
      ],
      grants: [
        {
          grant: {
            schemaVersion: 1,
            grantId: "synthetic-grant",
            tenantId: ids.tenantId,
            workspaceId: ids.workspaceId,
            principalId: ids.principalId,
            capabilities,
            authorityVersion: "v1",
            scopeVersion: "v1",
            authorityDigest: "sha256:synthetic-authority",
            verifiedAt: now,
            expiresAt: expires,
          },
        },
      ],
    },
    () => now
  );
  const discovery = new runtime.NodeRuntimeScopeDiscoveryAdapter({
    selection: {
      async select() {
        return {
          authenticationRef: "auth:synthetic-packed",
          requestedWorkspace: { workspaceId: ids.workspaceId },
          authorityMode: "shared",
          authoritySource: "synthetic-packed",
          authorityCacheExpiresAt: expires,
        };
      },
    },
  });
  const capture = (root) => ({
    argv: ["node", "lex"],
    cwd: root,
    environment: { HOME: temporary, USERPROFILE: temporary, LOCALAPPDATA: temporary },
    platform: process.platform,
    installationRef: process.execPath,
    capturedAt: now,
  });
  const bootstrap = runtime.captureTrustedBootstrapInput(capture(temporary));
  const discovered = await discovery.discover({ entrypoint: "cli", bootstrap });
  assert.equal(discovered.projectRoot, temporary);
  const registry = runtime.SqliteLocalBindingRegistry.initialize({
    databasePath: ":memory:",
    registryInstanceId: "synthetic-registry",
    executionSurfaceId: "synthetic-surface",
    executionSurface: bootstrap.executionSurface,
    createdAt: now,
    now: () => now,
  });
  const memory = new MemoryScopedFrameStoreBackend();
  let saved = 0;
  let listed = 0;
  let frameReads = 0;
  let frameMutations = 0;
  let server;
  try {
    await registry.registerBinding({
      tenantId: ids.tenantId,
      workspaceId: ids.workspaceId,
      repositoryId: ids.repositoryId,
      repositoryInstanceId: "synthetic-repository-instance",
      workspaceInstanceId: "synthetic-workspace-instance",
      evidence: discovered.repositoryEvidence,
      authorityEvidence: {
        schemaVersion: 1,
        authoritySource: "synthetic-packed",
        authorityVersion: "v1",
        authorityDigest: "sha256:synthetic-authority",
        verifiedAt: now,
        expiresAt: expires,
      },
      registeredByPrincipalId: ids.principalId,
    });
    const [binding] = await registry.inspectBindings();
    if (process.platform === "win32") {
      assert.equal(binding.evidence.canonicalRoot, temporary.toLowerCase());
      assert.notEqual(
        binding.evidence.canonicalRoot,
        discovered.repositoryEvidence.canonicalRoot,
        "Mixed-case native discovery must exercise the published regression"
      );
    }
    const makeGuard = (root) =>
      runtime.createTrustedRuntimeScopeEntrypointGuard({
        process: capture(root),
        runtimeId: "synthetic-runtime",
        traceId: "synthetic-trace",
        authorityDirectory: authority,
        discovery,
        registryFactory: {
          openReadOnly() {
            return { registry, close() {} };
          },
        },
      });
    const binder = {
      bind(scope) {
        const store = memory.bind(scope);
        const originalMetadata = store.getMetadata.bind(store);
        store.getMetadata = () => ({
          ...originalMetadata(),
          backendIdentity: runtime.verifiedBackendIdentity({
            identity: `memory-fixture-v1:sha256:${"a".repeat(64)}`,
            verifiedAt: now,
            connectionClass: "unknown",
          }),
        });
        for (const name of [
          "getFrameById",
          "searchFrames",
          "listFrames",
          "getFrameCount",
          "getStats",
          "getTurnCostMetrics",
          "getHealth",
        ]) {
          const original = store[name].bind(store);
          store[name] = async (...args) => {
            frameReads++;
            return original(...args);
          };
        }
        for (const name of [
          "saveFrame",
          "saveFrames",
          "deleteFrame",
          "deleteFramesBefore",
          "deleteFramesByBranch",
          "deleteFramesByModule",
          "updateFrame",
          "purgeSuperseded",
        ]) {
          const original = store[name].bind(store);
          store[name] = async (...args) => {
            frameMutations++;
            return original(...args);
          };
        }
        const save = store.saveFrame.bind(store);
        store.saveFrame = async (frame) => {
          saved++;
          return save(frame);
        };
        const list = store.listFrames.bind(store);
        store.listFrames = async (options) => {
          listed++;
          return list(options);
        };
        return store;
      },
    };
    async function cli(guard, args) {
      const output = [];
      const write = process.stdout.write;
      process.stdout.write = function (chunk) {
        output.push(String(chunk));
        return true;
      };
      try {
        await run(["node", "lex", "--json", ...args], {
          runtimeScope: { ...guard, frameStoreBinder: binder, emitDiagnostics() {} },
        });
        return output
          .join("")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .at(-1);
      } finally {
        process.stdout.write = write;
      }
    }
    const guard = makeGuard(temporary);
    const preflight = await cli(guard, ["destination"]);
    const expected = preflight.data.destination.identity;
    assert.match(expected, /^lex-destination-v1:sha256:/);
    const variant =
      process.platform === "win32" ? temporary.toLowerCase().replace(/\\/g, "/") : temporary;
    const alternate = makeGuard(variant);
    const alternatePreflight = await cli(alternate, ["destination"]);
    assert.deepEqual(alternatePreflight.data.destination, preflight.data.destination);
    server = new MCPServer({ runtimeScope: alternate, frameStoreBinder: binder });
    const call = (name, args = {}) =>
      server.handleRequest({ method: "tools/call", params: { name, arguments: args } });
    const mcpPreflight = await call("destination_inspect");
    assert.equal(mcpPreflight.error, undefined);
    assert.deepEqual(mcpPreflight.data.destination, preflight.data.destination);
    assert.equal(saved, 0);
    assert.equal(listed, 0);
    assert.equal(frameReads, 0);
    assert.equal(frameMutations, 0);
    const result = await cli(alternate, [
      "remember",
      "--summary",
      "Synthetic packed destination",
      "--reference-point",
      "packed-native",
      "--next",
      "continue",
      "--modules",
      "workspace/unscoped",
      "--skip-policy",
      "--expected-destination",
      expected,
    ]);
    assert.equal(result.code, "FRAME_CREATED");
    const frame = {
      summary_caption: "Synthetic packed destination",
      reference_point: "packed-native",
      status_snapshot: { next_action: "continue" },
      module_scope: ["workspace/unscoped"],
    };
    const mcpWrite = await call("frame_create", { ...frame, expected_destination: expected });
    assert.equal(mcpWrite.error, undefined);
    assert.equal(saved, 2);
    const listedBeforeMismatch = listed;
    const readsBeforeMismatch = frameReads;
    const mutationsBeforeMismatch = frameMutations;
    const rejected = await call("frame_create", {
      ...frame,
      expected_destination: `lex-destination-v1:sha256:${"f".repeat(64)}`,
    });
    assert.equal(rejected.error.code, "LEX_DESTINATION_MISMATCH");
    assert.equal(saved, 2);
    assert.equal(listed, listedBeforeMismatch);
    assert.equal(frameReads, readsBeforeMismatch);
    assert.equal(frameMutations, mutationsBeforeMismatch);
    console.log(
      `Packed native ${process.platform} discovery + real registry + CLI/MCP bound destination/write proof passed (synthetic stores only)`
    );
  } finally {
    await server?.close();
    await memory.close();
    registry.close();
    const target = resolve(temporary);
    assert.ok(target.startsWith(resolve(temporaryParent) + sep));
    rmSync(target, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyBoundDestinationRuntime(
    process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), "..")
  );
}
