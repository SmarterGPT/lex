export type ReadOnlyDatabaseErrorCode =
  "STORE_NOT_FOUND" | "STORE_REQUIRES_MIGRATION" | "STORE_INCOMPATIBLE" | "STORE_UNAVAILABLE";

/** Stable failure returned when a database cannot be opened safely for bootstrap reads. */
export class ReadOnlyDatabaseError extends Error {
  constructor(
    public readonly code: ReadOnlyDatabaseErrorCode,
    message: string,
    public readonly currentVersion?: number
  ) {
    super(message);
    this.name = "ReadOnlyDatabaseError";
  }
}
