export type FrameStoreBackend = "sqlite" | "postgres";

export interface FrameStoreFactoryOptions {
  /** Defaults to read-write; read-only prevents initialization and mutation. */
  accessMode?: "read-only" | "read-write";
  /** Transitional PostgreSQL schema target. Ignored by the SQLite backend. */
  schema?: string;
}

/** Resolve and validate the configured FrameStore backend. */
export function resolveFrameStoreBackend(value = process.env.LEX_STORE): FrameStoreBackend {
  const backend = value?.trim().toLowerCase() || "sqlite";
  if (backend !== "sqlite" && backend !== "postgres") {
    throw new Error(`Unsupported LEX_STORE value: ${value}. Expected sqlite or postgres.`);
  }
  return backend;
}
