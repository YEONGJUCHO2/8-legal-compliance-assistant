// @vitest-environment node

import { afterEach, describe, expect, test } from "vitest";

import { GET as historyDetailGET } from "@/app/api/history/[runId]/route";
import { POST as rerunPOST } from "@/app/api/answer-with-current-law/route";
import { POST as exportPOST } from "@/app/api/export/route";
import { POST as feedbackPOST } from "@/app/api/feedback/route";
import { GET as historyGET } from "@/app/api/history/route";
import { resetAssistantDepsForTesting, setAssistantDepsForTesting, type AssistantDeps } from "@/lib/assistant/deps";
import { createInMemoryAuthStore } from "@/lib/auth/in-memory-store";
import { setSessionCookieHeader } from "@/lib/auth/session";
import { hashToken } from "@/lib/auth/tokens";
import { createInMemoryIdempotencyStore } from "@/lib/assistant/idempotency";
import { createInMemoryHistoryStore } from "@/lib/assistant/history-store";
import { runQuery } from "@/lib/assistant/run-query";
import { createInMemoryStorage } from "@/lib/search/in-memory-storage";
import { retrieve } from "@/lib/search/retrieve";

import { loadFixtureArticles } from "../unit/search/fixture-data";

const staticRouteContext = {
  params: Promise.resolve({})
};

afterEach(() => {
  resetAssistantDepsForTesting();
});

async function createAuthedDeps() {
  const authStore = createInMemoryAuthStore();
  const user = await authStore.findOrCreateUserByEmail({
    email: "user@example.com",
    provider: "magic_link",
    providerSubject: "magic:user@example.com",
    now: "2026-04-18T00:00:00.000Z"
  });
  const sessionToken = "route-secondary-session-token";
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
          sessionId: "engine-session-secondary",
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

  return {
    deps,
    user,
    cookieHeader: `${cookie.name}=${cookie.value}`
  };
}

async function seedRun(deps: AssistantDeps, user: { id: string }) {
  const response = await runQuery({
    request: {
      mode: "ask",
      clientRequestId: "seed-run",
      question: "산안법 제10조 안전조치",
      referenceDate: "2026-04-18",
      skipClarification: true
    },
    user,
    deps,
    now: "2026-04-18T00:00:00.000Z"
  });

  if (response.kind !== "answer" && response.kind !== "verification_pending") {
    throw new Error(`seed_failed:${response.kind}`);
  }

  return response.runId;
}

describe("secondary API routes", () => {
  test("returns 400 instead of crashing on invalid feedback, export, and rerun payloads", async () => {
    const { cookieHeader } = await createAuthedDeps();
    const cases = [
      {
        name: "feedback",
        handler: feedbackPOST,
        url: "https://example.test/api/feedback"
      },
      {
        name: "export",
        handler: exportPOST,
        url: "https://example.test/api/export"
      },
      {
        name: "rerun",
        handler: rerunPOST,
        url: "https://example.test/api/answer-with-current-law"
      }
    ] as const;

    for (const testCase of cases) {
      const response = await testCase.handler(
        new Request(testCase.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: cookieHeader
          },
          body: JSON.stringify({})
        }),
        staticRouteContext
      );
      const body = await response.json();

      expect(response.status, testCase.name).toBe(400);
      expect(body).toMatchObject({
        kind: "error",
        message: "invalid_request"
      });
    }
  });

  test("returns 400 on invalid JSON for feedback and export", async () => {
    const { cookieHeader } = await createAuthedDeps();
    const cases = [
      {
        name: "feedback",
        handler: feedbackPOST,
        url: "https://example.test/api/feedback"
      },
      {
        name: "export",
        handler: exportPOST,
        url: "https://example.test/api/export"
      }
    ] as const;

    for (const testCase of cases) {
      const response = await testCase.handler(
        new Request(testCase.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: cookieHeader
          },
          body: "{"
        }),
        staticRouteContext
      );
      const body = await response.json();

      expect(response.status, testCase.name).toBe(400);
      expect(body).toMatchObject({
        kind: "error",
        message: "invalid_json"
      });
    }
  });

  test("lists history and returns a per-run snapshot for the current user", async () => {
    const { deps, user, cookieHeader } = await createAuthedDeps();
    const runId = await seedRun(deps, user);

    const historyResponse = await historyGET(
      new Request("https://example.test/api/history", {
        method: "GET",
        headers: {
          cookie: cookieHeader
        }
      }),
      staticRouteContext
    );
    const historyBody = await historyResponse.json();

    expect(historyResponse.status).toBe(200);
    expect(historyBody.history).toHaveLength(1);
    expect(historyBody.history[0].id).toBe(runId);

    const detailResponse = await historyDetailGET(
      new Request(`https://example.test/api/history/${runId}`, {
        method: "GET",
        headers: {
          cookie: cookieHeader
        }
      }),
      {
        params: Promise.resolve({
          runId
        })
      }
    );
    const detailBody = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detailBody.snapshot.id).toBe(runId);
    expect(Array.isArray(detailBody.snapshot.citations)).toBe(true);
  });

  test("records feedback and exposes export stubs for an existing run", async () => {
    const { deps, user, cookieHeader } = await createAuthedDeps();
    const runId = await seedRun(deps, user);

    const feedbackResponse = await feedbackPOST(
      new Request("https://example.test/api/feedback", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookieHeader
        },
        body: JSON.stringify({
          runId,
          feedbackType: "helpful"
        })
      }),
      staticRouteContext
    );
    const feedbackBody = await feedbackResponse.json();

    expect(feedbackResponse.status).toBe(200);
    expect(feedbackBody.ok).toBe(true);

    const missingConfirmationResponse = await exportPOST(
      new Request("https://example.test/api/export", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookieHeader
        },
        body: JSON.stringify({
          runId,
          format: "clipboard",
          variant: "redaction_review",
          confirmRedactionReview: false
        })
      }),
      staticRouteContext
    );
    const missingConfirmationBody = await missingConfirmationResponse.json();

    expect(missingConfirmationResponse.status).toBe(400);
    expect(missingConfirmationBody.message).toBe("redaction_review_confirmation_required");

    const exportResponse = await exportPOST(
      new Request("https://example.test/api/export", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookieHeader
        },
        body: JSON.stringify({
          runId,
          format: "clipboard",
          variant: "redaction_review",
          confirmRedactionReview: true
        })
      }),
      staticRouteContext
    );
    const exportBody = await exportResponse.json();

    expect(exportResponse.status).toBe(200);
    expect(exportBody.ok).toBe(true);
    expect(exportBody.clipboardText).toContain("산안법 제10조 안전조치");
  });

  test("blocks export when a run is still verification_pending", async () => {
    const { deps, user, cookieHeader } = await createAuthedDeps();
    deps.mcp = {
      async lookupLaw(title) {
        return { lawId: `law:${title}`, title };
      },
      async lookupArticle() {
        throw new Error("mcp_down");
      },
      async queryEffectiveDate() {
        throw new Error("mcp_down");
      }
    };

    const runId = await seedRun(deps, user);

    const exportResponse = await exportPOST(
      new Request("https://example.test/api/export", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookieHeader
        },
        body: JSON.stringify({
          runId,
          format: "clipboard",
          variant: "redaction_review",
          confirmRedactionReview: true
        })
      }),
      staticRouteContext
    );
    const exportBody = await exportResponse.json();

    expect(exportResponse.status).toBe(423);
    expect(exportBody.message).toBe("verification_pending_export_locked");
  });

  test("rerun_current_law route fail-closes to verification_pending when MCP freshness cannot be proven", async () => {
    const { deps, user, cookieHeader } = await createAuthedDeps();
    const runId = await seedRun(deps, user);

    deps.mcp = {
      async lookupLaw(title) {
        return { lawId: `law:${title}`, title };
      },
      async lookupArticle() {
        throw new Error("mcp_down");
      },
      async queryEffectiveDate() {
        throw new Error("mcp_down");
      }
    };

    const response = await rerunPOST(
      new Request("https://example.test/api/answer-with-current-law", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookieHeader
        },
        body: JSON.stringify({
          runId
        })
      }),
      staticRouteContext
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.kind).toBe("verification_pending");
    expect(body.answer?.strength).toBe("verification_pending");
  });
});
