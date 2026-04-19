import { XMLParser } from "fast-xml-parser";

import type {
  OpenLawAppendix,
  OpenLawArticle,
  OpenLawLawDocument,
  ParsedLawDetail,
  SearchLawResult
} from "@/lib/open-law/types";

const parser = new XMLParser({
  attributeNamePrefix: "",
  ignoreAttributes: false,
  parseTagValue: false,
  processEntities: true,
  trimValues: true
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function readText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((entry) => readText(entry))
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  return "";
}

function normalizeDate(value: unknown): string | null {
  const text = readText(value).replace(/\./g, "").replace(/\//g, "").replace(/-/g, "");

  if (!text) {
    return null;
  }

  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }

  return readText(value) || null;
}

function normalizeOrdinal(value: unknown): string | null {
  const text = readText(value).trim();

  if (!text) {
    return null;
  }

  return text.replace(/[.)]$/, "").trim() || null;
}

function formatArticleNo(articleNo: unknown, branchNo: unknown): string {
  const base = readText(articleNo).replace(/^0+/, "") || readText(articleNo);
  const branch = readText(branchNo).replace(/^0+/, "");

  if (!base) {
    return "";
  }

  return branch ? `제${base}조의${branch}` : `제${base}조`;
}

function formatAppendixLabel(number: unknown, branchNo: unknown): string {
  const base = readText(number).replace(/^0+/, "") || readText(number);
  const branch = readText(branchNo).replace(/^0+/, "");

  if (!base) {
    return "";
  }

  return branch ? `별표 ${base}의${branch}` : `별표 ${base}`;
}

function parseArticleNode(node: Record<string, unknown>): OpenLawArticle[] {
  if (readText(node.조문여부) && readText(node.조문여부) !== "조문") {
    return [];
  }

  const articleNo = formatArticleNo(node.조문번호, node.조문가지번호);
  const title = readText(node.조문제목) || null;
  const body = readText(node.조문내용);
  const effectiveFrom = normalizeDate(node.조문시행일자);
  const effectiveTo = normalizeDate(node.조문종료일자);
  const repealedAt = normalizeDate(node.조문삭제일자);

  if (!articleNo || !body) {
    return [];
  }

  const article: OpenLawArticle = {
    articleNo,
    paragraph: null,
    item: null,
    kind: "article",
    title,
    body,
    effectiveFrom,
    effectiveTo,
    repealedAt,
    articlePath: articleNo
  };

  const paragraphs = asArray(node.항).flatMap((paragraphNode) => {
    const paragraphRecord = paragraphNode as Record<string, unknown>;
    const paragraphNo = readText(paragraphRecord.항번호) || null;
    const paragraphBody = readText(paragraphRecord.항내용);
    const paragraphEffectiveFrom = normalizeDate(paragraphRecord.항시행일자) ?? effectiveFrom;
    const paragraphEffectiveTo = normalizeDate(paragraphRecord.항종료일자) ?? effectiveTo;
    const paragraphRepealedAt = normalizeDate(paragraphRecord.항삭제일자) ?? repealedAt;
    const normalizedParagraphNo = paragraphNo || null;
    const paragraphEntries: OpenLawArticle[] = [];

    if (paragraphNo && paragraphBody) {
      paragraphEntries.push({
        articleNo,
        paragraph: normalizedParagraphNo,
        item: null,
        kind: "paragraph",
        title,
        body: paragraphBody,
        effectiveFrom: paragraphEffectiveFrom,
        effectiveTo: paragraphEffectiveTo,
        repealedAt: paragraphRepealedAt,
        articlePath: `${articleNo}/paragraph:${paragraphNo}`
      });
    }

    const items: OpenLawArticle[] = [];

    for (const itemNode of asArray(paragraphRecord.호)) {
        const itemRecord = itemNode as Record<string, unknown>;
        const itemNo = normalizeOrdinal(itemRecord.호번호);
        const itemBody = readText(itemRecord.호내용);

        if (!itemNo || !itemBody) {
          continue;
        }

        items.push({
          articleNo,
          paragraph: normalizedParagraphNo,
          item: itemNo,
          kind: "item" as const,
          title,
          body: itemBody,
          effectiveFrom: normalizeDate(itemRecord.호시행일자) ?? paragraphEffectiveFrom,
          effectiveTo: normalizeDate(itemRecord.호종료일자) ?? paragraphEffectiveTo,
          repealedAt: normalizeDate(itemRecord.호삭제일자) ?? paragraphRepealedAt,
          articlePath: `${articleNo}/paragraph:${paragraphNo ?? "none"}/item:${itemNo}`
        });
    }

    return [...paragraphEntries, ...items];
  });

  return [article, ...paragraphs];
}

export function parseSearchResponse(xml: string): SearchLawResult[] {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const searchRoot = (parsed.LawSearch as Record<string, unknown> | undefined) ?? parsed;
  const laws = asArray(searchRoot.law);

  return laws.map((lawNode) => {
    const law = lawNode as Record<string, unknown>;

    return {
      mst: readText(law.법령일련번호) || null,
      lawId: readText(law.법령ID) || null,
      title: readText(law.법령명한글),
      promulgationDate: normalizeDate(law.공포일자),
      enforcementDate: normalizeDate(law.시행일자)
    };
  });
}

export function parseLawDetail(xml: string): ParsedLawDetail {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const detailRoot = (parsed["법령"] as Record<string, unknown> | undefined) ?? parsed;
  const basicInfo = (detailRoot["기본정보"] as Record<string, unknown> | undefined) ?? {};
  const law = {
    mst: null,
    lawId: readText(basicInfo["법령ID"]) || null,
    title: readText(basicInfo["법령명_한글"]),
    shortTitle: readText(basicInfo["법령명약칭"]) || null,
    promulgationDate: normalizeDate(basicInfo["공포일자"]),
    enforcementDate: normalizeDate(basicInfo["시행일자"]),
    sourceUrl: null
  } satisfies OpenLawLawDocument;
  const articleNodes = asArray((detailRoot["조문"] as Record<string, unknown> | undefined)?.["조문단위"]);
  const articles = articleNodes.flatMap((articleNode) => parseArticleNode(articleNode as Record<string, unknown>));
  const appendixContainers = asArray(detailRoot["별표"]);
  const appendices = appendixContainers.flatMap((containerNode) =>
    asArray((containerNode as Record<string, unknown>)["별표단위"]).map((appendixNode) => {
      const appendix = appendixNode as Record<string, unknown>;
      const label = formatAppendixLabel(appendix["별표번호"], appendix["별표가지번호"]);

      return {
        label,
        title: readText(appendix["별표제목"]),
        body: readText(appendix["별표내용"]),
        effectiveFrom: law.enforcementDate,
        effectiveTo: null,
        articlePath: `appendix:${label}`,
        kind: "appendix"
      } satisfies OpenLawAppendix;
    })
  );

  return {
    law,
    articles,
    appendices
  };
}
