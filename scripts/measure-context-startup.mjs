#!/usr/bin/env node
// Diagnostic paired trial, not a CI latency threshold or production authorization path.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";

const [mode, baseline, candidate, workspace, trace] = process.argv.slice(2);
if (mode === "baseline" || mode === "candidate") {
  // Never inherit a live consumer database or selection configuration.
  for (const key of Object.keys(process.env)) if (key.startsWith("LEX_")) delete process.env[key];
  const root = mode === "baseline" ? baseline : candidate;
  const loaded = new Set();
  const hooks =
    trace === "trace"
      ? registerHooks({
          load(url, context, next) {
            loaded.add(url);
            return next(url, context);
          },
        })
      : undefined;
  const url = (path) => pathToFileURL(join(root, path)).href;
  const cpuStart = process.cpuUsage();
  const usageStart = process.resourceUsage();
  const start = performance.now();
  if (mode === "baseline") {
    await Promise.all([
      import(url("dist/shared/cli/index.js")),
      import(url("dist/memory/mcp_server/server.js")),
    ]);
  }
  const api = await import(
    url(mode === "baseline" ? "dist/shared/cli/context.js" : "dist/shared/cli/session-context.js")
  );
  const imported = performance.now();
  const options = { projectRoot: workspace, branch: "work", json: true, maxTokens: 1600 };
  const frame = (id, branch, timestamp) => ({
    id,
    branch,
    timestamp,
    module_scope: ["workspace/unscoped"],
    reference_point: id,
    summary_caption: `Saved ${id}`,
    status_snapshot: { next_action: "Continue" },
    provenance: { source: "fixture" },
  });
  const frames = [
    frame("new-other", "other", "2026-09-16T00:00:00Z"),
    frame("old-matching", "work", "2026-08-01T00:00:00Z"),
  ];
  const outputs = [];
  for (const scenario of ["frames", "empty", "denied", "wrong-target", "oversize"]) {
    const data =
      scenario === "empty"
        ? []
        : scenario === "oversize"
          ? frames.map((f) => ({ ...f, summary_caption: "x".repeat(10000) }))
          : frames;
    const store = {
      getMetadata: () => ({
        backend: "memory",
        location: "memory://fixture",
        canonicalLocation: "memory://fixture",
        identity: "memory:fixture",
        capabilities: { images: false, encryption: false },
      }),
      listFrames: async () => {
        if (["denied", "wrong-target"].includes(scenario)) throw new Error(`fixture ${scenario}`);
        return { frames: data };
      },
      close: () => {
        throw new Error("Injected store must remain caller-owned");
      },
    };
    const context = await api.buildSessionContext(options, store);
    delete context.generatedAt;
    outputs.push({ scenario, context });
  }
  const end = performance.now();
  const cpu = process.cpuUsage(cpuStart);
  const usage = process.resourceUsage();
  hooks?.deregister();
  const digest = createHash("sha256").update(JSON.stringify(outputs)).digest("hex");
  console.log(
    JSON.stringify({
      mode,
      trace: Boolean(hooks),
      importMs: imported - start,
      readsMs: end - imported,
      cpuMicros: cpu,
      maxRssKiB: usage.maxRSS,
      filesystemReadOperations:
        process.platform === "win32" ? null : usage.fsRead - usageStart.fsRead,
      filesystemWriteOperations:
        process.platform === "win32" ? null : usage.fsWrite - usageStart.fsWrite,
      ioLimit: "OS counters are not byte or physical-disk measurements; unavailable on Windows",
      digest,
      outputs,
      ...(hooks ? { loaded: [...loaded].sort() } : {}),
    })
  );
} else {
  if (mode !== "--compare" || !baseline || !candidate)
    throw new Error(
      "Usage: node scripts/measure-context-startup.mjs --compare BASELINE_ROOT CANDIDATE_ROOT"
    );
  const scratch = mkdtempSync(join(tmpdir(), "lex-context-pair-"));
  const runs = [];
  try {
    for (let pair = 0; pair < 5; pair++) {
      for (const treatment of pair % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
        const start = performance.now();
        const result = spawnSync(
          process.execPath,
          [
            fileURLToPath(import.meta.url),
            treatment,
            resolve(baseline),
            resolve(candidate),
            scratch,
          ],
          { encoding: "utf8", timeout: 30000 }
        );
        assert.equal(result.status, 0, result.stderr);
        runs.push({ pair, wallMs: performance.now() - start, ...JSON.parse(result.stdout) });
      }
    }
    // Freeze parity before reporting timing; diagnostics run separately from measured trials.
    for (const result of runs) assert.deepEqual(result.outputs, runs[0].outputs);
    const traces = [];
    for (const treatment of ["baseline", "candidate"]) {
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(import.meta.url),
          treatment,
          resolve(baseline),
          resolve(candidate),
          scratch,
          "trace",
        ],
        { encoding: "utf8", timeout: 30000 }
      );
      assert.equal(result.status, 0, result.stderr);
      traces.push(JSON.parse(result.stdout));
    }
    console.log(
      JSON.stringify(
        {
          schema: "lex-context-paired-trial-v1",
          node: process.version,
          platform: process.platform,
          baseline: resolve(baseline),
          candidate: resolve(candidate),
          parity: true,
          conditions:
            "Five alternating pairs, fresh processes, uncontrolled warm OS cache; fixture reads, no live DB, no integrity-verification savings claimed; trace instrumentation excluded from timings",
          runs,
          traces,
        },
        null,
        2
      )
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
