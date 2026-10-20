import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";

import type { ExecutionSurfaceEvidenceV1, LaunchOrigin, NativePlatform } from "./bindings.js";
import { LOCAL_BINDING_CONTRACT_VERSION } from "./bindings.js";
import type { ContentDigest } from "./ids.js";

export const RUNTIME_SCOPE_IMPLEMENTATION_VERSION = 1 as const;

/** Inputs captured once by a trusted entrypoint before core resolution begins. */
export interface BootstrapInputSnapshotV1 {
  readonly schemaVersion: typeof RUNTIME_SCOPE_IMPLEMENTATION_VERSION;
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly allowedEnvironment: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  readonly executionSurface: ExecutionSurfaceEvidenceV1;
  readonly capturedAt: string;
}

/** Explicit platform facts used to classify one native Lex process. */
export interface ExecutionSurfaceDetectionInputV1 {
  readonly platform: NodeJS.Platform;
  readonly installationRef: string;
  readonly wslDistribution?: string;
  readonly launchOrigin?: LaunchOrigin;
}

export type RegistryLocationSource =
  | "windows-local-app-data"
  | "xdg-state-home"
  | "linux-home-fallback"
  | "macos-application-support"
  | "other-home-fallback";

/** Explicit host paths captured by an entrypoint or injected by an embedder. */
export interface RegistryLocationInputV1 {
  readonly executionSurface: ExecutionSurfaceEvidenceV1;
  readonly homeDirectory?: string;
  readonly localAppDataDirectory?: string;
  readonly xdgStateDirectory?: string;
}

export interface ResolvedRegistryLocationV1 {
  readonly schemaVersion: typeof RUNTIME_SCOPE_IMPLEMENTATION_VERSION;
  readonly registryPath: string;
  readonly source: RegistryLocationSource;
}

function requireNonEmpty(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new TypeError(`${name} must be captured explicitly and cannot be empty.`);
  }
  return value;
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function assertSurfaceVersion(surface: ExecutionSurfaceEvidenceV1): void {
  // Preserve the runtime guard for untyped JavaScript callers without letting
  // TypeScript narrow the v1 literal to `never` inside the failure branch.
  const schemaVersion: unknown = surface.schemaVersion;
  if (schemaVersion !== LOCAL_BINDING_CONTRACT_VERSION) {
    throw new TypeError(
      `executionSurface schema ${String(schemaVersion)} is not supported by schema ${LOCAL_BINDING_CONTRACT_VERSION}.`
    );
  }
}

/** Normalize an absolute path using the native path semantics of one execution surface. */
export function normalizeExecutionSurfacePath(
  value: string | undefined,
  surface: ExecutionSurfaceEvidenceV1,
  name: string
): string {
  assertSurfaceVersion(surface);
  const captured = requireNonEmpty(value, name);
  const path = surface.nativePlatform === "win32" ? win32 : posix;
  if (!path.isAbsolute(captured)) {
    throw new TypeError(`${name} must be an absolute ${surface.nativePlatform} path.`);
  }
  return path.normalize(captured);
}

/**
 * Lexical identity formatting shared with the trusted local binding registry.
 * Windows identity comparisons fold case; POSIX comparisons preserve it.
 * This does not discover files, resolve symlinks, or prove physical identity.
 */
export function normalizeExecutionSurfaceIdentityPath(
  value: string | undefined,
  surface: ExecutionSurfaceEvidenceV1,
  name: string
): string {
  const normalized = normalizeExecutionSurfacePath(value, surface, name);
  return surface.nativePlatform === "win32" ? normalized.toLowerCase() : normalized;
}

function isWithin(parent: string, child: string, surface: ExecutionSurfaceEvidenceV1): boolean {
  const path = surface.nativePlatform === "win32" ? win32 : posix;
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/** Return whether two absolute paths describe nested locations on one native surface. */
export function executionSurfacePathsAreRelated(
  left: string,
  right: string,
  surface: ExecutionSurfaceEvidenceV1
): boolean {
  const capturedLeft = normalizeExecutionSurfacePath(left, surface, "left path");
  const capturedRight = normalizeExecutionSurfacePath(right, surface, "right path");
  const normalizedLeft =
    surface.nativePlatform === "win32" ? capturedLeft.toLowerCase() : capturedLeft;
  const normalizedRight =
    surface.nativePlatform === "win32" ? capturedRight.toLowerCase() : capturedRight;
  return (
    isWithin(normalizedLeft, normalizedRight, surface) ||
    isWithin(normalizedRight, normalizedLeft, surface)
  );
}

function rejectCrossSurfaceRegistryPath(
  path: string,
  surface: ExecutionSurfaceEvidenceV1,
  name: string
): void {
  if (surface.kind === "wsl" && /^\/mnt\/[^/]+(?:\/|$)/iu.test(path)) {
    throw new TypeError(`${name} must remain inside the WSL filesystem.`);
  }
  if (surface.kind === "windows-native" && /^\\\\(?:wsl\$|wsl\.localhost)\\/iu.test(path)) {
    throw new TypeError(`${name} must remain inside the Windows filesystem.`);
  }
}

function digestFields(fields: readonly (string | undefined)[]): ContentDigest {
  const hash = createHash("sha256");
  for (const field of fields) {
    const value = field ?? "";
    hash.update(String(Buffer.byteLength(value, "utf8")));
    hash.update(":");
    hash.update(value);
    hash.update(";");
  }
  return `sha256:${hash.digest("hex")}` as ContentDigest;
}

export function nativePlatformFromNode(platform: NodeJS.Platform): NativePlatform {
  switch (platform) {
    case "win32":
    case "linux":
    case "darwin":
      return platform;
    default:
      return "other";
  }
}

/**
 * Classify a process from captured facts only. This function never reads
 * process.platform, process.env, cwd, OS release files, or mutable globals.
 */
export function detectExecutionSurface(
  input: ExecutionSurfaceDetectionInputV1
): ExecutionSurfaceEvidenceV1 {
  const installationRef = requireNonEmpty(input.installationRef, "installationRef");
  const nativePlatform = nativePlatformFromNode(input.platform);
  const wslDistribution = normalizeOptional(input.wslDistribution);
  const launchOrigin = input.launchOrigin ?? "native-shell";
  const kind =
    nativePlatform === "win32"
      ? "windows-native"
      : nativePlatform === "linux" && wslDistribution
        ? "wsl"
        : nativePlatform === "linux"
          ? "linux-native"
          : nativePlatform === "darwin"
            ? "macos-native"
            : "other";

  return Object.freeze({
    schemaVersion: LOCAL_BINDING_CONTRACT_VERSION,
    nativePlatform,
    kind,
    installationRef,
    ...(wslDistribution ? { wslDistribution } : {}),
    launchOrigin,
    evidenceDigest: digestFields([
      String(LOCAL_BINDING_CONTRACT_VERSION),
      nativePlatform,
      kind,
      installationRef,
      kind === "wsl" ? wslDistribution : undefined,
    ]),
  });
}

/** Resolve the standard local-registry path without consulting ambient state. */
export function resolveLocalRegistryLocation(
  input: RegistryLocationInputV1
): ResolvedRegistryLocationV1 {
  const { executionSurface } = input;
  assertSurfaceVersion(executionSurface);

  if (executionSurface.kind === "windows-native") {
    const localAppData = normalizeExecutionSurfacePath(
      input.localAppDataDirectory,
      executionSurface,
      "localAppDataDirectory for a Windows-native surface"
    );
    rejectCrossSurfaceRegistryPath(localAppData, executionSurface, "localAppDataDirectory");
    return Object.freeze({
      schemaVersion: RUNTIME_SCOPE_IMPLEMENTATION_VERSION,
      registryPath: win32.join(localAppData, "Lex", "registry.db"),
      source: "windows-local-app-data",
    });
  }

  if (executionSurface.kind === "macos-native") {
    const homeDirectory = normalizeExecutionSurfacePath(
      input.homeDirectory,
      executionSurface,
      "homeDirectory for a macOS-native surface"
    );
    return Object.freeze({
      schemaVersion: RUNTIME_SCOPE_IMPLEMENTATION_VERSION,
      registryPath: posix.join(
        homeDirectory,
        "Library",
        "Application Support",
        "Lex",
        "registry.db"
      ),
      source: "macos-application-support",
    });
  }

  const xdgStateDirectory = normalizeOptional(input.xdgStateDirectory);
  if (xdgStateDirectory) {
    const stateDirectory = normalizeExecutionSurfacePath(
      xdgStateDirectory,
      executionSurface,
      "xdgStateDirectory"
    );
    rejectCrossSurfaceRegistryPath(stateDirectory, executionSurface, "xdgStateDirectory");
    return Object.freeze({
      schemaVersion: RUNTIME_SCOPE_IMPLEMENTATION_VERSION,
      registryPath: posix.join(stateDirectory, "lex", "registry.db"),
      source: "xdg-state-home",
    });
  }

  const homeDirectory = normalizeExecutionSurfacePath(
    input.homeDirectory,
    executionSurface,
    "homeDirectory"
  );
  rejectCrossSurfaceRegistryPath(homeDirectory, executionSurface, "homeDirectory");

  return Object.freeze({
    schemaVersion: RUNTIME_SCOPE_IMPLEMENTATION_VERSION,
    registryPath: posix.join(homeDirectory, ".local", "state", "lex", "registry.db"),
    source:
      executionSurface.kind === "linux-native" || executionSurface.kind === "wsl"
        ? "linux-home-fallback"
        : "other-home-fallback",
  });
}

export type BootstrapInputSnapshot = BootstrapInputSnapshotV1;
export type ResolvedRegistryLocation = ResolvedRegistryLocationV1;
