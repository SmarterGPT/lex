#!/usr/bin/env node
/* eslint-disable no-console -- CLI verification evidence and failures */
/** One bounded read of the exact public version. The workflow owns its retry budget. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serverName = "dev.smartergpt/lex";
const wrapperName = "@smartergpt/lex-mcp";

export function assertRegistryPublicationEntry(entry, expectedVersion) {
  const official = entry?._meta?.["io.modelcontextprotocol.registry/official"];
  if (
    entry?.server?.name !== serverName ||
    entry.server.version !== expectedVersion ||
    entry.server.packages?.[0]?.registryType !== "npm" ||
    entry.server.packages[0].identifier !== wrapperName ||
    entry.server.packages[0].version !== expectedVersion ||
    entry.server.packages[0].transport?.type !== "stdio" ||
    official?.status !== "active" ||
    official.isLatest !== true
  ) {
    throw new Error(
      `Registry does not report ${serverName} v${expectedVersion} as active/latest with the exact wrapper contract.`
    );
  }
}

export async function verifyRegistryPublication({
  version,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
}) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? ""))
    throw new Error("An exact release semver is required.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    throw new Error("Registry timeout must be bounded to 1..30000 milliseconds.");
  const url = `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(serverName)}/versions/${encodeURIComponent(version)}`;
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(`Registry version lookup failed: ${response.status} ${response.statusText}`);
  const entry = await response.json();
  assertRegistryPublicationEntry(entry, version);
  return { url, version, entry };
}

async function main() {
  const index = process.argv.indexOf("--version");
  const version = index < 0 ? undefined : process.argv[index + 1];
  if (!version) {
    console.error("Usage: node scripts/verify-mcp-registry-publication.mjs --version <semver>");
    process.exitCode = 2;
    return;
  }
  try {
    await verifyRegistryPublication({ version });
    console.log(`MCP Registry exact version reports ${serverName} v${version} as active/latest.`);
  } catch (error) {
    console.error(
      `Registry publication verification failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
