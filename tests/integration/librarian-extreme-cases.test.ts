// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import { createInMemoryAuthStore } from "@/lib/auth/in-memory-store";
import type { AssistantDeps } from "@/lib/assistant/deps";
import { createInMemoryEngineSessionStore } from "@/lib/assistant/engine/session-store";
import type { EngineAdapter } from "@/lib/assistant/engine/types";
import { createInMemoryHistoryStore } from "@/lib/assistant/history-store";
import { createInMemoryIdempotencyStore } from "@/lib/assistant/idempotency";
import { runQuery } from "@/lib/assistant/run-query";
import { createLogger } from "@/lib/logging";
import type { KoreanLawMcpClient } from "@/lib/open-law/mcp-client";
import { createInMemoryStorage } from "@/lib/search/in-memory-storage";
import { retrieve } from "@/lib/search/retrieve";
import type { ArticleRecord } from "@/lib/search/storage";

const EXTREME_CASES = [
  {
    question: "공구리를 치는데 적절한 안전조치 사항을 알려줘",
    expectedTerm: "콘크리트 타설"
  },
  {
    question: "족장 위에서 작업할 때 뭐 해야 하나",
    expectedTerm: "비계"
  },
  {
    question: "신나통 옮기는데 필요한 절차",
    expectedTerm: "유기용제"
  },
  {
    question: "안전띠 매는 기준 뭐임?",
    expectedTerm: "안전대"
  },
  {
    question: "곤도라 사용 전 체크리스트",
    expectedTerm: "달비계"
  },
  {
    question: "전로 수리할 때 고소작업 안전",
    expectedTerm: "고소작업"
  }
] as const;

function makeArticle(input: {
  articleId: string;
  articleNo: string;
  title: string;
  body: string;
  lawTitle?: string;
}): ArticleRecord {
  return {
    articleId: input.articleId,
    articleVersionId: `${input.articleId}-v1`,
    lawId: "law-safety-rules",
    lawTitle: input.lawTitle ?? "산업안전보건기준에 관한 규칙",
    articleNo: input.articleNo,
    paragraph: null,
    item: null,
    kind: "article",
    title: input.title,
    body: input.body,
    snippet: input.body.slice(0, 80),
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    repealedAt: null,
    snapshotHash: `snap-${input.articleId}`,
    sourceHash: createHash("sha256").update(input.body).digest("hex")
  };
}

function createExtremeArticles() {
  return [
    makeArticle({
      articleId: "concrete",
      articleNo: "제140조",
      title: "콘크리트 타설 작업",
      body: "콘크리트 타설 및 거푸집 작업을 할 때에는 작업발판을 설치하고 추락 방지 조치를 하여야 한다."
    }),
    makeArticle({
      articleId: "scaffold",
      articleNo: "제57조",
      title: "비계 작업 기준",
      body: "비계에서 작업할 때에는 작업발판을 설치하고 비계의 조립 상태 및 추락 방지 조치를 점검하여야 한다."
    }),
    makeArticle({
      articleId: "solvent",
      articleNo: "제318조",
      title: "유기용제 취급",
      body: "유기용제 및 인화성 액체를 운반하거나 취급할 때에는 용기 밀폐, 누출 방지 및 환기 조치를 하여야 한다."
    }),
    makeArticle({
      articleId: "belt",
      articleNo: "제32조",
      title: "안전대 사용",
      body: "높은 장소에서 작업할 때에는 안전대를 착용하고 추락 방지 조치를 병행하여야 한다."
    }),
    makeArticle({
      articleId: "gondola",
      articleNo: "제86조",
      title: "달비계 점검",
      body: "달비계 또는 달기구를 사용하기 전에는 와이어, 고정 상태 및 추락 방지 장치를 점검하여야 한다."
    }),
    makeArticle({
      articleId: "height",
      articleNo: "제44조",
      title: "고소작업 안전",
      body: "고소작업을 하는 경우에는 작업발판, 안전대 및 추락 방지 설비를 설치하여야 한다."
    })
  ];
}

function buildRewrite(question: string) {
  if (question.includes("공구리")) {
    return {
      legal_terms: ["콘크리트 타설", "거푸집 작업", "작업발판", "추락 방지 조치"],
      law_hints: ["산업안전보건기준에 관한 규칙"],
      article_hints: [],
      intent_summary: "콘크리트 타설 작업 시 안전조치 확인"
    };
  }

  if (question.includes("족장")) {
    return {
      legal_terms: ["비계", "작업발판", "추락 방지 조치"],
      law_hints: ["산업안전보건기준에 관한 규칙"],
      article_hints: [],
      intent_summary: "비계 작업 시 필수 안전조치 확인"
    };
  }

  if (question.includes("신나통")) {
    return {
      legal_terms: ["유기용제", "인화성 액체", "용기 운반", "환기 조치"],
      law_hints: ["산업안전보건기준에 관한 규칙"],
      article_hints: [],
      intent_summary: "유기용제 운반 작업의 취급 절차 확인"
    };
  }

  if (question.includes("안전띠")) {
    return {
      legal_terms: ["안전대", "추락 방지 조치", "고소작업"],
      law_hints: ["산업안전보건기준에 관한 규칙"],
      article_hints: [],
      intent_summary: "고소작업 시 안전대 사용 기준 확인"
    };
  }

  if (question.includes("곤도라")) {
    return {
      legal_terms: ["달비계", "달기구", "점검", "추락 방지 장치"],
      law_hints: ["산업안전보건기준에 관한 규칙"],
      article_hints: [],
      intent_summary: "달비계 사용 전 점검 항목 확인"
    };
  }

  return {
    legal_terms: ["고소작업", "작업발판", "안전대", "추락 방지 설비"],
    law_hints: ["산업안전보건기준에 관한 규칙"],
    article_hints: [],
    intent_summary: "고소작업 안전조치 확인"
  };
}

function createEngine(): EngineAdapter {
  return {
    provider: "codex",
    async generate(input) {
      if (input.schemaRef === "query_rewrite") {
        const question = input.prompt.user.split("질문:")[1]?.trim() ?? input.prompt.user;

        return {
          sessionId: "query-rewrite-session",
          schemaRetries: 0,
          response: buildRewrite(question)
        };
      }

      return {
        sessionId: "answer-session",
        schemaRetries: 0,
        response: {
          verified_facts: ["검색된 조문에 따라 안전조치를 확인했습니다."],
          conclusion: `${input.prompt.user.split("\n")[2] ?? "질문"} 관련 법령 용어 기준으로 답변합니다.`,
          explanation: "rewrite된 법령 용어로 검색한 조문을 근거로 정리했습니다.",
          caution: "현장 조건과 설비 상태에 따라 추가 조치가 필요할 수 있습니다."
        }
      };
    }
  };
}

function createMcp(): KoreanLawMcpClient {
  return {
    async lookupLaw(title) {
      return {
        lawId: `mcp:${title}`,
        title
      };
    },
    async lookupArticle({ lawId, articleNo }) {
      const article = createExtremeArticles().find((candidate) => candidate.articleNo === articleNo);

      return {
        lawId,
        articleNo,
        paragraph: null,
        item: null,
        body: article?.body ?? "본문",
        snapshotHash: `mcp-${articleNo}`,
        latestArticleVersionId: `${articleNo}-latest`,
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
  };
}

async function createDeps() {
  const authStore = createInMemoryAuthStore();
  const user = await authStore.findOrCreateUserByEmail({
    email: "librarian@example.com",
    provider: "magic_link",
    providerSubject: "magic:librarian@example.com",
    now: "2026-04-19T00:00:00.000Z"
  });

  const deps: AssistantDeps = {
    authStore,
    storage: createInMemoryStorage(createExtremeArticles()),
    retrieveFn: retrieve,
    engine: createEngine(),
    mcp: createMcp(),
    historyStore: createInMemoryHistoryStore(),
    idempotencyStore: createInMemoryIdempotencyStore(),
    engineSessionStore: createInMemoryEngineSessionStore(),
    logger: createLogger(),
    now: () => new Date("2026-04-19T00:00:00.000Z"),
    today: () => "2026-04-19"
  };

  return { deps, user };
}

describe("librarian extreme cases", () => {
  test.each(EXTREME_CASES)("rewrites '%s' into legal retrieval terms and avoids no_match", async ({ question, expectedTerm }) => {
    const { deps, user } = await createDeps();

    const response = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: `librarian-${createHash("sha1").update(question).digest("hex").slice(0, 8)}`,
        question,
        referenceDate: "2026-04-19"
      },
      user,
      deps,
      now: "2026-04-19T00:00:00.000Z"
    });

    expect(["answer", "verification_pending"]).toContain(response.kind);
    expect(response.kind).not.toBe("no_match");

    if (!("runId" in response)) {
      throw new Error(`unexpected_response_kind:${response.kind}`);
    }

    const runId = response.runId;
    const persisted = runId ? await deps.historyStore.getRun(runId) : null;

    expect(persisted?.query_rewrite_terms).toEqual(expect.arrayContaining([expectedTerm]));
    expect(persisted?.query_rewrite_intent).toEqual(expect.any(String));
  });
});
