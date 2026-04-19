import { describe, expect, test } from "vitest";

import { createEngineAdapter } from "@/lib/assistant/engine";
import type { AppEnv } from "@/lib/env";

const baseEnv: AppEnv = {
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/legal",
  LAW_API_KEY: "law-api-key",
  KOREAN_LAW_MCP_URL: "https://example.com/mcp",
  ENGINE_PROVIDER: "anthropic",
  ANTHROPIC_API_KEY: "anthropic-key",
  CODEX_DAEMON_URL: "http://127.0.0.1:7777",
  APP_BASE_URL: "http://127.0.0.1:3000",
  AUTH_SECRET: "a".repeat(32),
  AUTH_MAGIC_LINK_TTL_MINUTES: 15,
  QUERY_REWRITE_DEADLINE_MS: 10_000,
  RETRIEVAL_CANDIDATE_CAP: 5,
  RETRIEVAL_DEADLINE_MS: 500,
  ENGINE_DEADLINE_MS: 1000,
  MCP_VERIFY_DEADLINE_MS: 1200,
  ROUTE_MAX_DURATION_SECONDS: 5,
  DEADLINE_SAFETY_MARGIN_MS: 500
};

describe("createEngineAdapter", () => {
  test("returns the Anthropic adapter when env selects anthropic", () => {
    const adapter = createEngineAdapter(baseEnv);

    expect(adapter.provider).toBe("anthropic");
  });

  test("returns the Codex adapter when env selects codex", () => {
    const adapter = createEngineAdapter({
      ...baseEnv,
      ENGINE_PROVIDER: "codex"
    });

    expect(adapter.provider).toBe("codex");
  });
});
