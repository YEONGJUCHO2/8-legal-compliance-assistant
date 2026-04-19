import { afterEach, describe, expect, test, vi } from "vitest";

const productionEnv = {
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/legal",
  LAW_API_KEY: "law-api-key",
  KOREAN_LAW_MCP_URL: "https://example.com/mcp",
  ENGINE_PROVIDER: "codex",
  ANTHROPIC_API_KEY: "anthropic-key",
  CODEX_DAEMON_URL: "http://127.0.0.1:7777",
  APP_BASE_URL: "http://127.0.0.1:3000",
  AUTH_SECRET: "a".repeat(32),
  AUTH_MAGIC_LINK_TTL_MINUTES: "15",
  AUTH_FROM_EMAIL: "legal@example.com",
  SMTP_URL: "smtp://mail.example.com:25",
  QUERY_REWRITE_DEADLINE_MS: "1000",
  RETRIEVAL_CANDIDATE_CAP: "5",
  RETRIEVAL_DEADLINE_MS: "500",
  ENGINE_DEADLINE_MS: "1000",
  MCP_VERIFY_DEADLINE_MS: "1200",
  ROUTE_MAX_DURATION_SECONDS: "5",
  DEADLINE_SAFETY_MARGIN_MS: "500"
};

describe("assistant deps production wiring", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  test("boots concrete stores in production when DATABASE_URL is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");

    for (const [key, value] of Object.entries(productionEnv)) {
      vi.stubEnv(key, value);
    }

    const { getAssistantDeps, resetAssistantDepsForTesting } = await import("@/lib/assistant/deps");

    resetAssistantDepsForTesting();
    const deps = getAssistantDeps();

    expect("db" in deps.authStore).toBe(true);
    expect("db" in (deps.serviceUpdateStore ?? {})).toBe(true);
    expect(typeof deps.mailer?.send).toBe("function");
    expect(deps.engine.provider).toBe("codex");
    expect(typeof deps.storage.findArticlesByLexical).toBe("function");
  });

  test("fails closed in production when SMTP_URL is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");

    for (const [key, value] of Object.entries({
      ...productionEnv,
      SMTP_URL: undefined
    })) {
      vi.stubEnv(key, value);
    }

    const { getAssistantDeps, resetAssistantDepsForTesting, RuntimeConfigurationError } = await import("@/lib/assistant/deps");

    resetAssistantDepsForTesting();

    expect(() => getAssistantDeps()).toThrowError(RuntimeConfigurationError);
    expect(() => getAssistantDeps()).toThrowError(/smtp_runtime_not_configured/);
  });
});
