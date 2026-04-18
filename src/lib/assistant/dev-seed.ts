import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { AnswerModuleOutput } from "@/lib/assistant/schemas";
import type { EngineAdapter, GenerateInput } from "@/lib/assistant/engine/types";
import { MCPNotFoundError, type KoreanLawMcpClient } from "@/lib/open-law/mcp-client";
import { normalizeTitle } from "@/lib/open-law/normalize";
import { computeContentHash, computeSourceHash, sanitizeLawText } from "@/lib/open-law/sanitize";
import { parseLawDetail } from "@/lib/open-law/xml";
import type { ArticleRecord } from "@/lib/search/storage";

const DEV_FIXTURE_PATH = path.join(process.cwd(), "tests", "fixtures", "open-law", "san-an-detail.xml");
const DEV_CONDITIONAL_EFFECTIVE_TO = "2026-01-01";

function buildSnapshotHash(pathKey: string, body: string, effectiveFrom: string | null, effectiveTo: string | null, repealedAt: string | null) {
  return computeContentHash([pathKey, body, effectiveFrom ?? "", effectiveTo ?? "", repealedAt ?? ""].join("|"));
}

function buildArticleRecord(input: {
  lawId: string;
  lawTitle: string;
  sourceHash: string;
  pathKey: string;
  articleNo: string;
  paragraph: string | null;
  item: string | null;
  kind: ArticleRecord["kind"];
  title: string | null;
  body: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  repealedAt: string | null;
}): ArticleRecord {
  const sanitizedBody = sanitizeLawText(input.body);
  const articleId = `dev:${input.lawId}:${input.pathKey}`;
  const snapshotHash = buildSnapshotHash(
    input.pathKey,
    sanitizedBody,
    input.effectiveFrom,
    input.effectiveTo,
    input.repealedAt
  );

  return {
    articleId,
    articleVersionId: `${articleId}:v1`,
    lawId: input.lawId,
    lawTitle: input.lawTitle,
    articleNo: input.articleNo,
    paragraph: input.paragraph,
    item: input.item,
    kind: input.kind,
    body: sanitizedBody,
    title: input.title,
    snippet: sanitizedBody.slice(0, 120),
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    repealedAt: input.repealedAt,
    snapshotHash,
    sourceHash: input.sourceHash
  };
}

export function loadDevLawArticles(): ArticleRecord[] {
  if (!existsSync(DEV_FIXTURE_PATH)) {
    console.warn(`[dev-seed] fixture missing: ${DEV_FIXTURE_PATH}`);
    return [];
  }

  try {
    const xml = readFileSync(DEV_FIXTURE_PATH, "utf8");
    const detail = parseLawDetail(xml);
    const sourceHash = computeSourceHash(xml);
    const lawId = detail.law.lawId ?? "dev-law-sanan";

    return [
      ...detail.articles.map((article) =>
        buildArticleRecord({
          lawId,
          lawTitle: detail.law.title,
          sourceHash,
          pathKey: article.articlePath,
          articleNo: article.articleNo,
          paragraph: article.paragraph,
          item: article.item,
          kind: article.kind,
          title: article.title,
          body: article.body,
          effectiveFrom: article.effectiveFrom,
          effectiveTo: article.effectiveTo,
          repealedAt: article.repealedAt
        })
      ),
      ...detail.appendices.map((appendix) =>
        buildArticleRecord({
          lawId,
          lawTitle: detail.law.title,
          sourceHash,
          pathKey: appendix.articlePath,
          articleNo: appendix.label,
          paragraph: null,
          item: null,
          kind: appendix.kind,
          title: appendix.title,
          body: appendix.body,
          effectiveFrom: appendix.effectiveFrom,
          effectiveTo: appendix.effectiveTo,
          repealedAt: null
        })
      )
    ];
  } catch (error) {
    console.warn(
      `[dev-seed] failed to load fixture ${DEV_FIXTURE_PATH}: ${error instanceof Error ? error.message : "unknown_error"}`
    );
    return [];
  }
}

function dedupeLawSections(citations: GenerateInput["prompt"]["citations"]): NonNullable<AnswerModuleOutput["law_sections"]> {
  const byLaw = new Map<string, NonNullable<AnswerModuleOutput["law_sections"]>[number]>();

  for (const citation of citations) {
    if (!byLaw.has(citation.lawTitle)) {
      byLaw.set(citation.lawTitle, {
        law_title: citation.lawTitle,
        summary: `${citation.articleNo} 중심으로 개발 fixture 기반 답변을 구성했습니다.`,
        why_it_applies: `${citation.lawTitle} ${citation.articleNo} 인용문이 직접 검색되었습니다.`,
        check_first: ["원문 조문 확인", "현장 사실관계 대조"]
      });
    }
  }

  return [...byLaw.values()];
}

function buildAnswerResponse(input: GenerateInput): AnswerModuleOutput {
  const citations = input.prompt.citations;
  const citationSummary =
    citations.length === 0
      ? "검색된 인용 조문이 없습니다."
      : citations
          .map((citation) => `${citation.lawTitle} ${citation.articleNo}${citation.paragraph ? ` 제${citation.paragraph}항` : ""}`)
          .join(", ");

  return {
    verified_facts: [
      `질문 기준일: ${input.prompt.referenceDate}`,
      `검색된 조문 ${citations.length}건`,
      "개발 환경 (Anthropic 미연결)"
    ],
    conclusion: "개발 스텁 응답입니다. 실제 법률 자문이 아닙니다. 아래 인용된 조문을 직접 확인해 주세요.",
    explanation: `검색 결과를 기반으로 확인된 조문: ${citationSummary}`,
    caution: "실제 사업장 정보, 설비 상태, 도급 구조는 별도로 확인해야 합니다.",
    answered_scope: citations.length > 0 ? ["검색된 조문 범위에서 1차 안내"] : ["개발 스텁 안내"],
    unanswered_scope: ["실제 사업장 정보", "작업 공정 상세"],
    priority_order: ["인용 조문 원문 확인", "현장 사실관계 보강", "전문가 검토 여부 판단"],
    collapsed_law_summary:
      citations.length > 0 ? `${citations[0].lawTitle} 중심 개발 fixture 응답` : "개발 fixture 응답",
    law_sections: dedupeLawSections(citations)
  };
}

export function createDevEngineAdapter(): EngineAdapter {
  return {
    provider: "codex",
    async generate(input) {
      if (input.schemaRef !== "answer") {
        return {
          sessionId: randomUUID(),
          schemaRetries: 0,
          response: {
            type: "schema_error",
            message: "dev_seed_only_supports_answer_schema",
            schema_retry_count: 2
          }
        };
      }

      return {
        sessionId: randomUUID(),
        schemaRetries: 0,
        response: buildAnswerResponse(input)
      };
    }
  };
}

function buildArticleKey(record: ArticleRecord) {
  return [record.lawId, record.articleNo, record.paragraph ?? "", record.item ?? ""].join("|");
}

export function createDevMcpClient(articles: ArticleRecord[]): KoreanLawMcpClient {
  const byArticleKey = new Map(articles.map((article) => [buildArticleKey(article), article]));
  const normalizedLawEntries = articles.map((article) => ({
    normalizedTitle: normalizeTitle(article.lawTitle).toLowerCase(),
    article
  }));

  return {
    async lookupLaw(title) {
      const normalized = normalizeTitle(title).toLowerCase();
      const matched =
        normalizedLawEntries.find((entry) => entry.normalizedTitle === normalized) ??
        normalizedLawEntries.find((entry) => entry.normalizedTitle.includes(normalized) || normalized.includes(entry.normalizedTitle));

      if (!matched) {
        throw new MCPNotFoundError(`law_not_found:${title}`);
      }

      return {
        lawId: matched.article.lawId,
        title: matched.article.lawTitle
      };
    },
    async lookupArticle({ lawId, articleNo, paragraph, item }) {
      const matched = byArticleKey.get([lawId, articleNo, paragraph ?? "", item ?? ""].join("|"));

      if (!matched) {
        throw new MCPNotFoundError(`article_not_found:${lawId}:${articleNo}`);
      }

      return {
        lawId: matched.lawId,
        articleNo: matched.articleNo,
        paragraph: matched.paragraph,
        item: matched.item,
        body: matched.body,
        snapshotHash: matched.snapshotHash,
        latestArticleVersionId: matched.articleVersionId,
        changeSummary: null
      };
    },
    async queryEffectiveDate({ lawId, articleNo }) {
      const matched = articles.find((article) => article.lawId === lawId && article.articleNo === articleNo);

      if (!matched) {
        throw new MCPNotFoundError(`effective_range_not_found:${lawId}:${articleNo}`);
      }

      return {
        effectiveFrom: matched.effectiveFrom,
        effectiveTo: matched.effectiveTo ?? DEV_CONDITIONAL_EFFECTIVE_TO,
        repealedAt: matched.repealedAt
      };
    }
  };
}
