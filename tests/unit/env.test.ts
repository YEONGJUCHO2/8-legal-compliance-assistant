import { describe, expect, test } from "vitest";

import { parseEnv } from "@/lib/env";

const validEnv = {
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/legal",
  LAW_API_KEY: "law-api-key",
  KOREAN_LAW_MCP_URL: "https://example.com/mcp",
  ENGINE_PROVIDER: "anthropic",
  ANTHROPIC_API_KEY: "anthropic-key",
  CODEX_DAEMON_URL: "http://127.0.0.1:7777",
  APP_BASE_URL: "http://127.0.0.1:3000",
  AUTH_SECRET: "a".repeat(32),
  AUTH_MAGIC_LINK_TTL_MINUTES: "15",
  AUTH_FROM_EMAIL: "legal-compliance@example.com",
  METRICS_ACCESS_TOKEN: "metrics-token",
  SMTP_URL: "smtp://localhost:1025",
  RETRIEVAL_DEADLINE_MS: "500",
  ENGINE_DEADLINE_MS: "1000",
  MCP_VERIFY_DEADLINE_MS: "1200",
  ROUTE_MAX_DURATION_SECONDS: "5",
  DEADLINE_SAFETY_MARGIN_MS: "500"
};

describe("parseEnv", () => {
  test("throws when required values are missing", () => {
    expect(() => parseEnv({ ...validEnv, DATABASE_URL: undefined })).toThrow();
  });

  test("throws when the reconciled deadline exceeds the route budget", () => {
    expect(() =>
      parseEnv({
        ...validEnv,
        RETRIEVAL_DEADLINE_MS: "2000",
        ENGINE_DEADLINE_MS: "2000",
        MCP_VERIFY_DEADLINE_MS: "2000",
        DEADLINE_SAFETY_MARGIN_MS: "500",
        ROUTE_MAX_DURATION_SECONDS: "5"
      })
    ).toThrow(/deadline/i);
  });

  test("defaults the magic-link TTL when omitted and allows optional mailer env vars", () => {
    const env = parseEnv({
      ...validEnv,
      AUTH_MAGIC_LINK_TTL_MINUTES: undefined,
      AUTH_FROM_EMAIL: undefined,
      METRICS_ACCESS_TOKEN: undefined,
      SMTP_URL: undefined
    });

    expect(env.AUTH_MAGIC_LINK_TTL_MINUTES).toBe(15);
    expect(env.AUTH_FROM_EMAIL).toBeUndefined();
    expect(env.METRICS_ACCESS_TOKEN).toBeUndefined();
    expect(env.SMTP_URL).toBeUndefined();
  });
});
