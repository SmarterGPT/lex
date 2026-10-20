#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveExpectedPackTarball } from "./pack-artifact-path.mjs";
import { loadAndVerifyReleaseCandidate } from "./release-candidate.mjs";
import { runNpm } from "./run-npm.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-consumer-smoke-"));
const sourcePackageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
let tarballPath;
let ownsTarball = true;
const ignoreScripts = process.argv.includes("--ignore-scripts");
const installFlags = ["--no-audit", "--no-fund", ...(ignoreScripts ? ["--ignore-scripts"] : [])];

function run(command, args, { cwd = repoRoot, capture = false } = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function parsePackResult(output) {
  const jsonStart = output.indexOf("[");
  const jsonEnd = output.lastIndexOf("]") + 1;
  if (jsonStart === -1 || jsonEnd === 0) {
    throw new Error("Could not find JSON output from npm pack");
  }
  return JSON.parse(output.slice(jsonStart, jsonEnd));
}

try {
  const candidateArgument = process.argv.indexOf("--candidate");
  if (candidateArgument >= 0) {
    const receiptPath = process.argv[candidateArgument + 1];
    if (!receiptPath) throw new Error("--candidate requires a receipt path");
    tarballPath = loadAndVerifyReleaseCandidate(repoRoot, receiptPath).tarballPath;
    ownsTarball = false;
    console.log(`==> Using retained candidate artifact ${path.basename(tarballPath)}`);
  } else {
    console.log("==> Building and checking the source package");
    runNpm(["run", "build"], { cwd: repoRoot });
    runNpm(["run", "check:public-api"], { cwd: repoRoot });

    console.log("==> Packing the candidate artifact");
    const packData = parsePackResult(
      runNpm(["pack", "--ignore-scripts", "--json"], { cwd: repoRoot, capture: true })
    );
    tarballPath = resolveExpectedPackTarball(repoRoot, packData[0], sourcePackageJson);
  }

  console.log("==> Installing the tarball into a clean consumer");
  runNpm(["init", "--yes"], { cwd: testDir });
  runNpm(["pkg", "set", "type=module", "private=true"], { cwd: testDir });
  runNpm(["install", tarballPath, ...installFlags], { cwd: testDir });

  const packageRoot = path.join(testDir, "node_modules", "@smartergpt", "lex");
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));

  console.log("==> Executing the installed CLI artifact");
  const cliPath = path.join(packageRoot, packageJson.bin.lex.replace(/^\.\//, ""));
  const cliVersion = run(process.execPath, [cliPath, "--version"], {
    cwd: testDir,
    capture: true,
  }).trim();
  if (cliVersion !== packageJson.version) {
    throw new Error(
      `Installed CLI version mismatch: expected ${packageJson.version}, got ${cliVersion}`
    );
  }

  for (const script of [
    "public-api-contract.mjs",
    "verify-public-api.mjs",
    "verify-sharp-runtime.mjs",
    "verify-sqlite-runtime.mjs",
  ]) {
    fs.copyFileSync(path.join(repoRoot, "scripts", script), path.join(testDir, script));
  }

  console.log("==> Validating all declared runtime exports");
  run(
    process.execPath,
    [
      "verify-public-api.mjs",
      "--package-root",
      packageRoot,
      "--skip-docs",
      "--write-consumer-types",
      path.join(testDir, "public-api-consumer.ts"),
    ],
    { cwd: testDir }
  );

  console.log("==> Exercising the installed image-rendering runtime");
  run(process.execPath, ["verify-sharp-runtime.mjs", packageRoot], { cwd: testDir });

  console.log("==> Verifying the installed lifecycle/native dependency boundary");
  run(process.execPath, ["verify-sqlite-runtime.mjs", packageRoot], { cwd: testDir });
  fs.appendFileSync(
    path.join(testDir, "public-api-consumer.ts"),
    `
import { createDatabase, getDb, SqliteFrameStore } from "@smartergpt/lex/store";
function cipherHandleTypes(db: ReturnType<typeof createDatabase>, singleton: ReturnType<typeof getDb>, store: SqliteFrameStore): number[] {
  return [db.key(Buffer.alloc(32)), db.rekey(Buffer.alloc(32)), singleton.key(Buffer.alloc(32)), store.db.rekey(Buffer.alloc(32))];
}
export { cipherHandleTypes };
`
  );

  console.log("==> Type-checking all declared exports from the packed package");
  run(
    process.execPath,
    [
      path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
      "--noEmit",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--resolveJsonModule",
      "--strict",
      "public-api-consumer.ts",
    ],
    { cwd: testDir }
  );

  console.log("==> Running the published consumer example");
  const consumerDir = path.join(testDir, "consumer-example");
  fs.cpSync(path.join(repoRoot, "examples", "consumer"), consumerDir, { recursive: true });
  runNpm(["install", tarballPath, ...installFlags], { cwd: consumerDir });
  const consumerPackageJson = JSON.parse(
    fs.readFileSync(path.join(consumerDir, "package.json"), "utf8")
  );
  const consumerLock = JSON.parse(
    fs.readFileSync(path.join(consumerDir, "package-lock.json"), "utf8")
  );
  const tarballName = path.basename(tarballPath);
  const dependencySpecifier = consumerPackageJson.dependencies?.["@smartergpt/lex"];
  const installedResolution = consumerLock.packages?.["node_modules/@smartergpt/lex"]?.resolved;
  const installedExamplePackage = path.join(consumerDir, "node_modules", "@smartergpt", "lex");
  if (
    !dependencySpecifier?.includes(tarballName) ||
    !installedResolution?.includes(tarballName) ||
    fs.lstatSync(installedExamplePackage).isSymbolicLink()
  ) {
    throw new Error("Consumer example did not resolve the packed tarball as an ordinary install");
  }
  const exampleOutput = runNpm(["start"], { cwd: consumerDir, capture: true });
  process.stdout.write(exampleOutput);
  if (!exampleOutput.includes("RECEIPT_OK")) {
    throw new Error("Consumer example did not emit RECEIPT_OK");
  }

  console.log("==> ✅ Packed consumer smoke test passed");
  console.log("    declared runtime export paths imported");
  console.log("    declaration entry points type-checked");
  console.log("    undeclared internal paths remained blocked");
  console.log("    installed sharp/libvips runtime generated a PNG");
  console.log("    installed CLI executed and reported the packed version");
  console.log("    consumer example emitted RECEIPT_OK");
} finally {
  fs.rmSync(testDir, { recursive: true, force: true });
  if (tarballPath && ownsTarball) {
    fs.rmSync(tarballPath, { force: true });
  }
}
