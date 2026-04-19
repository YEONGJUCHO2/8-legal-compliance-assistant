export const CURRENT_BEHAVIOR_VERSION = "bv-2026-04-19-librarian1";

// Bump the suffix manually whenever prompt/retrieval/verification behavior changes materially.
export function resolveBehaviorVersion() {
  return CURRENT_BEHAVIOR_VERSION;
}
