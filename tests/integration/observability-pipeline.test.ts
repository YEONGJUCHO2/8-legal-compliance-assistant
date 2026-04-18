// @vitest-environment node

import { describe, expect, test } from "vitest";

import { POST } from "@/app/api/ask/route";
import { createInMemoryAuthStore } from "@/lib/auth/in-memory-store";
import { setSessionCookieHeader } from "@/lib/auth/session";
import { hashToken } from "@/lib/auth/tokens";
import { resetAssistantDepsForTesting, setAssistantDepsForTesting, type AssistantDeps } from "@/lib/assistant/deps";
import { createInMemoryIdempotencyStore } from "@/lib/assistant/idempotency";
import { createInMemoryHistoryStore } from "@/lib/assistant/history-store";
import { createLogger } from "@/lib/logging";
import { getMetricsRegistry } from "@/lib/metrics/assistant-metrics";
import { createInMemoryRateLimitStore } from "@/lib/rate-limit";
import { createInMemoryStorage } from "@/lib/search/in-memory-storage";
import { retrieve } from "@/lib/search/retrieve";

import { loadFixtureArticles } from "../unit/search/fixture-data";

const staticRouteContext = {
  params: Promise.resolve({})
};

async function createAuthedDeps(overrides?: Partial<AssistantDeps>) {
  const authStore = createInMemoryAuthStore();
  const user = await authStore.findOrCreateUserByEmail({
    email: "user@example.com",
    provider: "magic_link",
    providerSubject: "magic:user@example.com",
    now: "2026-04-18T00:00:00.000Z"
  });
  const sessionToken = "observability-session-token";
  const cookie = setSessionCookieHeader(sessionToken, "2026-04-25T00:00:00.000Z");

  await authStore.createSession({
    userId: user.id,
    tokenHash: hashToken(sessionToken),
    createdAt: "2026-04-18T00:00:00.000Z",
    expiresAt: "2026-04-25T00:00:00.000Z"
  });

  const logger = createLogger({ service: "test-observability" });
  const deps: AssistantDeps = {
    authStore,
    storage: createInMemoryStorage(loadFixtureArticles()),
    retrieveFn: retrieve,
    engine: {
      provider: "anthropic",
      async generate() {
        return {
          sessionId: "session-obsv",
          schemaRetries: 0,
          response: {
            verified_facts: ["프레스 작업 전 방호장치를 점검해야 합니다."],
            conclusion: "점검 후 작업해야 합니다.",
            explanation: "관련 조문이 안전조치를 요구합니다.",
            caution: "설비별 점검표를 확인하세요."
          }
        };
      }
    },
    mcp: {
      async lookupLaw(title) {
        return { lawId: `law:${title}`, title };
      },
      async lookupArticle({ lawId, articleNo }) {
        return {
          lawId,
          articleNo,
          paragraph: null,
          item: null,
          body: `${articleNo} 본문`,
          snapshotHash: `snap:${articleNo}`,
          latestArticleVersionId: null,
          changeSummary: null
        };
      },
      async queryEffectiveDate() {
        return {
          effectiveFrom: "2024-01-01",
          effectiveTo: null,
          repealedAt: null
        };
      }
    },
    historyStore: createInMemoryHistoryStore(),
    idempotencyStore: createInMemoryIdempotencyStore(),
    rateLimitStore: createInMemoryRateLimitStore(),
    logger,
    now: () => new Date("2026-04-18T00:00:00.000Z"),
    today: () => "2026-04-18",
    ...overrides
  };

  setAssistantDepsForTesting(deps);
  getMetricsRegistry().reset();

  return {
    user,
    deps,
    cookieHeader: `${cookie.name}=${cookie.value}`,
    logger
  };
}

describe("observability pipeline", () => {
  test("propagates request id, logs run events, and records metrics", async () => {
    const { cookieHeader, logger } = await createAuthedDeps();

    const response = await POST(
      new Request("https://example.test/api/ask", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookieHeader
        },
        body: JSON.stringify({
          mode: "ask",
          clientRequestId: "req-obsv-1",
          question: "산안법 제10조 안전조치",
          referenceDate: "2026-04-18"
        })
      }),
      staticRouteContext
    );
    const body = await response.json();

    expect(response.headers.get("x-request-id")).toMatch(/^reqid_/);
    expect(body.kind).toBe("answer");

    const entries = logger.drain();
    expect(entries.some((entry) => entry.requestId)).toBe(true);
    expect(entries.some((entry) => entry.eventType === "assistant_run")).toBe(true);

    const metrics = getMetricsRegistry().snapshot();
    expect(metrics.histograms.engine_latency_ms).toBeTruthy();
  });

  test("returns structured 429 when the token bucket is exhausted", async () => {
    const { cookieHeader } = await createAuthedDeps({
      rateLimitStore: createInMemoryRateLimitStore({
        capacity: 0,
        refillPerSec: 0
      })
    });

    const response = await POST(
      new Request("https://example.test/api/ask", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookieHeader
        },
        body: JSON.stringify({
          mode: "ask",
          clientRequestId: "req-obsv-2",
          question: "산안법 제10조 안전조치",
          referenceDate: "2026-04-18"
        })
      }),
      staticRouteContext
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.kind).toBe("rate_limited");
    expect(body.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});
