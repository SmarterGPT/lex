#!/usr/bin/env node
/* eslint-disable no-console -- this file is the repository test-runner CLI */

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TEST_GROUP_TIMEOUT_MS = 20 * 60 * 1000;

/** Hard outer watchdog; test assertions retain their own normal completion behavior. */
export function runTestProcess(
  args,
  { cwd = repositoryRoot, timeoutMs = TEST_GROUP_TIMEOUT_MS } = {}
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid test deadline");
  return spawnSync(process.execPath, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
}

export const DEFAULT_EXCLUDED_TEST_PATHS = Object.freeze([
  "test/memory/api-ingestion.perf.test.ts",
  "test/memory/store/encryption-edge-cases.spec.ts",
  "test/shared/cli/export.test.ts",
  "test/shared/paths/normalizer.test.ts",
  "test/shared/tokens/expander.test.ts",
]);

export const DEFAULT_EXCLUDED_TEST_PREFIXES = Object.freeze(["test/shared/git/"]);

const excludedPathSet = new Set(DEFAULT_EXCLUDED_TEST_PATHS);

function portablePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function classifyDefaultTest(path) {
  const normalizedPath = portablePath(path);

  if (
    excludedPathSet.has(normalizedPath) ||
    DEFAULT_EXCLUDED_TEST_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))
  ) {
    return "excluded";
  }
  if (
    normalizedPath.endsWith(".test.ts") ||
    normalizedPath.endsWith(".test.mts") ||
    normalizedPath.endsWith(".spec.ts")
  ) {
    return "typescript";
  }
  if (normalizedPath.endsWith(".test.mjs")) {
    return "javascript";
  }
  return undefined;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
}

export function discoverDefaultTests(baseDir = repositoryRoot) {
  const files = walk(join(baseDir, "test"))
    .map((path) => portablePath(relative(baseDir, path)))
    .sort();
  const tests = {
    typescript: [],
    javascript: [],
    excluded: [],
  };

  for (const path of files) {
    const kind = classifyDefaultTest(path);
    if (kind) tests[kind].push(path);
  }

  return tests;
}

function runTestGroup(label, testPaths, baseDir) {
  if (testPaths.length === 0) return 0;

  console.log(`\nRunning ${testPaths.length} ${label} test files...`);
  const require = createRequire(join(baseDir, "package.json"));
  const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
  const result = runTestProcess(
    [
      "--import",
      tsxLoader,
      "--import",
      "./test/helpers/setup.ts",
      "--test",
      "--test-force-exit",
      ...testPaths,
    ],
    {
      cwd: baseDir,
    }
  );

  if (result.error?.code === "ETIMEDOUT") {
    console.error(
      `${label} test group exceeded ${TEST_GROUP_TIMEOUT_MS}ms (${testPaths.length} files); runner terminated. Check worker cleanup and the last reported test. Descendant cleanup is not proven by this result.`
    );
    return 1;
  }
  if (result.error) throw result.error;
  if (result.signal) {
    console.error(`${label} test process terminated by ${result.signal}`);
    return 1;
  }
  return result.status ?? 1;
}

export function runDefaultTests(baseDir = repositoryRoot) {
  const tests = discoverDefaultTests(baseDir);
  if (tests.typescript.length + tests.javascript.length === 0) {
    console.error("No default test files were discovered.");
    return 1;
  }

  // Timing budgets measure the workload, not contention with every functional test.
  // Keep the benchmark in the default gate, with unchanged assertions.
  const benchmark = "test/memory/benchmarks.test.ts";
  const typescriptStatus = runTestGroup(
    "TypeScript",
    tests.typescript.filter((path) => path !== benchmark),
    baseDir
  );
  if (typescriptStatus !== 0) return typescriptStatus;
  const javascriptStatus = runTestGroup("JavaScript", tests.javascript, baseDir);
  if (javascriptStatus !== 0) return javascriptStatus;
  return runTestGroup(
    "Benchmark",
    tests.typescript.filter((path) => path === benchmark),
    baseDir
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = runDefaultTests();
  } catch (error) {
    console.error(`Test runner failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
