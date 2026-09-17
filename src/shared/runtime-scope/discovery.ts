import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

import type { WorkspaceSelectorV1 } from "./authority.js";
import {
  LOCAL_BINDING_CONTRACT_VERSION,
  type ProviderRepositoryEvidenceV1,
  type RepositoryDeclarationV1,
  type RepositoryInstanceEvidenceV1,
} from "./bindings.js";
import type { AuthenticationRef, ContentDigest, RepositoryId, RepositorySlug } from "./ids.js";
import type {
  RuntimeAuthorityMode,
  RuntimeScopeDiscoveryAdapterV1,
  RuntimeScopeDiscoveryV1,
  TrustedRuntimeEntrypoint,
} from "./bootstrap.js";
import type { BootstrapInputSnapshotV1 } from "./surface.js";
import { executionSurfacePathsAreRelated, normalizeExecutionSurfacePath } from "./surface.js";

export const REPOSITORY_DECLARATION_FILE = "lex.repository.json";

export interface TrustedRuntimeSelectionV1 {
  readonly authenticationRef: AuthenticationRef;
  readonly requestedWorkspace: WorkspaceSelectorV1;
  readonly authorityMode: RuntimeAuthorityMode;
  readonly authoritySource: string;
  readonly authorityCacheExpiresAt: string;
}

/**
 * Trusted authentication/workspace selection stays separate from filesystem
 * discovery. A host may back this provider with PostgreSQL, a credential
 * broker, or an explicitly bounded local authority implementation.
 */
export interface TrustedRuntimeSelectionProviderV1 {
  select(request: {
    readonly entrypoint: TrustedRuntimeEntrypoint;
    readonly bootstrap: BootstrapInputSnapshotV1;
    readonly projectRoot: string;
    readonly repositoryDeclaration?: RepositoryDeclarationV1;
    readonly repositoryEvidence: RepositoryInstanceEvidenceV1;
  }): Promise<TrustedRuntimeSelectionV1>;
}

export interface NativeGitEvidenceV1 {
  readonly root: string;
  readonly commonDirectory: string;
  readonly remote?: string;
  readonly branch?: string;
  readonly commitSha?: string;
}

export interface NativeGitEvidenceProviderV1 {
  inspect(cwd: string): Promise<NativeGitEvidenceV1 | null>;
}

export interface NodeRuntimeScopeDiscoveryOptionsV1 {
  readonly selection: TrustedRuntimeSelectionProviderV1;
  readonly git?: NativeGitEvidenceProviderV1;
  readonly declarationFileName?: string;
}

const execFileAsync = promisify(execFile);

function contentDigest(value: string | Buffer): ContentDigest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as ContentDigest;
}

function requireTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError("authorityCacheExpiresAt must be an ISO-compatible timestamp.");
  }
  return value;
}

function requireNonEmpty(value: string, name: string): string {
  if (value.trim().length === 0) throw new TypeError(`${name} cannot be empty.`);
  return value;
}

function parseProviderRemote(remote: string): ProviderRepositoryEvidenceV1 | undefined {
  const normalized = remote.trim().replace(/\\/g, "/");
  const match = normalized.match(
    /^(?:https?:\/\/|ssh:\/\/git@|git@)(github\.com|gitlab\.com)(?::|\/)(.+?)(?:\.git)?$/i
  );
  if (!match) return undefined;
  const provider = match[1].toLowerCase();
  const providerRepositoryId = match[2].replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  if (!providerRepositoryId.includes("/")) return undefined;
  return Object.freeze({
    provider,
    providerRepositoryId,
    remoteDigest: contentDigest(normalized),
  });
}

async function gitValue(cwd: string, args: readonly string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", [...args], {
      cwd,
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const value = stdout.trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Native Git inspection uses argv execution, never a shell command string. */
export class NodeNativeGitEvidenceProvider implements NativeGitEvidenceProviderV1 {
  async inspect(cwd: string): Promise<NativeGitEvidenceV1 | null> {
    const root = await gitValue(cwd, ["rev-parse", "--show-toplevel"]);
    if (!root) return null;
    const commonDirectoryValue = await gitValue(root, ["rev-parse", "--git-common-dir"]);
    if (!commonDirectoryValue) return null;
    const commonDirectory = isAbsolute(commonDirectoryValue)
      ? commonDirectoryValue
      : resolve(root, commonDirectoryValue);
    const remote = await gitValue(root, ["remote", "get-url", "origin"]);
    const branch = await gitValue(root, ["branch", "--show-current"]);
    const commitSha = await gitValue(root, ["rev-parse", "HEAD"]);
    return Object.freeze({
      root,
      commonDirectory,
      ...(remote ? { remote } : {}),
      ...(branch ? { branch } : {}),
      ...(commitSha ? { commitSha } : {}),
    });
  }
}

async function declarationAt(
  projectRoot: string,
  declarationFileName: string
): Promise<{ readonly declaration?: RepositoryDeclarationV1; readonly digest?: ContentDigest }> {
  const path = join(projectRoot, declarationFileName);
  if (!existsSync(path)) return {};
  const source = await readFile(path);
  const parsed = JSON.parse(source.toString("utf8")) as Record<string, unknown>;
  if (
    parsed.schemaVersion !== LOCAL_BINDING_CONTRACT_VERSION ||
    typeof parsed.repositoryId !== "string" ||
    parsed.repositoryId.trim().length === 0 ||
    typeof parsed.repositorySlug !== "string" ||
    parsed.repositorySlug.trim().length === 0
  ) {
    throw new TypeError(`${declarationFileName} is not a valid repository declaration v1.`);
  }
  const preferred = parsed.preferredWorkspace;
  if (
    preferred !== undefined &&
    (typeof preferred !== "object" ||
      preferred === null ||
      typeof (preferred as Record<string, unknown>).workspaceSlug !== "string" ||
      ((preferred as Record<string, unknown>).tenantSlug !== undefined &&
        typeof (preferred as Record<string, unknown>).tenantSlug !== "string"))
  ) {
    throw new TypeError(`${declarationFileName} has an invalid preferred workspace hint.`);
  }
  const declaration: RepositoryDeclarationV1 = Object.freeze({
    schemaVersion: LOCAL_BINDING_CONTRACT_VERSION,
    repositoryId: parsed.repositoryId as RepositoryId,
    repositorySlug: parsed.repositorySlug as RepositorySlug,
    ...(preferred
      ? {
          preferredWorkspace: Object.freeze({
            ...((preferred as Record<string, unknown>).tenantSlug
              ? { tenantSlug: (preferred as Record<string, unknown>).tenantSlug as never }
              : {}),
            workspaceSlug: (preferred as Record<string, unknown>).workspaceSlug as never,
          }),
        }
      : {}),
  });
  return { declaration, digest: contentDigest(source) };
}

function findDeclarationRoot(start: string, declarationFileName: string): string | undefined {
  let current = start;
  while (true) {
    if (existsSync(join(current, declarationFileName))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function callerRoot(bootstrap: BootstrapInputSnapshotV1): string {
  const discovered =
    bootstrap.allowedEnvironment.LEX_WORKSPACE_ROOT ??
    bootstrap.allowedEnvironment.LEX_APP_ROOT ??
    bootstrap.cwd;
  return normalizeExecutionSurfacePath(discovered, bootstrap.executionSurface, "caller root");
}

function immutableWorkspaceSelector(selector: WorkspaceSelectorV1): WorkspaceSelectorV1 {
  return "workspaceId" in selector
    ? Object.freeze({ workspaceId: selector.workspaceId })
    : Object.freeze({
        tenant:
          "tenantId" in selector.tenant
            ? Object.freeze({ tenantId: selector.tenant.tenantId })
            : Object.freeze({ tenantSlug: selector.tenant.tenantSlug }),
        workspaceSlug: selector.workspaceSlug,
      });
}

/**
 * Production filesystem/native-Git discovery. It finds and hashes evidence;
 * it never chooses a tenant, principal, workspace, grant, or registry path.
 */
export class NodeRuntimeScopeDiscoveryAdapter implements RuntimeScopeDiscoveryAdapterV1 {
  private readonly git: NativeGitEvidenceProviderV1;
  private readonly declarationFileName: string;

  constructor(private readonly options: NodeRuntimeScopeDiscoveryOptionsV1) {
    this.git = options.git ?? new NodeNativeGitEvidenceProvider();
    this.declarationFileName = options.declarationFileName ?? REPOSITORY_DECLARATION_FILE;
    if (basename(this.declarationFileName) !== this.declarationFileName) {
      throw new TypeError("declarationFileName must be one filename, not a path.");
    }
  }

  async discover(request: {
    readonly entrypoint: TrustedRuntimeEntrypoint;
    readonly bootstrap: BootstrapInputSnapshotV1;
  }): Promise<RuntimeScopeDiscoveryV1> {
    // Compare canonical filesystem paths on both sides. Windows short names and
    // caller symlinks can otherwise look unrelated to the canonical Git root.
    const start = normalizeExecutionSurfacePath(
      await realpath(callerRoot(request.bootstrap)),
      request.bootstrap.executionSurface,
      "canonical caller root"
    );
    const git = await this.git.inspect(start);
    const unnormalizedRoot =
      git?.root ?? findDeclarationRoot(start, this.declarationFileName) ?? start;
    const nativeRoot = normalizeExecutionSurfacePath(
      unnormalizedRoot,
      request.bootstrap.executionSurface,
      "repository root"
    );
    const projectRoot = normalizeExecutionSurfacePath(
      await realpath(nativeRoot),
      request.bootstrap.executionSurface,
      "canonical repository root"
    );
    if (!executionSurfacePathsAreRelated(start, projectRoot, request.bootstrap.executionSurface)) {
      throw new TypeError("Native repository discovery returned an unrelated project root.");
    }
    const rootStat = await stat(projectRoot);
    if (!rootStat.isDirectory())
      throw new TypeError("Discovered repository root is not a directory.");

    const declarationResult = await declarationAt(projectRoot, this.declarationFileName);
    const provider = git?.remote ? parseProviderRemote(git.remote) : undefined;
    const repositoryEvidence: RepositoryInstanceEvidenceV1 = Object.freeze({
      schemaVersion: LOCAL_BINDING_CONTRACT_VERSION,
      canonicalRoot: projectRoot,
      ...(declarationResult.digest ? { manifestDigest: declarationResult.digest } : {}),
      ...(git?.commonDirectory
        ? { gitCommonDirectoryDigest: contentDigest(await realpath(git.commonDirectory)) }
        : {}),
      filesystemEvidenceDigest: contentDigest(
        JSON.stringify([rootStat.dev, rootStat.ino, rootStat.birthtimeMs])
      ),
      ...(provider ? { provider } : {}),
    });
    const selection = await this.options.selection.select({
      entrypoint: request.entrypoint,
      bootstrap: request.bootstrap,
      projectRoot,
      ...(declarationResult.declaration
        ? { repositoryDeclaration: declarationResult.declaration }
        : {}),
      repositoryEvidence,
    });

    return Object.freeze({
      schemaVersion: 1,
      projectRoot,
      authenticationRef: requireNonEmpty(
        selection.authenticationRef,
        "authenticationRef"
      ) as AuthenticationRef,
      requestedWorkspace: immutableWorkspaceSelector(selection.requestedWorkspace),
      ...(declarationResult.declaration
        ? { repositoryDeclaration: declarationResult.declaration }
        : {}),
      repositoryEvidence,
      authorityMode: selection.authorityMode,
      authoritySource: requireNonEmpty(selection.authoritySource, "authoritySource"),
      authorityCacheExpiresAt: requireTimestamp(selection.authorityCacheExpiresAt),
      ...(git?.branch || git?.commitSha
        ? {
            sourceRevision: Object.freeze({
              ...(git.branch ? { branch: git.branch } : {}),
              ...(git.commitSha ? { commitSha: git.commitSha } : {}),
            }),
          }
        : {}),
    });
  }
}
