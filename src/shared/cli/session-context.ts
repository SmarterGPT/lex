/**
 * Narrow canonical context surface. Inject a host-authorized FrameStore view for
 * scoped reads; this builder does not grant scope authority or derive constraints.
 * The caller owns an injected store's lifetime. Missing default stores are never created.
 */
export { buildSessionContext, renderSessionContextText } from "./context.js";
export type {
  ContextOptions,
  SessionContext,
  ContextFrame,
  ContextWarning,
  ContextWarningCode,
  ContextStoreCandidate,
  ContextStoreAccessMode,
} from "./context.js";
