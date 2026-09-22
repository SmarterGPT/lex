/**
 * SqliteFrameStore — SQLite implementation of FrameStore interface.
 *
 * Production-ready implementation that uses SQLite as the backing store.
 * Supports FTS5 for full-text search and proper connection management.
 */

import type Database from "better-sqlite3-multiple-ciphers";
import type {
  FrameStore,
  FrameSearchCriteria,
  FrameListOptions,
  FrameListResult,
  SaveResult,
  StoreStats,
  TurnCostMetrics,
  FrameStoreMetadata,
  FrameStoreHealth,
} from "../frame-store.js";
import type { Frame, FrameStatusSnapshot, FrameSpendMetadata } from "../../frames/types.js";
import type { FrameRow } from "../db.js";
import { Frame as FrameSchema } from "../../frames/types.js";
import { createDatabase, openDatabaseReadOnly } from "../db.js";
import { normalizeFTS5Query } from "../fts5-utils.js";
import {
  canonicalizeStorePath,
  createStoreIdentity,
} from "../../../shared/config/store-identity.js";

export type SqliteFrameStoreAccessMode = "read-only" | "read-write";

export interface SqliteFrameStoreOptions {
  /** Defaults to read-write to preserve existing explicit write/control-plane behavior. */
  accessMode?: SqliteFrameStoreAccessMode;
}

/**
 * Cursor for stable pagination.
 * Encodes the last seen (timestamp, frame_id) tuple.
 */
interface PaginationCursor {
  timestamp: string;
  frame_id: string;
}

/**
 * Encode a pagination cursor to an opaque base64 string.
 */
function encodeCursor(timestamp: string, frameId: string): string {
  const cursor: PaginationCursor = { timestamp, frame_id: frameId };
  return Buffer.from(JSON.stringify(cursor)).toString("base64");
}

/**
 * Decode a pagination cursor from a base64 string.
 * Returns null if the cursor is invalid.
 */
function decodeCursor(cursor: string): PaginationCursor | null {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded) as PaginationCursor;
    if (typeof parsed.timestamp === "string" && typeof parsed.frame_id === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Convert Frame object to database row
 *
 * Note: Frame v3 fields (executorRole, toolCalls, guardrailProfile) are not persisted
 * as the database schema does not yet have columns for them. This matches the behavior
 * of queries.ts. A future database migration will add support for these fields.
 */
function frameToRow(frame: Frame): FrameRow {
  return {
    id: frame.id,
    timestamp: frame.timestamp,
    branch: frame.branch,
    jira: frame.jira || null,
    module_scope: JSON.stringify(frame.module_scope),
    summary_caption: frame.summary_caption,
    reference_point: frame.reference_point,
    status_snapshot: JSON.stringify(frame.status_snapshot),
    keywords: frame.keywords ? JSON.stringify(frame.keywords) : null,
    atlas_frame_id: frame.atlas_frame_id || null,
    feature_flags: frame.feature_flags ? JSON.stringify(frame.feature_flags) : null,
    permissions: frame.permissions ? JSON.stringify(frame.permissions) : null,
    module_attribution: frame.module_attribution ? JSON.stringify(frame.module_attribution) : null,
    // Merge-weave metadata (v2)
    run_id: frame.runId || null,
    plan_hash: frame.planHash || null,
    spend: frame.spend ? JSON.stringify(frame.spend) : null,
    // OAuth2/JWT user isolation (v3)
    user_id: frame.userId || null,
    // Deduplication metadata (v5)
    superseded_by: frame.superseded_by || null,
    merged_from: frame.merged_from ? JSON.stringify(frame.merged_from) : null,
  };
}

/**
 * Convert database row to Frame object
 *
 * Note: Frame v3 fields (executorRole, toolCalls, guardrailProfile) are not retrieved
 * as the database schema does not yet have columns for them. This matches the behavior
 * of queries.ts. A future database migration will add support for these fields.
 */
function rowToFrame(row: FrameRow): Frame {
  return {
    id: row.id,
    timestamp: row.timestamp,
    branch: row.branch,
    jira: row.jira || undefined,
    module_scope: JSON.parse(row.module_scope) as string[],
    summary_caption: row.summary_caption,
    reference_point: row.reference_point,
    status_snapshot: JSON.parse(row.status_snapshot) as FrameStatusSnapshot,
    keywords: row.keywords ? (JSON.parse(row.keywords) as string[]) : undefined,
    atlas_frame_id: row.atlas_frame_id || undefined,
    feature_flags: row.feature_flags ? (JSON.parse(row.feature_flags) as string[]) : undefined,
    permissions: row.permissions ? (JSON.parse(row.permissions) as string[]) : undefined,
    module_attribution: row.module_attribution
      ? (JSON.parse(row.module_attribution) as Frame["module_attribution"])
      : undefined,
    // Merge-weave metadata (v2) - backward compatible, defaults to undefined
    runId: row.run_id || undefined,
    planHash: row.plan_hash || undefined,
    spend: row.spend ? (JSON.parse(row.spend) as FrameSpendMetadata) : undefined,
    // OAuth2/JWT user isolation (v3) - backward compatible, defaults to undefined
    userId: row.user_id || undefined,
    // Deduplication metadata (v5) - backward compatible, defaults to undefined
    superseded_by: row.superseded_by || undefined,
    merged_from: row.merged_from ? (JSON.parse(row.merged_from) as string[]) : undefined,
  };
}

/**
 * SqliteFrameStore — SQLite-backed implementation of FrameStore.
 *
 * Provides Frame persistence using SQLite with FTS5 for full-text search.
 * Handles connection lifecycle management with proper cleanup.
 */
export class SqliteFrameStore implements FrameStore {
  private _db: Database.Database;
  private _databasePath: string;
  private _accessMode: SqliteFrameStoreAccessMode;
  private ownsConnection: boolean;
  private isClosed: boolean = false;

  /**
   * Access the underlying database connection.
   * Useful for operations not covered by the FrameStore interface (e.g., ImageManager).
   *
   * @throws Error if the store has been closed.
   */
  get db(): Database.Database {
    if (this.isClosed) {
      throw new Error("SqliteFrameStore is closed");
    }
    return this._db;
  }

  /** Canonical source path, retained even when read-only access uses a detached snapshot. */
  get databasePath(): string {
    return this._databasePath;
  }

  /** Whether this store's SQLite connection can mutate the database. */
  get accessMode(): SqliteFrameStoreAccessMode {
    return this._accessMode;
  }

  /**
   * Create a new SqliteFrameStore.
   *
   * @param dbOrPath - Either an existing Database connection or a path to create/open a database.
   *                   A read-only store requires an explicit filesystem path. If a path is provided,
   *                   the store owns the connection and will close it on close(). If a Database is
   *                   provided, the caller is responsible for closing it.
   * @param options - Explicit connection access mode. The existing default remains read-write.
   */
  constructor(dbOrPath?: Database.Database | string, options: SqliteFrameStoreOptions = {}) {
    if (typeof dbOrPath === "string" || dbOrPath === undefined) {
      const accessMode = options.accessMode ?? "read-write";
      if (accessMode === "read-only" && dbOrPath === undefined) {
        throw new TypeError("A filesystem database path is required for read-only access");
      }

      this._db =
        accessMode === "read-only"
          ? openDatabaseReadOnly(dbOrPath as string)
          : createDatabase(dbOrPath);
      this._databasePath = dbOrPath ?? this._db.name;
      this._accessMode = accessMode;
      this.ownsConnection = true;
    } else {
      const connectionMode: SqliteFrameStoreAccessMode = dbOrPath.readonly
        ? "read-only"
        : "read-write";
      if (options.accessMode && options.accessMode !== connectionMode) {
        throw new TypeError(
          `The supplied SQLite connection is ${connectionMode}, not ${options.accessMode}`
        );
      }

      this._db = dbOrPath;
      this._databasePath = dbOrPath.name;
      this._accessMode = connectionMode;
      this.ownsConnection = false;
    }
  }

  getMetadata(): FrameStoreMetadata {
    const location = this.databasePath;
    const canonicalLocation = location === ":memory:" ? location : canonicalizeStorePath(location);
    return {
      backend: "sqlite",
      location,
      canonicalLocation,
      identity:
        canonicalLocation === ":memory:"
          ? "sqlite-v1:memory"
          : createStoreIdentity(canonicalLocation),
      capabilities: { encryption: true, images: true },
    };
  }

  async getHealth(): Promise<FrameStoreHealth> {
    const checkedAt = new Date().toISOString();
    if (this.isClosed) {
      return {
        healthy: false,
        schemaVersion: "unknown",
        checkedAt,
        message: "SqliteFrameStore is closed",
      };
    }
    try {
      const integrity = this._db.pragma("quick_check", { simple: true }) as string;
      const version = this._db
        .prepare("SELECT MAX(version) AS version FROM schema_version")
        .get() as { version: number | null };
      return {
        healthy: integrity === "ok",
        schemaVersion: String(version.version ?? 0),
        checkedAt,
        ...(integrity === "ok" ? {} : { message: `SQLite quick_check returned ${integrity}` }),
      };
    } catch {
      return {
        healthy: false,
        schemaVersion: "unknown",
        checkedAt,
        message: "SQLite health check failed",
      };
    }
  }

  /**
   * Persist a Frame to storage.
   * Uses INSERT OR REPLACE for upsert behavior.
   */
  async saveFrame(frame: Frame): Promise<void> {
    if (this.isClosed) {
      throw new Error("SqliteFrameStore is closed");
    }

    const row = frameToRow(frame);
    const stmt = this._db.prepare(`
      INSERT OR REPLACE INTO frames (
        id, timestamp, branch, jira, module_scope, summary_caption,
        reference_point, status_snapshot, keywords, atlas_frame_id,
        feature_flags, permissions, module_attribution, run_id, plan_hash, spend, user_id,
        superseded_by, merged_from
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      row.id,
      row.timestamp,
      row.branch,
      row.jira,
      row.module_scope,
      row.summary_caption,
      row.reference_point,
      row.status_snapshot,
      row.keywords,
      row.atlas_frame_id,
      row.feature_flags,
      row.permissions,
      row.module_attribution,
      row.run_id,
      row.plan_hash,
      row.spend,
      row.user_id,
      row.superseded_by,
      row.merged_from
    );
  }

  /**
   * Persist multiple Frames to storage with transactional semantics.
   * All-or-nothing: if any validation fails, no Frames are saved.
   * Uses a prepared statement within a transaction for optimal performance.
   */
  async saveFrames(frames: Frame[]): Promise<SaveResult[]> {
    if (this.isClosed) {
      throw new Error("SqliteFrameStore is closed");
    }

    // Validate all frames first (all-or-nothing on validation failure)
    const results: SaveResult[] = [];
    for (const frame of frames) {
      const parseResult = FrameSchema.safeParse(frame);
      if (!parseResult.success) {
        // Validation failed - return error results for all frames
        return frames.map((f, i) => ({
          id: f.id ?? `frame-${i}`,
          success: false,
          error:
            f === frame
              ? `Validation failed: ${parseResult.error.message}`
              : "Transaction aborted due to validation failure in another frame",
        }));
      }
    }

    // All validations passed - insert within a transaction
    const stmt = this._db.prepare(`
      INSERT OR REPLACE INTO frames (
        id, timestamp, branch, jira, module_scope, summary_caption,
        reference_point, status_snapshot, keywords, atlas_frame_id,
        feature_flags, permissions, module_attribution, run_id, plan_hash, spend, user_id,
        superseded_by, merged_from
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAll = this._db.transaction((framesToInsert: Frame[]) => {
      for (const frame of framesToInsert) {
        const row = frameToRow(frame);
        stmt.run(
          row.id,
          row.timestamp,
          row.branch,
          row.jira,
          row.module_scope,
          row.summary_caption,
          row.reference_point,
          row.status_snapshot,
          row.keywords,
          row.atlas_frame_id,
          row.feature_flags,
          row.permissions,
          row.module_attribution,
          row.run_id,
          row.plan_hash,
          row.spend,
          row.user_id,
          row.superseded_by,
          row.merged_from
        );
      }
    });

    try {
      insertAll(frames);
      // All frames inserted successfully
      for (const frame of frames) {
        results.push({ id: frame.id, success: true });
      }
    } catch (error) {
      // Transaction failed - return error results for all frames
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return frames.map((f) => ({
        id: f.id,
        success: false,
        error: `Transaction failed: ${errorMessage}`,
      }));
    }

    return results;
  }

  /**
   * Retrieve a Frame by its unique identifier.
   */
  async getFrameById(id: string): Promise<Frame | null> {
    if (this.isClosed) {
      throw new Error("SqliteFrameStore is closed");
    }

    const stmt = this._db.prepare("SELECT * FROM frames WHERE id = ?");
    const row = stmt.get(id) as FrameRow | undefined;

    if (!row) {
      return null;
    }

    return rowToFrame(row);
  }

  /**
   * Search for Frames matching the given criteria.
   *
   * Uses FTS5 for text search when query is provided.
   * Applies moduleScope, literal branch, user, and time filters before the limit.
   * Fuzzy matching is enabled by default (can be disabled with exact=true).
   */
  async searchFrames(criteria: FrameSearchCriteria): Promise<Frame[]> {
    if (this.isClosed) {
      throw new Error("SqliteFrameStore is closed");
    }

    // Build the query dynamically based on criteria
    const whereClauses: string[] = [];
    const params: (string | number)[] = [];
    let usesFTS = false;
    let baseQuery = "SELECT f.* FROM frames f";

    // Handle FTS5 query - normalize for compatibility with hyphenated terms
    // By default, adds prefix wildcards for fuzzy matching unless exact=true
    // Use mode='any' for OR logic, mode='all' (default) for AND logic
    if (criteria.query) {
      const normalizedQuery = normalizeFTS5Query(criteria.query, criteria.exact, criteria.mode);
      if (normalizedQuery) {
        try {
          baseQuery = `
            SELECT f.*
            FROM frames f
            JOIN frames_fts fts ON f.rowid = fts.rowid
            WHERE frames_fts MATCH ?
          `;
          params.push(normalizedQuery);
          usesFTS = true;
        } catch {
          // FTS5 syntax error, return empty results
          return [];
        }
      }
    }

    // Handle time range filters
    if (criteria.since) {
      whereClauses.push("f.timestamp >= ?");
      params.push(criteria.since.toISOString());
    }

    if (criteria.until) {
      whereClauses.push("f.timestamp <= ?");
      params.push(criteria.until.toISOString());
    }

    // Handle userId filter
    if (criteria.userId) {
      whereClauses.push("f.user_id = ?");
      params.push(criteria.userId);
    }

    if (criteria.branch !== undefined) {
      whereClauses.push("f.branch = ?");
      params.push(criteria.branch);
    }

    if (criteria.moduleScope?.length) {
      whereClauses.push(
        `EXISTS (SELECT 1 FROM json_each(f.module_scope) AS module
          WHERE module.value IN (${criteria.moduleScope.map(() => "?").join(", ")}))`
      );
      params.push(...criteria.moduleScope);
    }

    // Build final query
    let query = baseQuery;
    if (whereClauses.length > 0) {
      query += usesFTS ? " AND " : " WHERE ";
      query += whereClauses.join(" AND ");
    }
    query += " ORDER BY f.timestamp DESC, f.id DESC";

    if (criteria.limit !== undefined) {
      query += " LIMIT ?";
      params.push(criteria.limit);
    }

    try {
      const stmt = this._db.prepare(query);
      const rows = stmt.all(...params) as FrameRow[];

      return rows.map(rowToFrame);
    } catch (error: unknown) {
      // Check if this is an FTS5-related error (caused by special characters)
      const err = error as { code?: string; message?: string };
      if (
        err?.code === "SQLITE_ERROR" &&
        (err?.message?.includes("fts5: syntax error") ||
          err?.message?.includes("no such column") ||
          err?.message?.includes("unknown special query"))
      ) {
        // Return empty results for FTS5 syntax errors
        return [];
      }
      // Re-throw non-FTS5 errors
      throw error;
    }
  }

  /**
   * List Frames with optional pagination.
   *
   * Supports both cursor-based and offset-based pagination for backward compatibility.
   * Cursor-based pagination provides stable ordering by (timestamp DESC, id DESC).
   * When a cursor is provided, it takes precedence over offset.
   *
   * @param options - Pagination options (limit, cursor, or offset).
   * @returns FrameListResult with frames and pagination metadata.
   */
  async listFrames(options?: FrameListOptions): Promise<FrameListResult> {
    if (this.isClosed) {
      throw new Error("SqliteFrameStore is closed");
    }

    const limit = options?.limit ?? 10;
    const params: (string | number)[] = [];

    // Build query with stable ordering: timestamp DESC, id DESC
    let query = "SELECT * FROM frames";
    const whereClauses: string[] = [];

    // Handle cursor-based pagination (takes precedence over offset)
    if (options?.cursor) {
      const cursorData = decodeCursor(options.cursor);
      if (cursorData) {
        // Use row value comparison for stable pagination
        // (timestamp, id) < (cursor.timestamp, cursor.frame_id)
        whereClauses.push("(timestamp, id) < (?, ?)");
        params.push(cursorData.timestamp, cursorData.frame_id);
      }
      // If cursor is invalid, treat as if no cursor was provided
    }

    // Handle userId filter
    if (options?.userId) {
      whereClauses.push("user_id = ?");
      params.push(options.userId);
    }

    // Apply WHERE clauses
    if (whereClauses.length > 0) {
      query += " WHERE " + whereClauses.join(" AND ");
    }

    // Add stable ordering
    query += " ORDER BY timestamp DESC, id DESC";

    // Fetch limit + 1 to determine if there are more results
    query += " LIMIT ?";
    params.push(limit + 1);

    // Handle offset-based pagination (only if no cursor)
    if (!options?.cursor && options?.offset !== undefined) {
      query += " OFFSET ?";
      params.push(options.offset);
    }

    const stmt = this._db.prepare(query);
    const rows = stmt.all(...params) as FrameRow[];

    // Determine if there are more results
    const hasMore = rows.length > limit;
    const frames = rows.slice(0, limit).map(rowToFrame);

    // Generate next cursor from the last frame
    let nextCursor: string | null = null;
    if (hasMore && frames.length > 0) {
      const lastFrame = frames[frames.length - 1];
      nextCursor = encodeCursor(lastFrame.timestamp, lastFrame.id);
    }

    return {
      frames,
      page: {
        limit,
        nextCursor,
        hasMore,
      },
      order: {
        by: "timestamp",
        direction: "desc",
      },
    };
  }

  /**
   * Delete a Frame by its unique identifier.
   * Also removes associated FTS5 index entry.
   * @param id - The Frame ID to delete.
   * @returns true if a Frame was deleted, false if the ID was not found.
   */
  async deleteFrame(id: string): Promise<boolean> {
    if (this.isClosed) {
      throw new Error("SqliteFrameStore is closed");
    }

    const stmt = this._db.prepare("DELETE FROM frames WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Delete all Frames with timestamps before the given date.
   * FTS5 entries are removed automatically by SQLite triggers.
   * @param date - Delete Frames with timestamp < date (UTC).
   * @returns The number of Frames deleted.
   */
  async deleteFramesBefore(date: Date): Promise<number> {
    if (this.isClosed) {
      throw new Error("SqliteFrameStore is closed");
    }

    const stmt = this._db.prepare("DELETE FROM frames WHERE timestamp < ?");
    const result = stmt.run(date.toISOString());
    return result.changes;
  }

  /**
   * Delete all Frames matching a branch name.
   * FTS5 entries are removed automatically by SQLite triggers.
   * @param branch - The branch to match.
   * @returns The number of Frames deleted.
   */
  async deleteFramesByBranch(branch: string): Promise<number> {
    if (this.isClosed) {
      throw new Error("SqliteFrameStore is closed");
    }

    const stmt = this._db.prepare("DELETE FROM frames WHERE branch = ?");
    const result = stmt.run(branch);
    return result.changes;
  }

  /**
   * Delete all Frames that include the given module in their module_scope.
   * Uses json_each() to match within the JSON array column.
   * FTS5 entries are removed automatically by SQLite triggers.
   * @param moduleId - The module ID to match.
   * @returns The number of Frames deleted.
   */
  async deleteFramesByModule(moduleId: string): Promise<number> {
    if (this.isClosed) {
      throw new Error("SqliteFrameStore is closed");
    }

    const stmt = this._db.prepare(
      "DELETE FROM frames WHERE EXISTS (SELECT 1 FROM json_each(module_scope) WHERE value = ?)"
    );
    const result = stmt.run(moduleId);
    return result.changes;
  }

  /**
   * Get the total number of Frames in the store.
   * @returns The total Frame count.
   */
  async getFrameCount(): Promise<number> {
    if (this.isClosed) {
      throw new Error("SqliteFrameStore is closed");
    }

    const stmt = this._db.prepare("SELECT COUNT(*) as count FROM frames");
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Get database statistics for diagnostics.
   * Queries frame counts, date ranges, and optional module distribution.
   */
  async getStats(detailed: boolean = false): Promise<StoreStats> {
    if (this.isClosed) {
      throw new Error("SqliteFrameStore is closed");
    }

    const totalFrames = (
      this._db.prepare("SELECT COUNT(*) as count FROM frames").get() as { count: number }
    ).count;

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const thisWeek = (
      this._db
        .prepare("SELECT COUNT(*) as count FROM frames WHERE timestamp >= ?")
        .get(oneWeekAgo.toISOString()) as { count: number }
    ).count;

    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const thisMonth = (
      this._db
        .prepare("SELECT COUNT(*) as count FROM frames WHERE timestamp >= ?")
        .get(oneMonthAgo.toISOString()) as { count: number }
    ).count;

    let oldestDate: string | null = null;
    let newestDate: string | null = null;

    if (totalFrames > 0) {
      oldestDate = (
        this._db.prepare("SELECT MIN(timestamp) as oldest FROM frames").get() as {
          oldest: string | null;
        }
      ).oldest;
      newestDate = (
        this._db.prepare("SELECT MAX(timestamp) as newest FROM frames").get() as {
          newest: string | null;
        }
      ).newest;
    }

    const result: StoreStats = { totalFrames, thisWeek, thisMonth, oldestDate, newestDate };

    if (detailed && totalFrames > 0) {
      const moduleDistribution: Record<string, number> = {};
      const rows = this._db
        .prepare("SELECT module_scope FROM frames")
        .iterate() as IterableIterator<{ module_scope: string }>;
      for (const row of rows) {
        try {
          const modules = JSON.parse(row.module_scope) as string[];
          for (const mod of modules) {
            moduleDistribution[mod] = (moduleDistribution[mod] || 0) + 1;
          }
        } catch {
          // Skip frames with invalid JSON
        }
      }
      const sorted = Object.entries(moduleDistribution)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);
      result.moduleDistribution = Object.fromEntries(sorted);
    }

    return result;
  }

  /**
   * Get turn cost metrics for a time period.
   * Aggregates token usage and prompt counts from Frame spend metadata.
   */
  async getTurnCostMetrics(since?: string): Promise<TurnCostMetrics> {
    if (this.isClosed) {
      throw new Error("SqliteFrameStore is closed");
    }

    const whereClauses: string[] = [];
    const params: string[] = [];

    if (since) {
      whereClauses.push("timestamp >= ?");
      params.push(since);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const stmt = this._db.prepare(`
      SELECT
        COUNT(*) as frameCount,
        SUM(CASE WHEN spend IS NOT NULL THEN json_extract(spend, '$.tokens_estimated') ELSE 0 END) as estimatedTokens,
        SUM(CASE WHEN spend IS NOT NULL THEN json_extract(spend, '$.prompts') ELSE 0 END) as prompts
      FROM frames
      ${whereClause}
    `);

    const row = stmt.get(...params) as {
      frameCount: number;
      estimatedTokens: number | null;
      prompts: number | null;
    };

    return {
      frameCount: row.frameCount || 0,
      estimatedTokens: row.estimatedTokens || 0,
      prompts: row.prompts || 0,
    };
  }

  /**
   * Update specific fields of an existing Frame.
   * Only the provided fields are updated; all other fields remain unchanged.
   * Uses a targeted SQL UPDATE instead of INSERT OR REPLACE.
   *
   * @param id - The ID of the Frame to update.
   * @param updates - Partial Frame fields to update. 'id' and 'timestamp' cannot be changed.
   * @returns true if a Frame was found and updated, false if the ID was not found.
   */
  async updateFrame(
    id: string,
    updates: Partial<Omit<Frame, "id" | "timestamp">>
  ): Promise<boolean> {
    if (this.isClosed) {
      throw new Error("SqliteFrameStore is closed");
    }

    // Map Frame field names to database column names and serialize values
    const columnMap: Record<string, { column: string; serialize: (v: unknown) => unknown }> = {
      branch: { column: "branch", serialize: (v) => v },
      jira: { column: "jira", serialize: (v) => v ?? null },
      module_scope: { column: "module_scope", serialize: (v) => JSON.stringify(v) },
      summary_caption: { column: "summary_caption", serialize: (v) => v },
      reference_point: { column: "reference_point", serialize: (v) => v },
      status_snapshot: { column: "status_snapshot", serialize: (v) => JSON.stringify(v) },
      keywords: { column: "keywords", serialize: (v) => (v ? JSON.stringify(v) : null) },
      atlas_frame_id: { column: "atlas_frame_id", serialize: (v) => v ?? null },
      feature_flags: { column: "feature_flags", serialize: (v) => (v ? JSON.stringify(v) : null) },
      permissions: { column: "permissions", serialize: (v) => (v ? JSON.stringify(v) : null) },
      module_attribution: {
        column: "module_attribution",
        serialize: (v) => (v ? JSON.stringify(v) : null),
      },
      runId: { column: "run_id", serialize: (v) => v ?? null },
      planHash: { column: "plan_hash", serialize: (v) => v ?? null },
      spend: { column: "spend", serialize: (v) => (v ? JSON.stringify(v) : null) },
      userId: { column: "user_id", serialize: (v) => v ?? null },
      superseded_by: { column: "superseded_by", serialize: (v) => v ?? null },
      merged_from: { column: "merged_from", serialize: (v) => (v ? JSON.stringify(v) : null) },
    };

    const setClauses: string[] = [];
    const params: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      const mapping = columnMap[key];
      if (mapping) {
        setClauses.push(`${mapping.column} = ?`);
        params.push(mapping.serialize(value));
      }
    }

    if (setClauses.length === 0) {
      // No valid fields to update — check if frame exists
      const exists = this._db.prepare("SELECT 1 FROM frames WHERE id = ?").get(id);
      return exists !== undefined;
    }

    params.push(id);
    const sql = `UPDATE frames SET ${setClauses.join(", ")} WHERE id = ?`;
    const stmt = this._db.prepare(sql);
    const result = stmt.run(...params);
    return result.changes > 0;
  }

  /**
   * Delete all Frames that have been marked as superseded.
   * Removes frames where superseded_by IS NOT NULL.
   * FTS5 entries are removed automatically by SQLite triggers.
   *
   * @returns The number of Frames deleted.
   */
  async purgeSuperseded(): Promise<number> {
    if (this.isClosed) {
      throw new Error("SqliteFrameStore is closed");
    }

    const stmt = this._db.prepare("DELETE FROM frames WHERE superseded_by IS NOT NULL");
    const result = stmt.run();
    return result.changes;
  }

  /**
   * Close the store and release any resources.
   * Idempotent - safe to call multiple times.
   */
  async close(): Promise<void> {
    if (this.isClosed) {
      return; // Already closed, idempotent
    }

    this.isClosed = true;

    if (this.ownsConnection) {
      this._db.close();
    }
  }
}
