import { it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3-multiple-ciphers";
import { startHttpServer } from "../../../src/memory/mcp_server/http-server.js";
import { createOAuthRouter } from "../../../src/memory/mcp_server/routes/oauth.js";
import { initializeDatabase } from "../../../src/memory/store/db.js";

it("an import-only HTTP consumer exits without force-exit", async () => {
  const url = new URL("../../../src/memory/mcp_server/http-server.ts", import.meta.url).href;
  await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", `await import(${JSON.stringify(url)})`],
    {
      timeout: 10000,
      killSignal: "SIGKILL",
      windowsHide: true,
      maxBuffer: 65536,
    }
  );
});

it("returns a closeable listening server and rejects a failed bind", async () => {
  const db = new Database(":memory:");
  initializeDatabase(db);
  const server = await startHttpServer(db, { apiKey: "fixture-key", port: 0 });
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    assert.ok(address.port > 0);
    await request(server).get("/health").expect(200);
    await assert.rejects(startHttpServer(db, { apiKey: "fixture-key", port: address.port }), {
      code: "EADDRINUSE",
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    db.close();
  }
  assert.equal(server.listening, false);
});

function oauthApp(db: Database.Database) {
  const app = express();
  app.use(
    "/auth",
    createOAuthRouter(db, {
      github: {
        clientId: "fixture",
        clientSecret: "fixture",
        redirectUri: "http://localhost/callback",
      },
      jwtPrivateKey: "",
      jwtPublicKey: "",
    })
  );
  return app;
}

it("OAuth state is router-local and remains single-use", async () => {
  const db = new Database(":memory:");
  try {
    const first = oauthApp(db),
      second = oauthApp(db);
    const response = await request(first).get("/auth/github").expect(302);
    const state = new URL(response.headers.location).searchParams.get("state")!;
    assert.equal(
      (await request(second).get("/auth/callback").query({ state })).body.error,
      "INVALID_STATE"
    );
    // No code supplied: validates/consumes state without calling GitHub.
    assert.equal(
      (await request(first).get("/auth/callback").query({ state })).body.error,
      "INVALID_CODE"
    );
    assert.equal(
      (await request(first).get("/auth/callback").query({ state })).body.error,
      "INVALID_STATE"
    );
  } finally {
    db.close();
  }
});

it("expired OAuth state is rejected on the next request without a timer", async (context) => {
  const db = new Database(":memory:");
  const now = Date.now();
  try {
    const app = oauthApp(db);
    const response = await request(app).get("/auth/github").expect(302);
    const state = new URL(response.headers.location).searchParams.get("state")!;
    context.mock.method(Date, "now", () => now + 11 * 60 * 1000);
    assert.equal(
      (await request(app).get("/auth/callback").query({ state })).body.error,
      "INVALID_STATE"
    );
  } finally {
    context.mock.restoreAll();
    db.close();
  }
});
