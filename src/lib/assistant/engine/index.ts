import type { AppEnv } from "@/lib/env";

import { createAnthropicAdapter } from "./anthropic";
import { createCodexAdapter } from "./codex";

export function createEngineAdapter(env: AppEnv) {
  if (env.ENGINE_PROVIDER === "anthropic") {
    return createAnthropicAdapter({
      apiKey: env.ANTHROPIC_API_KEY,
      deadlineMs: env.ENGINE_DEADLINE_MS
    });
  }

  return createCodexAdapter({
    daemonUrl: env.CODEX_DAEMON_URL,
    deadlineMs: env.ENGINE_DEADLINE_MS,
    authToken: env.CODEX_DAEMON_AUTH_TOKEN
  });
}

export * from "./anthropic";
export * from "./codex";
export * from "./generate";
export * from "./prompt";
export * from "./session-store";
export * from "./types";
