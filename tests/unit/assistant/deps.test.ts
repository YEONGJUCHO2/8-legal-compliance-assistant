import { afterEach, describe, expect, test, vi } from "vitest";

import { getAssistantDeps, resetAssistantDepsForTesting, RuntimeConfigurationError } from "@/lib/assistant/deps";
import { runQuery } from "@/lib/assistant/run-query";

describe("assistant deps", () => {
  afterEach(() => {
    resetAssistantDepsForTesting();
    vi.unstubAllEnvs();
  });

  test("boots seeded dev deps outside production and answers deterministically", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const deps = getAssistantDeps();
    const user = await deps.authStore.findOrCreateUserByEmail({
      email: "dev-seed@example.com",
      provider: "magic_link",
      providerSubject: "magic:dev-seed@example.com",
      now: "2026-04-18T00:00:00.000Z"
    });

    const response = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "dev-seed-req",
        question: "산업안전보건법 교육 의무는?",
        referenceDate: "2026-04-18"
      },
      user,
      deps,
      now: "2026-04-18T00:00:00.000Z"
    });

    expect(response.kind).toBe("answer");
    if (response.kind === "answer") {
      expect(response.strength).toBe("conditional");
      expect(response.citations.length).toBeGreaterThan(0);
      expect(response.conclusion).toContain("개발");
    }
  });

  test("fails closed in production when only stub deps are available", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() => getAssistantDeps()).toThrowError(RuntimeConfigurationError);
  });
});
