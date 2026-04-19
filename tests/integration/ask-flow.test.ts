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
import { retrieve } from "@/lib/search/retrieve";
import type { KoreanLawMcpClient } from "@/lib/open-law/mcp-client";

import { loadFixtureArticles } from "../unit/search/fixture-data";

function createEngineAdapter(responseFactory: (input: { schemaRef: string }) => unknown): EngineAdapter {
  return {
    provider: "anthropic",
    async generate() {
      return {
        sessionId: "engine-session-1",
        schemaRetries: 0,
        response: responseFactory({ schemaRef: "answer" }) as never
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
