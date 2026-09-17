import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  NodeRuntimeScopeDiscoveryAdapter,
  REPOSITORY_DECLARATION_FILE,
  captureTrustedBootstrapInput,
  registryLocationFromBootstrap,
  type AuthenticationRef,
  type NativeGitEvidenceProviderV1,
  type RepositoryId,
  type TenantSlug,
  type WorkspaceSlug,
} from "../../../src/shared/runtime-scope/index.js";

const NOW = "2026-07-18T12:00:00.000Z";

describe("production runtime-scope discovery", () => {
  test("combines native repository evidence with separately trusted selection", async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "lex-discovery-")));
    const repository = join(root, "repo");
    const nested = join(repository, "src", "nested");
    const commonDirectory = join(repository, ".git-real");
    mkdirSync(nested, { recursive: true });
    mkdirSync(commonDirectory, { recursive: true });
    const callerAlias = join(root, "caller-alias");
    symlinkSync(nested, callerAlias, process.platform === "win32" ? "junction" : "dir");
    writeFileSync(
      join(repository, REPOSITORY_DECLARATION_FILE),
      JSON.stringify({
        schemaVersion: 1,
        repositoryId: "repository-lex",
        repositorySlug: "lex",
      })
    );
    const git: NativeGitEvidenceProviderV1 = {
      async inspect() {
        return {
          root: repository,
          commonDirectory,
          remote: "git@github.com:Guffawaffle/lex.git",
          branch: "agent/758-runtime-wiring",
          commitSha: "abc123",
        };
      },
    };
    let selectedEvidence = "";
    const discovery = new NodeRuntimeScopeDiscoveryAdapter({
      git,
      selection: {
        async select(request) {
          selectedEvidence = JSON.stringify(request.repositoryEvidence);
          return {
            authenticationRef: "auth:guff" as AuthenticationRef,
            requestedWorkspace: {
              tenant: { tenantSlug: "platform-dogfood" as TenantSlug },
              workspaceSlug: "lex" as WorkspaceSlug,
            },
            authorityMode: "shared",
            authoritySource: "authority:test",
            authorityCacheExpiresAt: "2026-07-18T12:30:00.000Z",
          };
        },
      },
    });
    try {
      const bootstrap = captureTrustedBootstrapInput({
        argv: ["node", "lex", "recall"],
        cwd: callerAlias,
        environment: { HOME: root },
        platform: process.platform,
        installationRef: process.execPath,
        capturedAt: NOW,
      });
      const result = await discovery.discover({ entrypoint: "cli", bootstrap });

      assert.equal(result.projectRoot, repository);
      assert.equal(result.repositoryDeclaration?.repositoryId, "repository-lex" as RepositoryId);
      assert.equal(result.repositoryEvidence.provider?.provider, "github.com");
      assert.equal(result.repositoryEvidence.provider?.providerRepositoryId, "Guffawaffle/lex");
      assert.ok(result.repositoryEvidence.gitCommonDirectoryDigest?.startsWith("sha256:"));
      assert.ok(result.repositoryEvidence.filesystemEvidenceDigest?.startsWith("sha256:"));
      assert.equal(result.sourceRevision?.branch, "agent/758-runtime-wiring");
      assert.equal(selectedEvidence.includes("auth:guff"), false);
      assert.equal(Object.isFrozen(result), true);
      assert.equal(Object.isFrozen(result.requestedWorkspace), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects unrelated native Git roots before trusted selection", async () => {
    const root = mkdtempSync(join(tmpdir(), "lex-discovery-unrelated-"));
    const caller = join(root, "caller");
    const unrelated = join(root, "unrelated");
    mkdirSync(caller, { recursive: true });
    mkdirSync(unrelated, { recursive: true });
    let selected = false;
    const discovery = new NodeRuntimeScopeDiscoveryAdapter({
      git: {
        async inspect() {
          return { root: unrelated, commonDirectory: unrelated };
        },
      },
      selection: {
        async select() {
          selected = true;
          throw new Error("must not run");
        },
      },
    });
    try {
      const bootstrap = captureTrustedBootstrapInput({
        argv: ["node", "lex"],
        cwd: caller,
        environment: { HOME: root },
        platform: process.platform,
        installationRef: process.execPath,
        capturedAt: NOW,
      });
      await assert.rejects(
        () => discovery.discover({ entrypoint: "cli", bootstrap }),
        /unrelated project root/
      );
      assert.equal(selected, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps Windows-native and WSL-native registry locations isolated", () => {
    const windows = captureTrustedBootstrapInput({
      argv: ["node", "lex"],
      cwd: "C:\\dev\\lex",
      environment: {
        LOCALAPPDATA: "C:\\Users\\Guff\\AppData\\Local",
        WSL_INTEROP: "/run/WSL/1_interop",
      },
      platform: "win32",
      installationRef: "C:\\Program Files\\nodejs\\node.exe",
      capturedAt: NOW,
    });
    const wsl = captureTrustedBootstrapInput({
      argv: ["node", "lex"],
      cwd: "/srv/lex",
      environment: {
        HOME: "/home/guff",
        XDG_STATE_HOME: "/home/guff/.local/state",
        WSL_DISTRO_NAME: "Ubuntu",
        WSL_INTEROP: "/run/WSL/1_interop",
      },
      platform: "linux",
      installationRef: "/usr/bin/node",
      capturedAt: NOW,
    });

    assert.equal(windows.executionSurface.kind, "windows-native");
    assert.equal(windows.executionSurface.launchOrigin, "wsl-interop");
    assert.equal(wsl.executionSurface.kind, "wsl");
    assert.notEqual(
      registryLocationFromBootstrap(windows).registryPath,
      registryLocationFromBootstrap(wsl).registryPath
    );
    const aliasedWsl = captureTrustedBootstrapInput({
      argv: ["node", "lex"],
      cwd: "/mnt/c/dev/lex",
      environment: {
        HOME: "/home/guff",
        XDG_STATE_HOME: "/mnt/c/Users/Guff/AppData/Local/Lex",
        WSL_DISTRO_NAME: "Ubuntu",
      },
      platform: "linux",
      installationRef: "/usr/bin/node",
      capturedAt: NOW,
    });
    assert.throws(() => registryLocationFromBootstrap(aliasedWsl));
  });
});
