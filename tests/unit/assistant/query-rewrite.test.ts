import { describe, expect, test } from "vitest";

import { createLogger } from "@/lib/logging";
import type { QueryRewriteOutput } from "@/lib/assistant/schemas";
import { mergeQueryRewriteHints, rewriteQuery } from "@/lib/assistant/query-rewrite";
import type { EngineAdapter } from "@/lib/assistant/engine/types";

function createEngine(
  impl: NonNullable<EngineAdapter["generate"]>
): EngineAdapter {
  return {
    provider: "codex",
    generate: impl
  };
}

describe("rewriteQuery", () => {
  test("returns structured rewrite output and logs success", async () => {
    const logger = createLogger();
    const expected: QueryRewriteOutput = {
      legal_terms: ["콘크리트 타설", "거푸집 작업", "작업발판", "추락 방지 조치"],
      law_hints: ["산업안전보건기준에 관한 규칙"],
      article_hints: [],
      intent_summary: "콘크리트 타설 작업에 필요한 안전보건 의무 확인"
    };
    const engine = createEngine(async (input) => ({
      sessionId: "rewrite-session-1",
      schemaRetries: 0,
      response: expected
    }));

    const result = await rewriteQuery({
      engine,
      userId: "user-1",
      question: "공구리를 치는데 적절한 안전조치 사항을 알려줘",
      referenceDate: "2026-04-19",
      logger
    });

    expect(result).toEqual(expected);
    expect(logger.drain()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          msg: "query_rewrite.success"
        })
      ])
    );
  });

  test("returns null when the engine exhausts schema retries", async () => {
    const logger = createLogger();
    const engine = createEngine(async () => ({
      sessionId: "rewrite-session-2",
      schemaRetries: 2,
      response: {
        type: "schema_error",
        message: "bad schema",
        schema_retry_count: 2
      }
    }));

    const result = await rewriteQuery({
      engine,
      userId: "user-1",
      question: "곤도라 사용 전 체크리스트",
      referenceDate: "2026-04-19",
      logger
    });

    expect(result).toBeNull();
    expect(logger.drain()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          msg: "query_rewrite.schema_error"
        })
      ])
    );
  });

  test("returns null when the engine times out", async () => {
    const logger = createLogger();
    const engine = createEngine(async () => {
      const error = new Error("engine_timeout");
      Object.assign(error, { code: "engine_timeout" });
      throw error;
    });

    const result = await rewriteQuery({
      engine,
      userId: "user-1",
      question: "족장 위에서 작업할 때 뭐 해야 하나",
      referenceDate: "2026-04-19",
      logger
    });

    expect(result).toBeNull();
    expect(logger.drain()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          msg: "query_rewrite.timeout"
        })
      ])
    );
  });
});

describe("mergeQueryRewriteHints", () => {
  test("dedupes, prioritizes rewrite terms, appends hints, and caps tokens to 8", () => {
    const merged = mergeQueryRewriteHints({
      question: "산안법 제10조 안전대 착용 기준과 추락방지 장치가 궁금합니다.",
      rewrite: {
        legal_terms: ["안전대", "추락 방지 조치", "작업발판", "안전대", "고소작업", "비계"],
        law_hints: ["산업안전보건법", "산업안전보건법 시행규칙"],
        article_hints: ["제10조", "별표 1"],
        intent_summary: "추락 위험 작업 시 보호구와 방지조치 확인"
      },
      tokenCap: 8
    });

    expect(merged.tokens).toEqual([
      "안전대",
      "추락",
      "방지",
      "조치",
      "작업발판",
      "고소작업",
      "비계",
      "산안법"
    ]);
    expect(merged.lawHints).toEqual(["산업안전보건법", "산업안전보건법 시행규칙"]);
    expect(merged.articleNumberHints).toEqual([
      {
        kind: "article",
        articleNo: "제10조",
        paragraph: null,
        item: null
      },
      {
        kind: "appendix",
        label: "별표 1"
      }
    ]);
    expect(merged.intentSummary).toBe("추락 위험 작업 시 보호구와 방지조치 확인");
    expect(merged.rewriteTerms).toEqual(["안전대", "추락 방지 조치", "작업발판", "안전대", "고소작업", "비계"]);
  });
});
