import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { resolveExpectedPackTarball } from "./pack-artifact-path.mjs";

export const candidateReceiptFilename = "release-candidate.json";
export const requiredCandidateGates = [
  "clean-release-outputs",
  "build",
  "npm-pack",
  "pack-guard",
  "packed-consumer-smoke",
  "packed-consumer-smoke-ignore-scripts",
  "npm-publish-dry-run",
];
const preparationGateNames = requiredCandidateGates.slice(0, 3);

function readRegularRootFile(repoRoot, filePath, label) {
  const canonicalRoot = fs.realpathSync(path.resolve(repoRoot));
  const resolvedPath = path.resolve(filePath);
  if (path.dirname(resolvedPath) !== path.resolve(repoRoot)) {
    throw new Error(`${label} must be a direct child of the repository root`);
  }
  const stat = fs.lstatSync(resolvedPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-link file`);
  }
  if (path.dirname(fs.realpathSync(resolvedPath)) !== canonicalRoot) {
    throw new Error(`${label} escapes the physical repository root`);
  }
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const descriptor = fs.openSync(resolvedPath, fs.constants.O_RDONLY | noFollow);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const physicalPath = fs.realpathSync(resolvedPath);
    const afterOpen = fs.statSync(physicalPath, { bigint: true });
    if (
      !opened.isFile() ||
      opened.dev !== afterOpen.dev ||
      opened.ino !== afterOpen.ino ||
      path.dirname(physicalPath) !== canonicalRoot
    ) {
      throw new Error(`${label} changed while it was being opened`);
    }
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function writeCandidateReceipt(repoRoot, receiptPath, receipt) {
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedReceipt = path.resolve(receiptPath);
  if (
    path.dirname(resolvedReceipt) !== resolvedRoot ||
    path.basename(resolvedReceipt) !== candidateReceiptFilename
  ) {
    throw new Error("Release candidate receipt path is not the exact repository-root receipt");
  }
  try {
    const stat = fs.lstatSync(resolvedReceipt);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("Release candidate receipt must not be a link");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const temporaryPath = path.join(
    resolvedRoot,
    `.${candidateReceiptFilename}.${process.pid}.${Date.now()}.tmp`
  );
  fs.writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    try {
      fs.renameSync(temporaryPath, resolvedReceipt);
    } catch (error) {
      if (error.code !== "EEXIST" && error.code !== "EPERM") throw error;
      fs.rmSync(resolvedReceipt, { force: true });
      fs.renameSync(temporaryPath, resolvedReceipt);
    }
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function calculateArtifactEvidenceFromBytes(bytes) {
  return {
    size: bytes.length,
    shasum: createHash("sha1").update(bytes).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function calculateArtifactEvidence(tarballPath) {
  return calculateArtifactEvidenceFromBytes(fs.readFileSync(tarballPath));
}

export function loadAndVerifyReleaseCandidate(repoRoot, receiptPath) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const receipt = JSON.parse(
    readRegularRootFile(repoRoot, receiptPath, "Release candidate receipt").toString("utf8")
  );
  if (receipt.schemaVersion !== "lex-release-candidate-v2") {
    throw new Error("Release candidate receipt has an unsupported schema version");
  }
  if (
    receipt.package?.name !== packageJson.name ||
    receipt.package?.version !== packageJson.version ||
    !/^[0-9a-f]{40}$/.test(receipt.source?.commit ?? "") ||
    !Array.isArray(receipt.gates)
  ) {
    throw new Error("Release candidate receipt package, source, or gate identity is invalid");
  }
  const oid = /^[0-9a-f]{40}$/;
  const fingerprint = /^[0-9A-F]{40}$/;
  const source = receipt.source;
  if (
    (source.validatedMain !== null &&
      (!oid.test(source.validatedMain ?? "") || source.validatedMain !== source.commit)) ||
    (source.releaseIdentity !== null &&
      (source.validatedMain === null ||
        source.releaseIdentity?.tag !== `v${receipt.package.version}` ||
        !oid.test(source.releaseIdentity?.tagObject ?? "") ||
        source.releaseIdentity?.targetCommit !== source.commit ||
        !fingerprint.test(source.releaseIdentity?.tagSigner ?? "") ||
        !fingerprint.test(source.releaseIdentity?.commitSigner ?? "")))
  ) {
    throw new Error("Release candidate main or signed-tag identity is invalid");
  }
  if (
    !["prepared", "verified", "failed"].includes(receipt.artifactStatus) ||
    receipt.acceptanceStatus !== "external-required" ||
    receipt.source.worktreeClean !== true ||
    typeof receipt.createdAt !== "string"
  ) {
    throw new Error("Release candidate receipt status or source state is invalid");
  }

  const tarballPath = resolveExpectedPackTarball(repoRoot, receipt.artifact, packageJson);
  const tarballBytes = readRegularRootFile(repoRoot, tarballPath, "Release candidate tarball");
  const actual = calculateArtifactEvidenceFromBytes(tarballBytes);
  for (const field of ["size", "shasum", "integrity", "sha256"]) {
    if (actual[field] !== receipt.artifact[field]) {
      throw new Error(`Release candidate ${field} does not match the retained tarball`);
    }
  }

  return { packageJson, receipt, tarballPath };
}

export function assertPreparedCandidate(receipt) {
  if (receipt.artifactStatus !== "prepared" || receipt.gates.length !== 3) {
    throw new Error("Artifact verification requires an exact prepared candidate");
  }
  for (let index = 0; index < preparationGateNames.length; index++) {
    const gate = receipt.gates[index];
    if (
      gate?.name !== preparationGateNames[index] ||
      gate.status !== "passed" ||
      gate.exitCode !== 0 ||
      gate.commit !== receipt.source.commit
    ) {
      throw new Error("Prepared candidate does not contain the exact successful preparation gates");
    }
  }
}

export function assertArtifactVerified(receipt) {
  if (
    receipt.artifactStatus !== "verified" ||
    receipt.acceptanceStatus !== "external-required" ||
    typeof receipt.verifiedAt !== "string"
  ) {
    throw new Error("Release candidate has not completed artifact verification");
  }
  const names = receipt.gates.map((gate) => gate.name);
  if (
    names.length !== requiredCandidateGates.length ||
    new Set(names).size !== names.length ||
    !requiredCandidateGates.every((name, index) => names[index] === name)
  ) {
    throw new Error("Release candidate does not contain the exact required artifact gates");
  }
  for (const gate of receipt.gates) {
    if (
      gate.status !== "passed" ||
      gate.exitCode !== 0 ||
      gate.commit !== receipt.source.commit ||
      !gate.invocation?.executable ||
      !Array.isArray(gate.invocation.argv) ||
      !gate.output?.stdout ||
      !gate.output?.stderr
    ) {
      throw new Error(`Release candidate gate ${gate.name} is not a complete successful receipt`);
    }
  }
}

export function assertPublishedArtifact(receipt, published) {
  assertArtifactVerified(receipt);
  if (
    published?.version !== receipt.package.version ||
    published?.["dist.integrity"] !== receipt.artifact.integrity
  ) {
    throw new Error(
      "Published npm package identity or integrity does not match the verified release candidate"
    );
  }
}
