#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertArtifactVerified,
  assertPreparedCandidate,
  candidateReceiptFilename,
  loadAndVerifyReleaseCandidate,
  writeCandidateReceipt,
} from "./release-candidate.mjs";
import { executeReleaseGate, notRunReleaseGate } from "./release-gate-runner.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptPath = path.join(repoRoot, candidateReceiptFilename);

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function assertSourceIdentity(receipt) {
  if (git(["rev-parse", "HEAD"]) !== receipt.source.commit) {
    throw new Error("Release candidate receipt is bound to a different commit");
  }
  if (git(["status", "--porcelain", "--untracked-files=all"])) {
    throw new Error("Release candidate verification requires a clean worktree");
  }
}

function assertPackMetadata(candidate) {
  const packData = JSON.parse(fs.readFileSync(path.join(repoRoot, "pack.json"), "utf8"));
  const packEntry = packData[0];
  for (const field of ["name", "version", "filename", "size", "shasum", "integrity"]) {
    if (packEntry?.[field] !== candidate.receipt.artifact[field]) {
      throw new Error(`pack.json ${field} is not bound to the release candidate receipt`);
    }
  }
}

const candidate = loadAndVerifyReleaseCandidate(repoRoot, receiptPath);
assertSourceIdentity(candidate.receipt);
if (process.argv.includes("--check-only")) {
  assertArtifactVerified(candidate.receipt);
  console.log(JSON.stringify(candidate.receipt, null, 2));
  process.exit(0);
}
if (candidate.receipt.artifactStatus === "verified") {
  assertArtifactVerified(candidate.receipt);
  console.log(JSON.stringify(candidate.receipt, null, 2));
  process.exit(0);
}
assertPreparedCandidate(candidate.receipt);
assertPackMetadata(candidate);

const definitions = [
  {
    name: "pack-guard",
    command: process.execPath,
    args: [path.join(repoRoot, "scripts", "pack-guard.js")],
    evidence: "Tarball structure and all declared export/bin artifacts validated",
  },
  {
    name: "packed-consumer-smoke",
    command: process.execPath,
    args: [path.join(repoRoot, "scripts", "consumer-smoke-test.mjs"), "--candidate", receiptPath],
    evidence: "Exact retained tarball installed into disposable consumers and exercised",
  },
  {
    name: "packed-consumer-smoke-ignore-scripts",
    command: process.execPath,
    args: [
      path.join(repoRoot, "scripts", "consumer-smoke-test.mjs"),
      "--candidate",
      receiptPath,
      "--ignore-scripts",
    ],
    evidence:
      "Exact retained tarball exercised after lifecycle-disabled installs without rebuilding native code",
  },
  {
    name: "npm-publish-dry-run",
    command: process.execPath,
    args: [path.join(repoRoot, "scripts", "verify-npm-publishability.mjs")],
    evidence:
      "npm accepted the absent candidate in dry-run mode or exposed the exact retained integrity",
  },
];

const receipt = candidate.receipt;
for (let index = 0; index < definitions.length; index++) {
  const definition = definitions[index];
  const execution = executeReleaseGate({
    ...definition,
    cwd: repoRoot,
    commit: receipt.source.commit,
  });
  receipt.gates.push(execution.result);

  if (execution.result.status === "passed") {
    try {
      loadAndVerifyReleaseCandidate(repoRoot, receiptPath);
      assertSourceIdentity(receipt);
    } catch (error) {
      execution.result.status = "failed";
      execution.result.exitCode = 1;
      execution.result.error = error.message;
    }
  }

  if (execution.result.status !== "passed") {
    for (const remaining of definitions.slice(index + 1)) {
      receipt.gates.push(
        notRunReleaseGate({
          ...remaining,
          cwd: repoRoot,
          commit: receipt.source.commit,
        })
      );
    }
    receipt.artifactStatus = "failed";
    receipt.failedAt = new Date().toISOString();
    writeCandidateReceipt(repoRoot, receiptPath, receipt);
    process.exit(execution.result.exitCode ?? 1);
  }
}

receipt.artifactStatus = "verified";
receipt.verifiedAt = new Date().toISOString();
writeCandidateReceipt(repoRoot, receiptPath, receipt);
const sealedCandidate = loadAndVerifyReleaseCandidate(repoRoot, receiptPath);
assertSourceIdentity(sealedCandidate.receipt);
assertArtifactVerified(sealedCandidate.receipt);
console.log(JSON.stringify(sealedCandidate.receipt, null, 2));
