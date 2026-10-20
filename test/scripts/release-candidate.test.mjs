import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertArtifactVerified,
  assertPublishedArtifact,
  assertPreparedCandidate,
  calculateArtifactEvidence,
  loadAndVerifyReleaseCandidate,
  requiredCandidateGates,
  writeCandidateReceipt,
} from "../../scripts/release-candidate.mjs";
import { createTestSymlinkOrSkip } from "../helpers/symlink.ts";

const commit = "a".repeat(40);

function successfulGate(name) {
  return {
    name,
    status: "passed",
    invocation: { executable: "node", argv: ["gate.mjs"] },
    cwd: "candidate-root",
    commit,
    durationMs: 1,
    exitCode: 0,
    output: {
      stdout: { text: "ok", truncated: false },
      stderr: { text: "", truncated: false },
    },
    evidence: "test evidence",
  };
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-release-candidate-"));
  const receiptPath = path.join(root, "release-candidate.json");
  const filename = "smartergpt-lex-4.0.1.tgz";
  const tarballPath = path.join(root, filename);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@smartergpt/lex", version: "4.0.1" })
  );
  fs.writeFileSync(tarballPath, "candidate bytes");
  const receipt = {
    schemaVersion: "lex-release-candidate-v2",
    artifactStatus: "prepared",
    acceptanceStatus: "external-required",
    package: { name: "@smartergpt/lex", version: "4.0.1" },
    source: {
      commit,
      validatedMain: commit,
      releaseIdentity: {
        tag: "v4.0.1",
        tagObject: "b".repeat(40),
        targetCommit: commit,
        tagSigner: "A".repeat(40),
        commitSigner: "B".repeat(40),
      },
      worktreeClean: true,
    },
    artifact: {
      name: "@smartergpt/lex",
      version: "4.0.1",
      filename,
      ...calculateArtifactEvidence(tarballPath),
    },
    createdAt: new Date().toISOString(),
    gates: requiredCandidateGates.slice(0, 3).map(successfulGate),
  };
  writeCandidateReceipt(root, receiptPath, receipt);
  return { root, receiptPath, tarballPath, receipt };
}

test("release candidate receipt is bound to the exact retained tarball bytes", () => {
  const fixture = createFixture();
  try {
    assert.equal(
      loadAndVerifyReleaseCandidate(fixture.root, fixture.receiptPath).tarballPath,
      fixture.tarballPath
    );
    assertPreparedCandidate(fixture.receipt);
    fixture.receipt.source.releaseIdentity.targetCommit = "c".repeat(40);
    writeCandidateReceipt(fixture.root, fixture.receiptPath, fixture.receipt);
    assert.throws(
      () => loadAndVerifyReleaseCandidate(fixture.root, fixture.receiptPath),
      /main or signed-tag identity/
    );
    fixture.receipt.source.releaseIdentity.targetCommit = commit;
    writeCandidateReceipt(fixture.root, fixture.receiptPath, fixture.receipt);
    assert.throws(() => assertArtifactVerified(fixture.receipt), /has not completed/);

    fixture.receipt.artifactStatus = "verified";
    fixture.receipt.verifiedAt = new Date().toISOString();
    fixture.receipt.gates = requiredCandidateGates.map(successfulGate);
    assert.doesNotThrow(() => assertArtifactVerified(fixture.receipt));
    assert.doesNotThrow(() =>
      assertPublishedArtifact(fixture.receipt, {
        version: fixture.receipt.package.version,
        "dist.integrity": fixture.receipt.artifact.integrity,
      })
    );
    assert.throws(
      () =>
        assertPublishedArtifact(fixture.receipt, {
          version: fixture.receipt.package.version,
          "dist.integrity": "sha512-wrong",
        }),
      /does not match/
    );

    fixture.receipt.gates.push(successfulGate(requiredCandidateGates.at(-1)));
    assert.throws(() => assertArtifactVerified(fixture.receipt), /exact required/);

    fs.appendFileSync(fixture.tarballPath, "tampered");
    assert.throws(
      () => loadAndVerifyReleaseCandidate(fixture.root, fixture.receiptPath),
      /does not match/
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("release candidate loader rejects a linked tarball", (t) => {
  const fixture = createFixture();
  const external = path.join(fixture.root, "external.tgz");
  try {
    fs.writeFileSync(external, "candidate bytes");
    fs.rmSync(fixture.tarballPath);
    if (!createTestSymlinkOrSkip(t, external, fixture.tarballPath)) return;
    assert.throws(
      () => loadAndVerifyReleaseCandidate(fixture.root, fixture.receiptPath),
      /regular non-link/
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("atomic receipt writer rejects an existing receipt link", (t) => {
  const fixture = createFixture();
  const external = path.join(fixture.root, "external.json");
  try {
    fs.writeFileSync(external, "{}");
    fs.rmSync(fixture.receiptPath);
    if (!createTestSymlinkOrSkip(t, external, fixture.receiptPath)) return;
    assert.throws(
      () => writeCandidateReceipt(fixture.root, fixture.receiptPath, fixture.receipt),
      /must not be a link/
    );
    assert.equal(fs.readFileSync(external, "utf8"), "{}");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("six-gate receipts cannot skip lifecycle-disabled packed consumer qualification", () => {
  const fixture = createFixture();
  try {
    fixture.receipt.artifactStatus = "verified";
    fixture.receipt.verifiedAt = new Date().toISOString();
    fixture.receipt.gates = requiredCandidateGates
      .filter((name) => name !== "packed-consumer-smoke-ignore-scripts")
      .map(successfulGate);
    assert.throws(() => assertArtifactVerified(fixture.receipt), /exact required/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
