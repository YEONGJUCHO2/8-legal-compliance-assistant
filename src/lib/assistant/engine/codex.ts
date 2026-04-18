import { bindHandle, createDbEngineSessionStore, type EngineSessionStore } from "./session-store";
import type { EngineAdapter } from "./types";

const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24;

export interface CreateCodexAdapterOptions {
  daemonUrl?: string;
  fetchImpl?: typeof fetch;
  sessionStore?: EngineSessionStore;
  now?: () => Date;
  sessionTtlMs?: number;
}

export function createCodexAdapter(options: CreateCodexAdapterOptions = {}): EngineAdapter {
  let sessionStore = options.sessionStore;
  const getSessionStore = () => {
    if (!sessionStore) {
      sessionStore = createDbEngineSessionStore();
    }

    return sessionStore;
  };

  return {
    provider: "codex",
    async generate(input) {
      const now = options.now?.() ?? new Date();
      const expiresAt = new Date(now.getTime() + (options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS)).toISOString();
      const session = await bindHandle(
        {
          userId: input.userId,
          provider: "codex",
          sessionId: input.sessionId,
          expiresAt,
          now
        },
        getSessionStore()
      );

      if (!options.daemonUrl) {
        const error = new Error("ECONNREFUSED") as Error & { code?: string };
        error.name = "CodexDaemonUnavailableError";
        error.code = "ECONNREFUSED";
        throw error;
      }

      return {
        sessionId: session.id,
        response: {
          type: "schema_error",
          message: "Codex stub is not wired for structured generation in Phase 05.",
          schema_retry_count: 2
        },
        schemaRetries: 2
      };
    }
  };
}
