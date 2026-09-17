/**
 * HTTP Server for Frame Ingestion API
 *
 * Provides REST API endpoints for Frame ingestion from external tools
 *
 * SECURITY NOTICE:
 * - HTTP mode requires mandatory API key authentication
 * - For local development, prefer MCP stdio mode (safer, no network exposure)
 * - Production deployments MUST use reverse proxy with TLS (nginx, Caddy)
 * - See SECURITY.md for deployment best practices
 */

import express, { Express, Request, Response, NextFunction } from "express";
import type Database from "better-sqlite3-multiple-ciphers";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createHash } from "crypto";
import type { Server } from "node:http";
import { createFramesRouter } from "./routes/frames.js";
import { createOAuthRouter } from "./routes/oauth.js";
import { createAtlasRouter } from "./routes/atlas.js";
import { createAuthMiddleware } from "./auth/middleware.js";
import { initializeKeys } from "./auth/keys.js";
import { getLogger } from "@smartergpt/lex/logger";
import { AXErrorException } from "../../shared/errors/ax-error.js";

const logger = getLogger("memory:mcp_server:http-server");
const auditLogger = getLogger("memory:mcp_server:audit");

export interface HttpServerOptions {
  port?: number;
  apiKey?: string; // OPTIONAL: API key for legacy authentication (deprecated)
  rateLimitWindowMs?: number; // Rate limit window in milliseconds (default: 15min)
  rateLimitMaxRequests?: number; // Max requests per window (default: 100)
  // OAuth2/JWT configuration
  enableOAuth?: boolean; // Enable OAuth2 authentication
  github?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  jwtPublicKey?: string;
  jwtPrivateKey?: string;
}

/**
 * Create and configure the HTTP server with security hardening
 */
export function createHttpServer(db: Database.Database, options: HttpServerOptions): Express {
  const app = express();

  // Security headers (helmet middleware)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'none'"], // No scripts needed for API-only server
          styleSrc: ["'none'"],
          imgSrc: ["'none'"],
          connectSrc: ["'self'"],
          fontSrc: ["'none'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'none'"],
          frameSrc: ["'none'"],
        },
      },
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
    })
  );

  // Rate limiting for API endpoints
  const apiRateLimiter = rateLimit({
    windowMs: options.rateLimitWindowMs || 15 * 60 * 1000, // 15 minutes default
    max: options.rateLimitMaxRequests || 100, // 100 requests per window default
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "RATE_LIMIT_EXCEEDED",
      message: "Too many requests from this IP, please try again later",
      code: 429,
    },
  });

  // Stricter rate limit for authentication failures
  const authFailureLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Only 5 failed auth attempts per window
    skipSuccessfulRequests: true, // Only count failed auth
    message: {
      error: "AUTH_RATE_LIMIT_EXCEEDED",
      message: "Too many failed authentication attempts, please try again later",
      code: 429,
    },
  });

  // Apply rate limiting to API routes
  app.use("/api/", apiRateLimiter);

  // Request size limits and body parsing with timeout protection
  app.use(express.json({ limit: "1mb", strict: true }));

  // Audit logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    res.on("finish", () => {
      const duration = Date.now() - start;
      const apiKeyHash = req.headers.authorization
        ? createHash("sha256").update(req.headers.authorization).digest("hex").slice(0, 8)
        : null;

      auditLogger.info({
        event: "http_request",
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: duration,
        ip: req.ip,
        user_agent: req.get("user-agent"),
        api_key_hash: apiKeyHash, // Hash only, never log the actual key
      });
    });

    next();
  });

  // Health check endpoint (no auth required for monitoring)
  app.get("/health", (req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Initialize JWT keys if OAuth is enabled
  let jwtKeys;
  if (options.enableOAuth) {
    jwtKeys = initializeKeys();
    logger.info("JWT keys initialized for OAuth2 authentication");
  }

  // Mount OAuth2 routes if enabled
  if (options.enableOAuth && options.github) {
    const oauthRouter = createOAuthRouter(db, {
      github: options.github,
      jwtPrivateKey: options.jwtPrivateKey || jwtKeys?.privateKey || "",
      jwtPublicKey: options.jwtPublicKey || jwtKeys?.publicKey || "",
    });
    app.use("/auth", oauthRouter);
    logger.info("OAuth2 routes mounted at /auth");
  }

  // Create authentication middleware
  const authMiddleware = createAuthMiddleware({
    apiKey: options.apiKey,
    jwtPublicKey: options.jwtPublicKey || jwtKeys?.publicKey || "",
    requireAuth: true,
  });

  // Mount frames router with new auth middleware
  const framesRouter = createFramesRouter(db, options.apiKey || "", authFailureLimiter);

  // Apply authentication middleware to frames routes
  app.use("/api/frames", authMiddleware, framesRouter);

  // Mount atlas router with auth middleware
  const atlasRouter = createAtlasRouter(db);
  app.use("/api/atlas", authMiddleware, atlasRouter);

  return app;
}

/**
 * Start the HTTP server with authentication
 *
 * @throws Error if neither OAuth nor API key is configured
 */
export async function startHttpServer(
  db: Database.Database,
  options: HttpServerOptions
): Promise<Server> {
  // SECURITY: Require at least one authentication method
  if (!options.enableOAuth && (!options.apiKey || options.apiKey.trim() === "")) {
    throw new AXErrorException(
      "MCP_AUTH_REQUIRED",
      "HTTP server requires authentication. " +
        "Either enable OAuth2 (enableOAuth: true) or provide an API key. " +
        "For local development, use MCP stdio mode instead (safer, no network exposure). " +
        "See SECURITY.md for more information.",
      [
        "Set enableOAuth: true to enable OAuth2 authentication",
        "Or provide an API key via the apiKey option",
        "For local development, use MCP stdio mode (no HTTP server needed)",
        "See SECURITY.md for deployment best practices",
      ],
      { enableOAuth: options.enableOAuth, hasApiKey: Boolean(options.apiKey) }
    );
  }

  const port = options.port ?? 3000;
  const app = createHttpServer(db, options);

  return new Promise((resolve, reject) => {
    const server = app.listen(port, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      server.removeListener("error", reject);
      logger.info(`Frame ingestion API listening on port ${port}`);
      if (options.enableOAuth) {
        logger.info("OAuth2 authentication enabled");
      }
      if (options.apiKey) {
        logger.warn(
          "API key authentication is deprecated. Please migrate to OAuth2/JWT for production use."
        );
      }
      logger.warn(
        "HTTP server is running. Ensure you are behind a TLS-terminating reverse proxy for production use."
      );
      auditLogger.info({
        event: "http_server_started",
        port,
        oauth_enabled: !!options.enableOAuth,
        api_key_enabled: !!options.apiKey,
        timestamp: new Date().toISOString(),
      });
      resolve(server);
    });
    server.once("error", reject);
  });
}
