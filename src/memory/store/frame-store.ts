/**
 * FrameStore — persistence contract for Frames.
 *
 * This module defines the minimal interface that any Frame persistence layer must implement.
 * Default implementation: SqliteFrameStore (OSS).
 * Other drivers (if any) live out-of-tree or in higher layers.
 */

import type { Frame } from "../frames/types.js";

/**
 * Search criteria for Frames.
 */
export interface FrameSearchCriteria {
  /**
   * Opaque search string. Semantics vary by driver but MUST include
   * at least free-text search over reference_point and summary_caption.
   * For SqliteFrameStore, this is FTS5 syntax.
   * Callers SHOULD NOT assume any specific query language.
   */
  query?: string;

  /**
   * If true, disable automatic fuzzy matching (prefix wildcards).
   * Default is false (fuzzy matching enabled).
   */
  exact?: boolean;

  /**
   * Search mode: 'all' (AND, default) or 'any' (OR).
   * - 'all': All terms must match (implicit AND in FTS5)
   * - 'any': Any term can match (explicit OR in FTS5)
   * Default is 'all'.
   */
  mode?: "all" | "any";

  /** Filter by module IDs (any match). */
  moduleScope?: string[];

  /** Filter by exact, literal branch name before applying the result limit. */
  branch?: string;

  /** Maximum results to return. */
  limit?: number;

  /**
   * Return Frames with timestamp >= since (UTC).
   * For "last N frames regardless of time," use limit/offset instead.
   */
  since?: Date;

  /**
   * Return Frames with timestamp <= until (UTC).
   */
  until?: Date;

  /**
   * Filter by user ID.
   * When set, only Frames belonging to this user are returned.
   * When omitted, Frames for all users are returned (backward-compatible).
   */
  userId?: string;
}

/**
 * Options for listing Frames.
 */
export interface FrameListOptions {
  /** Maximum number of Frames to return. */
  limit?: number;

  /** Number of Frames to skip (for pagination). */
  offset?: number;

  /** Opaque cursor for stable pagination (takes precedence over offset). */
  cursor?: string;

  /**
   * Filter by user ID.
   * When set, only Frames belonging to this user are returned.
   * When omitted, Frames for all users are returned (backward-compatible).
   */
  userId?: string;
}

/**
 * Pagination metadata for Frame listing.
 */
export interface FrameListPage {
  /** Maximum number of Frames returned per page. */
  limit: number;

  /** Opaque cursor to fetch the next page, or null if no more results. */
  nextCursor: string | null;

  /** Whether there are more results available. */
  hasMore: boolean;
}

/**
 * Ordering metadata for Frame listing.
 */
export interface FrameListOrder {
  /** Field used for ordering. */
  by: "timestamp";

  /** Sort direction. */
  direction: "desc";
}

/**
 * Result of listing Frames with pagination metadata.
 */
export interface FrameListResult {
  /** Array of Frames returned for this page. */
  frames: Frame[];

  /** Pagination metadata. */
  page: FrameListPage;

  /** Ordering metadata. */
  order: FrameListOrder;
}

/**
 * Result of saving a single Frame in a batch operation.
 */
export interface SaveResult {
  /** The Frame ID. */
  id: string;

  /** Whether the save was successful. */
  success: boolean;

  /** Error message if save failed. */
  error?: string;
}

/**
 * Store statistics for diagnostics.
 */
export interface StoreStats {
  /** Total number of Frames in the store. */
  totalFrames: number;

  /** Number of Frames created in the last 7 days. */
  thisWeek: number;

  /** Number of Frames created in the last 30 days. */
  thisMonth: number;

  /** Timestamp of the oldest Frame, or null if store is empty. */
  oldestDate: string | null;

  /** Timestamp of the newest Frame, or null if store is empty. */
  newestDate: string | null;

  /** Module distribution (top 20 by count), only when detailed=true. */
  moduleDistribution?: Record<string, number>;
}

/**
 * Turn cost metrics aggregated from Frame spend metadata.
 */
export interface TurnCostMetrics {
  /** Number of Frames in the period. */
  frameCount: number;

  /** Estimated total tokens across all Frames. */
  estimatedTokens: number;

  /** Total number of prompts across all Frames. */
  prompts: number;
}

/** Backend-neutral description used by CLI and MCP introspection. */
export interface FrameStoreMetadata {
  /** Storage driver selected for this store. */
  backend: "memory" | "sqlite" | "postgres";

  /** Human-readable, credential-free storage location. */
  location: string;

  /** Canonical credential-free location used to derive identity. */
  canonicalLocation: string;

  /** Stable, non-secret identity for comparing active stores across surfaces. */
  identity: string;

  /** Backend capabilities that callers must not infer from implementation classes. */
  capabilities: {
    encryption: boolean;
    images: boolean;
  };
}

/** Live backend health and schema information for diagnostics. */
export interface FrameStoreHealth {
  healthy: boolean;
  schemaVersion: string;
  checkedAt: string;
  serverVersion?: string;
  database?: string;
  message?: string;
}

/**
 * FrameStore — persistence contract for Frames.
 *
 * Default implementation: SqliteFrameStore (OSS).
 * Other drivers (if any) live out-of-tree or in higher layers.
 */
export interface FrameStore {
  /** Describe the active backend without exposing credentials. */
  getMetadata(): FrameStoreMetadata;

  /** Probe connectivity and report the active storage schema version. */
  getHealth(): Promise<FrameStoreHealth>;

  /**
   * Persist a Frame to storage.
   * @param frame - The Frame to save.
   */
  saveFrame(frame: Frame): Promise<void>;

  /**
   * Persist multiple Frames to storage with transactional semantics.
   * All-or-nothing: if any validation fails, no Frames are saved.
   * @param frames - Array of Frames to save.
   * @returns Array of results for each Frame (in same order as input).
   */
  saveFrames(frames: Frame[]): Promise<SaveResult[]>;

  /**
   * Retrieve a Frame by its unique identifier.
   * @param id - The Frame ID.
   * @returns The Frame if found, or null if not found.
   */
  getFrameById(id: string): Promise<Frame | null>;

  /**
   * Search for Frames matching the given criteria.
   * @param criteria - Search filters and options.
   * @returns Array of matching Frames.
   */
  searchFrames(criteria: FrameSearchCriteria): Promise<Frame[]>;

  /**
   * List Frames with optional pagination.
   * @param options - Pagination options.
   * @returns FrameListResult with frames and pagination metadata.
   */
  listFrames(options?: FrameListOptions): Promise<FrameListResult>;

  /**
   * Delete a Frame by its unique identifier.
   * @param id - The Frame ID to delete.
   * @returns true if a Frame was deleted, false if the ID was not found.
   */
  deleteFrame(id: string): Promise<boolean>;

  /**
   * Delete all Frames with timestamps before the given date.
   * Useful for TTL-based retention policies.
   * @param date - Delete Frames with timestamp < date (UTC).
   * @returns The number of Frames deleted.
   */
  deleteFramesBefore(date: Date): Promise<number>;

  /**
   * Delete all Frames matching a branch name.
   * @param branch - The branch to match.
   * @returns The number of Frames deleted.
   */
  deleteFramesByBranch(branch: string): Promise<number>;

  /**
   * Delete all Frames that include the given module in their module_scope.
   * @param moduleId - The module ID to match (any-match within the array).
   * @returns The number of Frames deleted.
   */
  deleteFramesByModule(moduleId: string): Promise<number>;

  /**
   * Get the total number of Frames in the store.
   * @returns The total Frame count.
   */
  getFrameCount(): Promise<number>;

  /**
   * Get database/store statistics for diagnostics.
   * @param detailed - If true, include module distribution breakdown.
   * @returns Store statistics including counts, date ranges, and optional module distribution.
   */
  getStats(detailed?: boolean): Promise<StoreStats>;

  /**
   * Get turn cost metrics for a time period.
   * Aggregates token usage and prompt counts from Frame spend metadata.
   * @param since - Optional ISO timestamp to filter from. If omitted, returns all-time metrics.
   * @returns Turn cost metrics including frame count, estimated tokens, and prompt count.
   */
  getTurnCostMetrics(since?: string): Promise<TurnCostMetrics>;

  /**
   * Update specific fields of an existing Frame.
   * Only the provided fields are updated; all other fields remain unchanged.
   * Unlike saveFrame() (which replaces the complete value), updateFrame() has
   * atomic targeted-merge semantics: concurrent partial updates must not erase
   * unrelated fields.
   *
   * @param id - The ID of the Frame to update.
   * @param updates - Partial Frame fields to update. 'id' and 'timestamp' cannot be changed.
   * @returns true if a Frame was found and updated, false if the ID was not found.
   */
  updateFrame(id: string, updates: Partial<Omit<Frame, "id" | "timestamp">>): Promise<boolean>;

  /**
   * Delete all Frames that have been marked as superseded (superseded_by IS NOT NULL).
   * Useful for bulk cleanup of dead frames after deduplication/consolidation.
   *
   * @returns The number of Frames deleted.
   */
  purgeSuperseded(): Promise<number>;

  /**
   * Close the store and release any resources.
   */
  close(): Promise<void>;
}
