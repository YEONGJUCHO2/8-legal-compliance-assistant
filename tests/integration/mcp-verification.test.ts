// @vitest-environment node

import { afterEach, describe, expect, test, vi } from "vitest";

import { POST } from "@/app/api/ask/route";
import type { AssistantDeps } from "@/lib/assistant/deps";
import { resetAssistantDepsForTesting, setAssistantDepsForTesting } from "@/lib/assistant/deps";
import { createInMemoryIdempotencyStore } from "@/lib/assistant/idempotency";
import { createInMemoryHistoryStore } from "@/lib/assistant/history-store";
import { createKoreanLawMcpClient } from "@/lib/open-law/mcp-client";
import { setSessionCookieHeader } from "@/lib/auth/session";
import { hashToken } from "@/lib/auth/tokens";
import { createInMemoryAuthStore } from "@/lib/auth/in-memory-store";
import type { CitationToVerify } from "@/lib/verify/types";

import { startMockMcp } from "./helpers/mock-mcp-server";

const staticRouteContext = {
  params: Promise.resolve({})
};

const fixedAnswer = {
  verified_facts: ["테스트 사실"],
  conclusion: "테스트 결론",
  explanation: "테스트 설명",
  caution: "테스트 주의사항"
};

function toCandidate(citation: CitationToVerify, score = 0.95) {
  return {
    article_id: citation.id,
    article_version_id: citation.articleVersionId,
    law_id: citation.lawId,
    law_title: citation.lawTitle,
    article_no: citation.articleNo,
    paragraph: citation.paragraph ?? null,
    item: citation.item ?? null,
    kind: "article" as const,
    body: citation.localBody,
    snippet: citation.localBody,
    effective_from: "2024-01-01",
    effective_to: null,
    repealed_at: null,
    snapshot_hash: citation.localSnapshotHash,
    source_hash: citation.localSourceHash,
    score,
    score_components: {
      lexical: score
    }
  };
}

async function createAuthedDeps(input: {
  citations: CitationToVerify[];
  mcpBaseUrl: string;
  timeoutMs?: number;
}) {
  const authStore = createInMemoryAuthStore();
  const user = await authStore.findOrCreateUserByEmail({
    email: "user@example.com",
    provider: "magic_link",
    providerSubject: "magic:user@example.com",
    now: "2026-04-18T00:00:00.000Z"
  });
  const sessionToken = `session-token-${Math.random().toString(36).slice(2)}`;
  const cookie = setSessionCookieHeader(sessionToken, "2026-04-25T00:00:00.000Z");

  await authStore.createSession({
    userId: user.id,
    tokenHash: hashToken(sessionToken),
    createdAt: "2026-04-18T00:00:00.000Z",
    expiresAt: "2026-04-25T00:00:00.000Z"
  });

  const historyStore = createInMemoryHistoryStore();
  const persistCitationsSpy = vi.spyOn(historyStore, "persistCitations");
  const mcp = createKoreanLawMcpClient({
    baseUrl: input.mcpBaseUrl,
    timeoutMs: input.timeoutMs ?? 100
  });

  const deps: AssistantDeps = {
    authStore,
    storage: {
      async findArticlesByLexical() {
        return [];
      },
      async findArticlesByNumber() {
        return [];
      },
      async findFromSnapshotCache() {
        return [];
      },
      async hydrateArticles() {
        return [];
      },
      async loadFullArticleBody() {
        return null;
      }
    },
    retrieveFn: async () =>
      ({
        candidates: input.citations.map((citation, index) => toCandidate(citation, 0.95 - index * 0.1)),
        strategy: "targeted_cache",
        emitted_disagreement_capable: true,
        weak: "strong"
      }) as never,
    engine: {
      provider: "anthropic",
      async generate() {
        return {
          sessionId: "mcp-integration-engine-session",
          schemaRetries: 0,
          response: fixedAnswer
        };
      }
    },
    mcp,
    historyStore,
    idempotencyStore: createInMemoryIdempotencyStore(),
    now: () => new Date("2026-04-18T00:00:00.000Z"),
    today: () => "2026-04-18"
  };

  setAssistantDepsForTesting(deps);

  return {
    cookie: `${cookie.name}=${cookie.value}`,
    persistCitationsSpy
  };
}

function createCitation(input: Partial<CitationToVerify> = {}): CitationToVerify {
  return {
    id: "article-1",
    articleVersionId: "article-version-1",
    lawId: "SAFETY_LAW",
    lawTitle: "산업안전보건법",
    articleNo: "제10조",
    paragraph: undefined,
    item: undefined,
    localBody: "사업주는 필요한 안전조치를 하여야 한다.",
    localSnapshotHash: "local-snap-1",
    localSourceHash: "local-source-1",
    position: 0,
    ...input
  };
}

async function askWithCookie(cookie: string, clientRequestId: string) {
  const request = new Request("https://example.test/api/ask", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie
    },
    body: JSON.stringify({
      mode: "ask",
      clientRequestId,
      question: "MCP 검증 테스트",
      referenceDate: "2026-04-18",
      skipClarification: true
    })
  });

  const response = await POST(request, staticRouteContext);
  const body = await response.json();

  return {
    response,
    body
  };
}

afterEach(() => {
  resetAssistantDepsForTesting();
});

describe("MCP verification integration", () => {
  test("agreement exposes verified MCP citation metadata through /api/ask", async () => {
    const server = await startMockMcp();
    const citation = createCitation();

    server.stub({
      method: "GET",
      path: "/articles/lookup",
      match: (url) => url.searchParams.get("lawId") === "SAFETY_LAW" && url.searchParams.get("articleNo") === "제10조",
      respond: {
        status: 200,
        body: {
          lawId: "SAFETY_LAW",
          articleNo: "제10조",
          paragraph: null,
          item: null,
          body: citation.localBody,
          snapshotHash: "mcp-snap-1",
          latestArticleVersionId: null,
          changeSummary: null
        }
      }
    });
    server.stub({
      method: "GET",
      path: "/articles/effective-range",
      match: (url) => url.searchParams.get("lawId") === "SAFETY_LAW" && url.searchParams.get("articleNo") === "제10조",
      respond: {
        status: 200,
        body: {
          effectiveFrom: "2024-01-01",
          effectiveTo: null,
          repealedAt: null
        }
      }
    });

    try {
      const { cookie } = await createAuthedDeps({
        citations: [citation],
        mcpBaseUrl: server.url
      });
      const { response, body } = await askWithCookie(cookie, "mcp-it-1");

      expect(response.status).toBe(200);
      expect(body.kind).toBe("answer");
      expect(body.status).toBe("answered");
      expect(body.citations[0]).toMatchObject({
        verification_source: "mcp",
        mcp_disagreement: false,
        in_force_at_query_date: true
      });
      expect(body.citations[0].answer_strength_downgrade).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  test("disagreement marks citation and answer strength as downgraded", async () => {
    const server = await startMockMcp();
    const citation = createCitation();

    server.stub({
      method: "GET",
      path: "/articles/lookup",
      match: () => true,
      respond: {
        status: 200,
        body: {
          lawId: "SAFETY_LAW",
          articleNo: "제10조",
          paragraph: null,
          item: null,
          body: "사업주는 강화된 안전조치를 하여야 한다.",
          snapshotHash: "mcp-snap-2",
          latestArticleVersionId: "article-version-latest-1",
          changeSummary: "text_changed"
        }
      }
    });
    server.stub({
      method: "GET",
      path: "/articles/effective-range",
      match: () => true,
      respond: {
        status: 200,
        body: {
          effectiveFrom: "2024-01-01",
          effectiveTo: null,
          repealedAt: null
        }
      }
    });

    try {
      const { cookie } = await createAuthedDeps({
        citations: [citation],
        mcpBaseUrl: server.url
      });
      const { body } = await askWithCookie(cookie, "mcp-it-2");

      expect(body.kind).toBe("answer");
      expect(body.status).toBe("answered");
      expect(body.strength).toBe("conditional");
      expect(body.citations[0]).toMatchObject({
        verification_source: "mcp",
        mcp_disagreement: true,
        answer_strength_downgrade: "conditional"
      });
    } finally {
      await server.close();
    }
  });

  test("404 not found downgrades the route to verification_pending with missing citation metadata", async () => {
    const server = await startMockMcp();
    const citation = createCitation();

    server.stub({
      method: "GET",
      path: "/articles/lookup",
      match: () => true,
      respond: {
        status: 404,
        body: {
          message: "not found"
        }
      }
    });
    server.stub({
      method: "GET",
      path: "/articles/effective-range",
      match: () => true,
      respond: {
        status: 200,
        body: {
          effectiveFrom: "2024-01-01",
          effectiveTo: null,
          repealedAt: null
        }
      }
    });

    try {
      const { cookie } = await createAuthedDeps({
        citations: [citation],
        mcpBaseUrl: server.url
      });
      const { response, body } = await askWithCookie(cookie, "mcp-it-3");

      expect(response.status).toBe(200);
      expect(body.kind).toBe("verification_pending");
      expect(body.status).toBe("verification_pending");
      expect(body.answer.citations[0]).toMatchObject({
        verification_source: "missing",
        answer_strength_downgrade: "verification_pending"
      });
    } finally {
      await server.close();
    }
  });

  test("timeout downgrades the route to verification_pending without crashing the request", async () => {
    const server = await startMockMcp();
    const citation = createCitation();

    server.stub({
      method: "GET",
      path: "/articles/lookup",
      match: () => true,
      respond: {
        status: 200,
        delayMs: 80,
        body: {
          lawId: "SAFETY_LAW",
          articleNo: "제10조",
          paragraph: null,
          item: null,
          body: citation.localBody,
          snapshotHash: "mcp-snap-timeout",
          latestArticleVersionId: null,
          changeSummary: null
        }
      }
    });
    server.stub({
      method: "GET",
      path: "/articles/effective-range",
      match: () => true,
      respond: {
        status: 200,
        body: {
          effectiveFrom: "2024-01-01",
          effectiveTo: null,
          repealedAt: null
        }
      }
    });

    try {
      const { cookie } = await createAuthedDeps({
        citations: [citation],
        mcpBaseUrl: server.url,
        timeoutMs: 20
      });
      const { body } = await askWithCookie(cookie, "mcp-it-4");

      expect(body.kind).toBe("verification_pending");
      expect(body.status).toBe("verification_pending");
      expect(body.answer.citations[0]).toMatchObject({
        verification_source: "missing",
        answer_strength_downgrade: "verification_pending"
      });
    } finally {
      await server.close();
    }
  });

  test("partial MCP failure keeps successful citations and persists the mixed result", async () => {
    const server = await startMockMcp();
    const citations = [
      createCitation(),
      createCitation({
        id: "article-2",
        articleVersionId: "article-version-2",
        lawId: "SAFETY_LAW",
        articleNo: "제15조",
        localBody: "안전관리자를 선임해야 한다.",
        localSnapshotHash: "local-snap-2",
        localSourceHash: "local-source-2",
        position: 1
      }),
      createCitation({
        id: "article-3",
        articleVersionId: "article-version-3",
        lawId: "PENALTY_LAW",
        lawTitle: "중대재해 처벌 등에 관한 법률",
        articleNo: "제4조",
        localBody: "사업주 또는 경영책임자는 안전보건 확보의무를 이행해야 한다.",
        localSnapshotHash: "local-snap-3",
        localSourceHash: "local-source-3",
        position: 2
      })
    ];

    for (const citation of citations) {
      server.stub({
        method: "GET",
        path: "/articles/effective-range",
        match: (url) => url.searchParams.get("lawId") === citation.lawId && url.searchParams.get("articleNo") === citation.articleNo,
        respond: {
          status: 200,
          body: {
            effectiveFrom: "2024-01-01",
            effectiveTo: null,
            repealedAt: null
          }
        }
      });
    }

    server.stub({
      method: "GET",
      path: "/articles/lookup",
      match: (url) => url.searchParams.get("articleNo") === "제10조",
      respond: {
        status: 200,
        body: {
          lawId: "SAFETY_LAW",
          articleNo: "제10조",
          paragraph: null,
          item: null,
          body: citations[0].localBody,
          snapshotHash: "mcp-snap-10",
          latestArticleVersionId: null,
          changeSummary: null
        }
      }
    });
    server.stub({
      method: "GET",
      path: "/articles/lookup",
      match: (url) => url.searchParams.get("articleNo") === "제15조",
      respond: {
        status: 200,
        body: {
          lawId: "SAFETY_LAW",
          articleNo: "제15조",
          paragraph: null,
          item: null,
          body: citations[1].localBody,
          snapshotHash: "mcp-snap-15",
          latestArticleVersionId: null,
          changeSummary: null
        }
      }
    });
    server.stub({
      method: "GET",
      path: "/articles/lookup",
      match: (url) => url.searchParams.get("articleNo") === "제4조",
      respond: {
        status: 404,
        body: {
          message: "not found"
        }
      }
    });

    try {
      const { cookie, persistCitationsSpy } = await createAuthedDeps({
        citations,
        mcpBaseUrl: server.url
      });
      const { body } = await askWithCookie(cookie, "mcp-it-5");

      expect(body.kind).toBe("verification_pending");
      expect(body.status).toBe("verification_pending");
      expect(body.answer.citations).toHaveLength(3);
      expect(body.answer.citations.filter((citation: { verification_source: string }) => citation.verification_source === "mcp")).toHaveLength(2);
      expect(body.answer.citations.filter((citation: { verification_source: string }) => citation.verification_source === "missing")).toHaveLength(1);
      expect(persistCitationsSpy).toHaveBeenCalledTimes(1);
      expect(persistCitationsSpy.mock.calls[0][0]).toHaveLength(3);
    } finally {
      await server.close();
    }
  });

  test("effective date mismatch marks citation out of force and downgrades strength", async () => {
    const server = await startMockMcp();
    const citation = createCitation();

    server.stub({
      method: "GET",
      path: "/articles/lookup",
      match: () => true,
      respond: {
        status: 200,
        body: {
          lawId: "SAFETY_LAW",
          articleNo: "제10조",
          paragraph: null,
          item: null,
          body: citation.localBody,
          snapshotHash: "mcp-snap-6",
          latestArticleVersionId: null,
          changeSummary: null
        }
      }
    });
    server.stub({
      method: "GET",
      path: "/articles/effective-range",
      match: () => true,
      respond: {
        status: 200,
        body: {
          effectiveFrom: "2026-05-01",
          effectiveTo: null,
          repealedAt: null
        }
      }
    });

    try {
      const { cookie } = await createAuthedDeps({
        citations: [citation],
        mcpBaseUrl: server.url
      });
      const { body } = await askWithCookie(cookie, "mcp-it-6");

      expect(body.kind).toBe("answer");
      expect(body.status).toBe("answered");
      expect(body.strength).toBe("conditional");
      expect(body.citations[0]).toMatchObject({
        verification_source: "mcp",
        in_force_at_query_date: false,
        answer_strength_downgrade: "conditional"
      });
    } finally {
      await server.close();
    }
  });
});
