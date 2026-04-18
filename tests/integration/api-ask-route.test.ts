// @vitest-environment node

import { afterEach, describe, expect, test } from "vitest";

import { createInMemoryAuthStore } from "@/lib/auth/in-memory-store";
import { setSessionCookieHeader } from "@/lib/auth/session";
import { hashToken } from "@/lib/auth/tokens";
import { resetAssistantDepsForTesting, setAssistantDepsForTesting } from "@/lib/assistant/deps";
import { createInMemoryIdempotencyStore } from "@/lib/assistant/idempotency";
import { createInMemoryHistoryStore } from "@/lib/assistant/history-store";
import { createInMemoryStorage } from "@/lib/search/in-memory-storage";
import { retrieve } from "@/lib/search/retrieve";
import type { AssistantDeps } from "@/lib/assistant/deps";

import { POST } from "@/app/api/ask/route";
import { loadFixtureArticles } from "../unit/search/fixture-data";

const staticRouteContext = {
  params: Promise.resolve({})
};

afterEach(() => {
  resetAssistantDepsForTesting();
});

describe("/api/ask route", () => {
  test("returns 401 auth_expired when no auth cookie is present", async () => {
    const request = new Request("https://example.test/api/ask", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        mode: "ask",
        clientRequestId: "req-route-1",
        question: "산안법 제10조 안전조치",
        referenceDate: "2026-04-18"
      })
    });

    const response = await POST(request, staticRouteContext);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      kind: "auth_expired",
      recoveryUrl: "/login"
    });
  });

  test("accepts a valid auth cookie and returns an answer envelope", async () => {
    const authStore = createInMemoryAuthStore();
    const user = await authStore.findOrCreateUserByEmail({
      email: "user@example.com",
      provider: "magic_link",
      providerSubject: "magic:user@example.com",
      now: "2026-04-18T00:00:00.000Z"
    });
    const sessionToken = "route-session-token";
    const cookie = setSessionCookieHeader(sessionToken, "2026-04-25T00:00:00.000Z");

    await authStore.createSession({
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      createdAt: "2026-04-18T00:00:00.000Z",
      expiresAt: "2026-04-25T00:00:00.000Z"
    });

    const deps: AssistantDeps = {
      authStore,
      storage: createInMemoryStorage(loadFixtureArticles()),
      retrieveFn: retrieve,
      engine: {
        provider: "anthropic",
        async generate() {
          return {
            sessionId: "engine-session-route",
            schemaRetries: 0,
            response: {
              verified_facts: ["프레스 작업 전 방호장치를 점검해야 한다."],
              conclusion: "프레스 작업 전 점검이 필요합니다.",
              explanation: "관련 조문이 안전조치를 요구합니다.",
              caution: "추가 사업장 기준을 확인하세요."
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
      now: () => new Date("2026-04-18T00:00:00.000Z"),
      today: () => "2026-04-18"
    };
    setAssistantDepsForTesting(deps);

    const request = new Request("https://example.test/api/ask", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${cookie.name}=${cookie.value}`
      },
      body: JSON.stringify({
        mode: "ask",
        clientRequestId: "req-route-2",
        question: "산안법 제10조 안전조치",
        referenceDate: "2026-04-18"
      })
    });

    const response = await POST(request, staticRouteContext);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.kind).toBe("answer");
  });

  test("rejects future reference dates against the injected server clock", async () => {
    const authStore = createInMemoryAuthStore();
    const user = await authStore.findOrCreateUserByEmail({
      email: "user@example.com",
      provider: "magic_link",
      providerSubject: "magic:user@example.com",
      now: "2026-04-18T00:00:00.000Z"
    });
    const sessionToken = "route-session-token-future";
    const cookie = setSessionCookieHeader(sessionToken, "2026-04-25T00:00:00.000Z");

    await authStore.createSession({
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      createdAt: "2026-04-18T00:00:00.000Z",
      expiresAt: "2026-04-25T00:00:00.000Z"
    });

    const deps: AssistantDeps = {
      authStore,
      storage: createInMemoryStorage(loadFixtureArticles()),
      retrieveFn: retrieve,
      engine: {
        provider: "anthropic",
        async generate() {
          return {
            sessionId: "engine-session-route-future",
            schemaRetries: 0,
            response: {
              verified_facts: ["stub"],
              conclusion: "stub",
              explanation: "stub",
              caution: "stub"
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
      now: () => new Date("2026-04-18T00:00:00.000Z"),
      today: () => "2026-04-18"
    };
    setAssistantDepsForTesting(deps);

    const request = new Request("https://example.test/api/ask", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${cookie.name}=${cookie.value}`
      },
      body: JSON.stringify({
        mode: "ask",
        clientRequestId: "req-route-3",
        question: "산안법 제10조 안전조치",
        referenceDate: "2026-04-19"
      })
    });

    const response = await POST(request, staticRouteContext);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      kind: "error",
      message: "future_reference_date_not_supported"
    });
  });
});
