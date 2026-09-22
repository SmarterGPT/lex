/**
 * MemoryFrameStore — In-memory FrameStore implementation for tests.
 *
 * Provides a fast, deterministic test double that doesn't require SQLite setup.
 * Uses Map<string, Frame> for storage with simple in-memory filtering.
 */

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
import type { Frame } from "../../frames/types.js";
import { Frame as FrameSchema } from "../../frames/types.js";
import { normalizeSearchTerms } from "../search-utils.js";

/**
 * Cursor for stable pagination.
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
 * In-memory implementation of FrameStore for unit tests.
 *
 * Features:
 * - No SQLite dependency
 * - Simple substring matching for search
 * - Pre-population via constructor
 * - Synchronous operations wrapped in Promise for interface compliance
 */
export class MemoryFrameStore implements FrameStore {
  private frames = new Map<string, Frame>();

  /**
   * Create a new MemoryFrameStore.
   * @param initialFrames - Optional array of Frames to pre-populate the store.
   */
  constructor(initialFrames?: Frame[]) {
    initialFrames?.forEach((f) => this.frames.set(f.id, f));
  }

  getMetadata(): FrameStoreMetadata {
    return {
      backend: "memory",
      location: "memory-store",
      canonicalLocation: "memory-store",
      identity: "memory-v1:ephemeral",
      capabilities: { encryption: false, images: false },
    };
  }

  async getHealth(): Promise<FrameStoreHealth> {
    return {
      healthy: true,
      schemaVersion: "memory-v1",
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Persist a Frame to storage (upsert).
   */
  async saveFrame(frame: Frame): Promise<void> {
    this.frames.set(frame.id, frame);
  }

  /**
   * Persist multiple Frames to storage with transactional semantics.
   * All-or-nothing: if any validation fails, no Frames are saved.
   */
  async saveFrames(frames: Frame[]): Promise<SaveResult[]> {
    // Validate all frames first (all-or-nothing on validation failure)
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

    // All validations passed - insert all frames
    const results: SaveResult[] = [];
    for (const frame of frames) {
      this.frames.set(frame.id, frame);
      results.push({ id: frame.id, success: true });
    }
    return results;
  }

  /**
   * Retrieve a Frame by its unique identifier.
   */
  async getFrameById(id: string): Promise<Frame | null> {
    return this.frames.get(id) ?? null;
  }

  /**
   * Search for Frames matching the given criteria.
   * Performs simple in-memory filtering:
   * - query: substring match on reference_point + summary_caption
   * - moduleScope: array intersection
   * - branch: exact, literal branch name
   * - since/until: timestamp comparison
   * - limit: maximum results
   */
  async searchFrames(criteria: FrameSearchCriteria): Promise<Frame[]> {
    let results = Array.from(this.frames.values());

    // Filter by query (substring match on reference_point + summary_caption)
    if (criteria.query) {
      const terms = normalizeSearchTerms(criteria);
      if (terms.length > 0) {
        results = results.filter((f) => {
          const searchText = [
            f.reference_point,
            f.summary_caption,
            ...(f.keywords ?? []),
            f.status_snapshot.next_action,
            ...f.module_scope,
            f.jira ?? "",
            f.branch,
          ].join(" ");
          const tokens = searchText.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
          const matches = (term: (typeof terms)[number]) =>
            tokens.some((token) =>
              term.prefix ? token.startsWith(term.value) : token === term.value
            );
          return criteria.mode === "any" ? terms.some(matches) : terms.every(matches);
        });
      }
    }

    // Filter by moduleScope (any match)
    if (criteria.moduleScope && criteria.moduleScope.length > 0) {
      const moduleScope = criteria.moduleScope;
      results = results.filter((f) => f.module_scope.some((m) => moduleScope.includes(m)));
    }

    if (criteria.branch !== undefined) {
      results = results.filter((f) => f.branch === criteria.branch);
    }

    // Filter by since (timestamp >= since)
    if (criteria.since) {
      const sinceTime = criteria.since.getTime();
      results = results.filter((f) => new Date(f.timestamp).getTime() >= sinceTime);
    }

    // Filter by until (timestamp <= until)
    if (criteria.until) {
      const untilTime = criteria.until.getTime();
      results = results.filter((f) => new Date(f.timestamp).getTime() <= untilTime);
    }

    // Filter by userId
    if (criteria.userId) {
      results = results.filter((f) => f.userId === criteria.userId);
    }

    // Stable result order: timestamp descending, then ID descending.
    results.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime() ||
        b.id.localeCompare(a.id)
    );

    // Apply limit
    if (criteria.limit !== undefined && criteria.limit > 0) {
      results = results.slice(0, criteria.limit);
    }

    return results;
  }

  /**
   * List Frames with optional pagination.
   * Supports both cursor-based and offset-based pagination.
   * Frames are returned in stable order: (timestamp DESC, id DESC).
   */
  async listFrames(options?: FrameListOptions): Promise<FrameListResult> {
    let results = Array.from(this.frames.values());

    // Sort by timestamp descending, then by ID descending for stable ordering
    results.sort((a, b) => {
      const timestampCompare = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      if (timestampCompare !== 0) {
        return timestampCompare;
      }
      // Tie-break on ID (descending)
      return b.id.localeCompare(a.id);
    });

    // Filter by userId (before pagination)
    if (options?.userId) {
      results = results.filter((f) => f.userId === options.userId);
    }

    // Handle cursor-based pagination (takes precedence over offset)
    if (options?.cursor) {
      const cursorData = decodeCursor(options.cursor);
      if (cursorData) {
        // Filter out frames that are >= cursor position
        results = results.filter((frame) => {
          const frameTime = new Date(frame.timestamp).getTime();
          const cursorTime = new Date(cursorData.timestamp).getTime();

          // If timestamps are different, compare them
          if (frameTime !== cursorTime) {
            return frameTime < cursorTime;
          }
          // If timestamps are the same, compare IDs
          return frame.id < cursorData.frame_id;
        });
      }
    } else if (options?.offset !== undefined && options.offset > 0) {
      // Apply offset only if no cursor
      results = results.slice(options.offset);
    }

    // Determine limit
    const limit = options?.limit ?? 10;

    // Fetch limit + 1 to check if there are more results
    const fetchLimit = limit + 1;
    const sliced = results.slice(0, fetchLimit);

    // Determine if there are more results
    const hasMore = sliced.length > limit;
    const frames = sliced.slice(0, limit);

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
   * @param id - The Frame ID to delete.
   * @returns true if a Frame was deleted, false if the ID was not found.
   */
  async deleteFrame(id: string): Promise<boolean> {
    return this.frames.delete(id);
  }

  /**
   * Update specific fields of an existing Frame.
   * Only the provided fields are updated; all other fields remain unchanged.
   *
   * @param id - The ID of the Frame to update.
   * @param updates - Partial Frame fields to update. 'id' and 'timestamp' cannot be changed.
   * @returns true if a Frame was found and updated, false if the ID was not found.
   */
  async updateFrame(
    id: string,
    updates: Partial<Omit<Frame, "id" | "timestamp">>
  ): Promise<boolean> {
    const existing = this.frames.get(id);
    if (!existing) {
      return false;
    }

    const updated = FrameSchema.parse({
      ...existing,
      ...updates,
      id: existing.id,
      timestamp: existing.timestamp,
    });
    this.frames.set(id, updated);
    return true;
  }

  /**
   * Delete all Frames that have been marked as superseded.
   * Removes frames where superseded_by is set.
   *
   * @returns The number of Frames deleted.
   */
  async purgeSuperseded(): Promise<number> {
    let deleted = 0;
    for (const [id, frame] of this.frames) {
      if (frame.superseded_by) {
        this.frames.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Delete all Frames with timestamps before the given date.
   * @param date - Delete Frames with timestamp < date (UTC).
   * @returns The number of Frames deleted.
   */
  async deleteFramesBefore(date: Date): Promise<number> {
    const cutoff = date.getTime();
    let deleted = 0;
    for (const [id, frame] of this.frames) {
      if (new Date(frame.timestamp).getTime() < cutoff) {
        this.frames.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Delete all Frames matching a branch name.
   * @param branch - The branch to match.
   * @returns The number of Frames deleted.
   */
  async deleteFramesByBranch(branch: string): Promise<number> {
    let deleted = 0;
    for (const [id, frame] of this.frames) {
      if (frame.branch === branch) {
        this.frames.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Delete all Frames that include the given module in their module_scope.
   * @param moduleId - The module ID to match.
   * @returns The number of Frames deleted.
   */
  async deleteFramesByModule(moduleId: string): Promise<number> {
    let deleted = 0;
    for (const [id, frame] of this.frames) {
      if (frame.module_scope.includes(moduleId)) {
        this.frames.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Get the total number of Frames in the store.
   * @returns The total Frame count.
   */
  async getFrameCount(): Promise<number> {
    return this.frames.size;
  }

  /**
   * Get store statistics for diagnostics.
   * Computes from in-memory frame data.
   */
  async getStats(detailed: boolean = false): Promise<StoreStats> {
    const allFrames = Array.from(this.frames.values());
    const totalFrames = allFrames.length;

    const now = new Date();
    const oneWeekAgo = new Date(now);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneMonthAgo = new Date(now);
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const thisWeek = allFrames.filter(
      (f) => new Date(f.timestamp).getTime() >= oneWeekAgo.getTime()
    ).length;
    const thisMonth = allFrames.filter(
      (f) => new Date(f.timestamp).getTime() >= oneMonthAgo.getTime()
    ).length;

    let oldestDate: string | null = null;
    let newestDate: string | null = null;

    if (totalFrames > 0) {
      const sorted = allFrames.map((f) => f.timestamp).sort();
      oldestDate = sorted[0];
      newestDate = sorted[sorted.length - 1];
    }

    const result: StoreStats = { totalFrames, thisWeek, thisMonth, oldestDate, newestDate };

    if (detailed && totalFrames > 0) {
      const moduleDistribution: Record<string, number> = {};
      for (const frame of allFrames) {
        for (const mod of frame.module_scope) {
          moduleDistribution[mod] = (moduleDistribution[mod] || 0) + 1;
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
   * Aggregates from in-memory frame spend metadata.
   */
  async getTurnCostMetrics(since?: string): Promise<TurnCostMetrics> {
    let frames = Array.from(this.frames.values());

    if (since) {
      const sinceTime = new Date(since).getTime();
      frames = frames.filter((f) => new Date(f.timestamp).getTime() >= sinceTime);
    }

    let estimatedTokens = 0;
    let prompts = 0;

    for (const frame of frames) {
      const spend = frame.spend as Record<string, number> | undefined;
      if (spend) {
        estimatedTokens += spend.tokens_estimated || 0;
        prompts += spend.prompts || 0;
      }
    }

    return {
      frameCount: frames.length,
      estimatedTokens,
      prompts,
    };
  }

  /**
   * Close the store and release resources.
   * No-op for memory store.
   */
  async close(): Promise<void> {
    // No-op for memory store
  }

  /**
   * Clear all frames from the store.
   * Test helper method.
   */
  clear(): void {
    this.frames.clear();
  }

  /**
   * Get the number of frames in the store.
   * Test helper method.
   */
  size(): number {
    return this.frames.size;
  }
}
