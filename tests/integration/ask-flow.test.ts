// @vitest-environment node

import { describe, expect, test } from "vitest";

import { createInMemoryAuthStore } from "@/lib/auth/in-memory-store";
import { createInMemoryEngineSessionStore } from "@/lib/assistant/engine/session-store";
import { createInMemoryIdempotencyStore } from "@/lib/assistant/idempotency";
import { createInMemoryHistoryStore } from "@/lib/assistant/history-store";
import { rerunWithCurrentLaw } from "@/lib/assistant/rerun";
import { runQuery } from "@/lib/assistant/run-query";
import type { AssistantDeps } from "@/lib/assistant/deps";
import { createAnthropicAdapter } from "@/lib/assistant/engine/anthropic";
import type { EngineAdapter } from "@/lib/assistant/engine/types";
import { createInMemoryStorage } from "@/lib/search/in-memory-storage";
import type { ArticleRecord } from "@/lib/search/storage";
import { retrieve } from "@/lib/search/retrieve";
import type { KoreanLawMcpClient } from "@/lib/open-law/mcp-client";

import { loadFixtureArticles } from "../unit/search/fixture-data";

function createEngineAdapter(responseFactory: (input: { schemaRef: string }) => unknown): EngineAdapter {
  return {
    provider: "anthropic",
    async generate(input) {
      return {
        sessionId: "engine-session-1",
        schemaRetries: 0,
        response: responseFactory({ schemaRef: input.schemaRef }) as never
      };
    }
  };
}

function createMcpClient(options?: {
  missingArticleNos?: string[];
  disagreementArticleNos?: string[];
  outOfForceArticleNos?: string[];
  throwAll?: boolean;
}) {
  const missing = new Set(options?.missingArticleNos ?? []);
  const disagreement = new Set(options?.disagreementArticleNos ?? []);
  const outOfForce = new Set(options?.outOfForceArticleNos ?? []);

  const client: KoreanLawMcpClient = {
    async lookupLaw(title) {
      return {
        lawId: `mcp:${title}`,
        title
      };
    },
    async lookupArticle({ lawId, articleNo }) {
      if (options?.throwAll) {
        throw new Error("mcp_down");
      }

      if (missing.has(articleNo)) {
        const error = new Error("not_found");
        error.name = "MCPNotFoundError";
        throw error;
      }

      return {
        lawId,
        articleNo,
        paragraph: null,
        item: null,
        body: disagreement.has(articleNo) ? `MCP ${articleNo} 본문` : `${articleNo} 본문`,
        snapshotHash: `mcp-snap:${articleNo}`,
        latestArticleVersionId: disagreement.has(articleNo) ? `${articleNo}-latest` : null,
        changeSummary: disagreement.has(articleNo) ? "text_changed" : null
      };
    },
    async queryEffectiveDate({ articleNo }) {
      if (options?.throwAll) {
        throw new Error("mcp_down");
      }

      return {
        effectiveFrom: "2024-01-01",
        effectiveTo: outOfForce.has(articleNo) ? "2025-12-31" : null,
        repealedAt: null
      };
    }
  };

  return client;
}

async function createDeps(overrides?: {
  engine?: EngineAdapter;
  mcp?: KoreanLawMcpClient;
}) {
  const authStore = createInMemoryAuthStore();
  const user = await authStore.findOrCreateUserByEmail({
    email: "user@example.com",
    provider: "magic_link",
    providerSubject: "magic:user@example.com",
    now: "2026-04-18T00:00:00.000Z"
  });
  const historyStore = createInMemoryHistoryStore();
  const deps: AssistantDeps = {
    authStore,
    storage: createInMemoryStorage(loadFixtureArticles()),
    retrieveFn: retrieve,
    engine:
      overrides?.engine ??
      createEngineAdapter(() => ({
        verified_facts: ["프레스 작업 전 방호장치를 점검해야 한다."],
        conclusion: "방호장치 점검 후 작업해야 합니다.",
        explanation: "검색된 조문은 사업주의 안전조치 의무를 규정합니다.",
        caution: "설비와 공정에 따라 추가 점검이 필요할 수 있습니다."
      })),
    mcp: overrides?.mcp ?? createMcpClient(),
    historyStore,
    idempotencyStore: createInMemoryIdempotencyStore(),
    engineSessionStore: createInMemoryEngineSessionStore(),
    now: () => new Date("2026-04-18T00:00:00.000Z"),
    today: () => "2026-04-18"
  };

  return { deps, user, historyStore };
}

describe("runQuery integration", () => {
  test("returns an answer and persists history for a normal ask", async () => {
    const { deps, user, historyStore } = await createDeps({
      mcp: createMcpClient({
        disagreementArticleNos: ["제4조"]
      }),
      engine: createEngineAdapter(() => ({
        verified_facts: ["관계 기관 협조 요청 범위는 시행규칙 제4조에 정리돼 있다."],
        conclusion: "협조 요청 범위는 시행규칙 제4조를 먼저 보면 됩니다.",
        explanation: "관련 조문이 협조 요청 가능 범위를 직접 규정합니다.",
        caution: "추가 사업장 기준을 확인하세요."
      }))
    });

    const response = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "req-1",
        question: "산안법 시행규칙 제4조 협조 요청이 궁금합니다.",
        referenceDate: "2026-04-18"
      },
      user,
      deps,
      now: "2026-04-18T00:00:00.000Z"
    });

    expect(response.kind).toBe("answer");
    if (response.kind === "answer") {
      expect(response.runId).toBeTruthy();
      expect(response.renderedFrom).toBe("mcp_verification");
      expect(response.citations[0].rendered_from_verification).toBe(true);
    }

    const history = await historyStore.listRuns(user.id);
    expect(history.history).toHaveLength(1);
    expect(history.history[0].status).toBe("answered");
  });

  test("expands citation text to the full article body while keeping the original quote pointer", async () => {
    const paragraphOnlyBody = "제1항 본문";
    const articleRecords: ArticleRecord[] = [
      {
        articleId: "article-row",
        articleVersionId: "article-row-v1",
        lawId: "law-full-1",
        lawTitle: "산업안전보건법",
        articleNo: "제10조",
        paragraph: null,
        item: null,
        kind: "article",
        body: "제10조 본문",
        snippet: "제10조 본문",
        title: "안전조치",
        effectiveFrom: "2025-01-01",
        effectiveTo: null,
        repealedAt: null,
        snapshotHash: "snap-full-article",
        sourceHash: "source-full-article"
      },
      {
        articleId: "paragraph-row-1",
        articleVersionId: "paragraph-row-1-v1",
        lawId: "law-full-1",
        lawTitle: "산업안전보건법",
        articleNo: "제10조",
        paragraph: "1",
        item: null,
        kind: "paragraph",
        body: paragraphOnlyBody,
        snippet: paragraphOnlyBody,
        title: "안전조치",
        effectiveFrom: "2025-01-01",
        effectiveTo: null,
        repealedAt: null,
        snapshotHash: "snap-full-paragraph-1",
        sourceHash: "source-full-paragraph-1"
      },
      {
        articleId: "item-row-1",
        articleVersionId: "item-row-1-v1",
        lawId: "law-full-1",
        lawTitle: "산업안전보건법",
        articleNo: "제10조",
        paragraph: "1",
        item: "1",
        kind: "item",
        body: "제1호 본문",
        snippet: "제1호 본문",
        title: "안전조치",
        effectiveFrom: "2025-01-01",
        effectiveTo: null,
        repealedAt: null,
        snapshotHash: "snap-full-item-1",
        sourceHash: "source-full-item-1"
      },
      {
        articleId: "paragraph-row-2",
        articleVersionId: "paragraph-row-2-v1",
        lawId: "law-full-1",
        lawTitle: "산업안전보건법",
        articleNo: "제10조",
        paragraph: "2",
        item: null,
        kind: "paragraph",
        body: "제2항 본문",
        snippet: "제2항 본문",
        title: "안전조치",
        effectiveFrom: "2025-01-01",
        effectiveTo: null,
        repealedAt: null,
        snapshotHash: "snap-full-paragraph-2",
        sourceHash: "source-full-paragraph-2"
      }
    ];
    const { deps, user } = await createDeps({
      engine: createEngineAdapter(() => ({
        verified_facts: ["제10조 제1항 기준 안전조치 의무를 확인했습니다."],
        conclusion: "제10조 전체 본문을 함께 확인해야 합니다.",
        explanation: "단일 항만 인용됐더라도 조문 전체 본문은 함께 제시되어야 합니다.",
        caution: "현장 사실관계에 맞게 각 항과 호를 함께 검토하세요."
      }))
    });

    deps.storage = createInMemoryStorage(articleRecords);
    deps.retrieveFn = async () =>
      ({
        candidates: [
          {
            article_id: "paragraph-row-1",
            article_version_id: "paragraph-row-1-v1",
            law_id: "law-full-1",
            law_title: "산업안전보건법",
            article_no: "제10조",
            paragraph: "1",
            item: null,
            kind: "paragraph",
            body: paragraphOnlyBody,
            snippet: paragraphOnlyBody,
            effective_from: "2025-01-01",
            effective_to: null,
            repealed_at: null,
            snapshot_hash: "snap-full-paragraph-1",
            source_hash: "source-full-paragraph-1",
            score: 0.99,
            score_components: {
              lexical: 0.99
            }
          }
        ],
        strategy: "targeted_cache",
        emitted_disagreement_capable: true,
        weak: "strong"
      }) as never;
    deps.mcp = {
      async lookupLaw(title) {
        return {
          lawId: `mcp:${title}`,
          title
        };
      },
      async lookupArticle({ lawId, articleNo }) {
        return {
          lawId,
          articleNo,
          paragraph: "1",
          item: null,
          body: paragraphOnlyBody,
          snapshotHash: "mcp-snap-full-paragraph-1",
          latestArticleVersionId: null,
          changeSummary: null
        };
      },
      async queryEffectiveDate() {
        return {
          effectiveFrom: "2025-01-01",
          effectiveTo: null,
          repealedAt: null
        };
      }
    } satisfies KoreanLawMcpClient;

    const response = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "req-full-citation",
        question: "산안법 제10조 제1항이 궁금합니다.",
        referenceDate: "2026-04-18"
      },
      user,
      deps,
      now: "2026-04-18T00:00:00.000Z"
    });

    expect(response.kind).toBe("answer");
    if (response.kind === "answer") {
      expect(response.citations[0].quote).toBe(paragraphOnlyBody);
      expect(response.citations[0].text).toBe("제10조 본문\n\n제1항 본문\n\n제1호 본문\n\n제2항 본문");
    }
  });

  test("returns verification_pending with a structured fallback answer when answer generation times out", async () => {
    const { deps, user, historyStore } = await createDeps({
      engine: {
        provider: "codex",
        async generate(input) {
          if (input.schemaRef === "query_rewrite") {
            return {
              sessionId: "engine-session-1",
              schemaRetries: 0,
              response: {
                legal_terms: ["시행규칙", "협조 요청", "관계 기관"],
                law_hints: ["산업안전보건법 시행규칙"],
                article_hints: ["제4조"],
                intent_summary: "시행규칙 제4조의 협조 요청 범위를 확인"
              }
            };
          }

          throw Object.assign(new Error("The operation was aborted due to timeout"), {
            code: "engine_failure",
            name: "CodexDaemonError"
          });
        }
      }
    });

    const response = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "req-engine-timeout",
        question: "산안법 시행규칙 제4조 협조 요청이 궁금합니다.",
        referenceDate: "2026-04-18"
      },
      user,
      deps,
      now: "2026-04-18T00:00:00.000Z"
    });

    expect(response.kind).toBe("verification_pending");
    if (response.kind === "verification_pending") {
      expect(response.answer?.conclusion).toContain("검증 보류 상태");
      expect(response.answer?.verifiedFacts.length).toBeGreaterThan(0);
      expect(response.answer?.citations.length).toBeGreaterThan(0);
    }

    const history = await historyStore.listRuns(user.id);
    expect(history.history[0].status).toBe("verification_pending");
  });

  test("returns clarify on weak evidence when skipClarification is false", async () => {
    const { deps, user } = await createDeps();
    deps.retrieveFn = async () =>
      ({
        candidates: [
          {
            article_id: "weak-article",
            article_version_id: "weak-article-v1",
            law_id: "weak-law",
            law_title: "산업안전보건법",
            article_no: "제1조",
            paragraph: null,
            item: null,
            kind: "article",
            body: "짧은 본문",
            snippet: "짧은 본문",
            effective_from: "2024-01-01",
            effective_to: null,
            repealed_at: null,
            snapshot_hash: "weak-snap",
            source_hash: "weak-source",
            score: 0.1,
            score_components: {
              lexical: 0.1
            }
          }
        ],
        strategy: "targeted_cache",
        emitted_disagreement_capable: true,
        weak: "weak"
      }) as never;

    const response = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "req-2",
        question: "안전 관련 뭐가 필요해?",
        referenceDate: "2026-04-18"
      },
      user,
      deps,
      now: "2026-04-18T00:00:00.000Z"
    });

    expect(response.kind).toBe("clarify");
  });

  test("does not re-emit clarify when skipClarification is true", async () => {
    const { deps, user } = await createDeps();

    const response = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "req-3",
        question: "안전 관련 뭐가 필요해?",
        referenceDate: "2026-04-18",
        skipClarification: true
      },
      user,
      deps,
      now: "2026-04-18T00:00:00.000Z"
    });

    expect(["answer", "no_match"]).toContain(response.kind);
  });

  test("returns date_confirmation_required on past-date mismatch", async () => {
    const { deps, user, historyStore } = await createDeps();

    const response = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "req-4",
        question: "2024년 기준으로 산안법 의무를 알려줘",
        referenceDate: "2026-04-18"
      },
      user,
      deps,
      now: "2026-04-18T00:00:00.000Z"
    });

    expect(response.kind).toBe("date_confirmation_required");
    const history = await historyStore.listRuns(user.id);
    expect(history.history[0].status).toBe("clarify");
  });

  test("replays the same run for duplicate client_request_id with identical payload", async () => {
    const { deps, user } = await createDeps();

    const first = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "req-5",
        question: "산안법 시행규칙 제4조 협조 요청",
        referenceDate: "2026-04-18"
      },
      user,
      deps,
      now: "2026-04-18T00:00:00.000Z"
    });
    const second = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "req-5",
        question: "산안법 시행규칙 제4조 협조 요청",
        referenceDate: "2026-04-18"
      },
      user,
      deps,
      now: "2026-04-18T00:00:10.000Z"
    });

    expect(first.kind).toBe("answer");
    expect(second.kind).toBe("answer");
    if (first.kind === "answer" && second.kind === "answer") {
      expect(second.runId).toBe(first.runId);
    }
  });

  test("returns idempotency_conflict for reused ids with different payloads", async () => {
    const { deps, user } = await createDeps();

    await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "req-6",
        question: "산안법 시행규칙 제4조 협조 요청",
        referenceDate: "2026-04-18"
      },
      user,
      deps,
      now: "2026-04-18T00:00:00.000Z"
    });

    const response = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "req-6",
        question: "중처법 제4조 의무",
        referenceDate: "2026-04-18"
      },
      user,
      deps,
      now: "2026-04-18T00:00:10.000Z"
    });

    expect(response.kind).toBe("idempotency_conflict");
  });

  test("persists schema_error when the engine fails schema validation twice", async () => {
    const { deps, user, historyStore } = await createDeps({
      engine: createEngineAdapter(() => ({
        type: "schema_error",
        message: "schema failed",
        schema_retry_count: 2
      }))
    });

    const response = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "req-7",
        question: "산안법 시행규칙 제4조 협조 요청",
        referenceDate: "2026-04-18"
      },
      user,
      deps,
      now: "2026-04-18T00:00:00.000Z"
    });

    expect(response.kind).toBe("schema_error");
    const history = await historyStore.listRuns(user.id);
    expect(history.history[0].status).toBe("schema_error");
  });

  test("returns verification_pending when MCP verification fully fails", async () => {
    const { deps, user } = await createDeps({
      mcp: createMcpClient({
        throwAll: true
      })
    });

    const response = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "req-8",
        question: "산안법 시행규칙 제4조 협조 요청",
        referenceDate: "2026-04-18",
        skipClarification: true
      },
      user,
      deps,
      now: "2026-04-18T00:00:00.000Z"
    });

    expect(response.kind).toBe("verification_pending");
  });

  test("returns verification_pending on rerun_current_law when freshness cannot be proven", async () => {
    const { deps, user, historyStore } = await createDeps({
      mcp: createMcpClient({
        throwAll: true
      })
    });

    const first = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "req-9",
        question: "산안법 시행규칙 제4조 협조 요청",
        referenceDate: "2026-04-10",
        skipClarification: true
      },
      user,
      deps,
      now: "2026-04-10T00:00:00.000Z"
    });

    expect(first.kind).toBe("verification_pending");

    const rerun = await rerunWithCurrentLaw({
      parentRunId:
        first.kind === "verification_pending" ? first.runId : first.kind === "answer" ? first.runId : "missing",
      user,
      deps,
      now: "2026-04-18T00:00:00.000Z"
    });

    expect(rerun.kind).toBe("verification_pending");
    if (rerun.kind === "verification_pending") {
      expect(rerun.answer?.strength).toBe("verification_pending");
    }

    const history = await historyStore.listRuns(user.id);
    expect(history.history.length).toBeGreaterThanOrEqual(2);
  });
});
