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

function parseArticleNode(node: Record<string, unknown>): OpenLawArticle[] {
  const articleNo = readText(node.articleNo);
  const title = readText(node.title) || null;
  const body = readText(node.body);
  const effectiveFrom = readText(node.effectiveFrom) || null;
  const effectiveTo = readText(node.effectiveTo) || null;
  const repealedAt = readText(node.repealedAt) || null;

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

  const paragraphs = asArray(node.paragraphs && (node.paragraphs as Record<string, unknown>).paragraph).flatMap(
    (paragraphNode) => {
      const paragraphRecord = paragraphNode as Record<string, unknown>;
      const paragraphNo = readText(paragraphRecord.paragraphNo) || null;
      const paragraphBody = readText(paragraphRecord.body);
      const paragraphEffectiveFrom = readText(paragraphRecord.effectiveFrom) || effectiveFrom;
      const paragraphEffectiveTo = readText(paragraphRecord.effectiveTo) || effectiveTo;
      const paragraphRepealedAt = readText(paragraphRecord.repealedAt) || repealedAt;

      const paragraph: OpenLawArticle = {
        articleNo,
        paragraph: paragraphNo,
        item: null,
        kind: "paragraph",
        title,
        body: paragraphBody,
        effectiveFrom: paragraphEffectiveFrom,
        effectiveTo: paragraphEffectiveTo,
        repealedAt: paragraphRepealedAt,
        articlePath: `${articleNo}/paragraph:${paragraphNo}`
      };

      const items = asArray(
        paragraphRecord.items && (paragraphRecord.items as Record<string, unknown>).item
      ).map((itemNode) => {
        const itemRecord = itemNode as Record<string, unknown>;
        const itemNo = readText(itemRecord.itemNo) || null;

        return {
          articleNo,
          paragraph: paragraphNo,
          item: itemNo,
          kind: "item" as const,
          title,
          body: readText(itemRecord.body),
          effectiveFrom: readText(itemRecord.effectiveFrom) || paragraphEffectiveFrom,
          effectiveTo: readText(itemRecord.effectiveTo) || paragraphEffectiveTo,
          repealedAt: readText(itemRecord.repealedAt) || paragraphRepealedAt,
          articlePath: `${articleNo}/paragraph:${paragraphNo}/item:${itemNo}`
        };
      });

      return [paragraph, ...items];
    }
  );

  return [article, ...paragraphs];
}

export function parseSearchResponse(xml: string): SearchLawResult[] {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const searchRoot =
    (parsed.LawSearchResponse as Record<string, unknown> | undefined) ??
    (parsed.response as Record<string, unknown> | undefined) ??
    parsed;
  const laws = asArray(
    (searchRoot.laws as Record<string, unknown> | undefined)?.law ?? searchRoot.law
  );

  return laws.map((lawNode) => {
    const law = lawNode as Record<string, unknown>;

    return {
      mst: readText(law.mst) || null,
      lawId: readText(law.lawId) || null,
      title: readText(law.title),
      promulgationDate: readText(law.promulgationDate) || null,
      enforcementDate: readText(law.enforcementDate) || null
    };
  });
}

export function parseLawDetail(xml: string): ParsedLawDetail {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const detailRoot =
    (parsed.LawDetailResponse as Record<string, unknown> | undefined) ??
    (parsed.response as Record<string, unknown> | undefined) ??
    parsed;
  const lawNode = (detailRoot.law as Record<string, unknown> | undefined) ?? {};
  const articles = asArray(
    (detailRoot.articles as Record<string, unknown> | undefined)?.article
  ).flatMap((articleNode) => parseArticleNode(articleNode as Record<string, unknown>));
  const appendices = asArray(
    (detailRoot.appendices as Record<string, unknown> | undefined)?.appendix
  ).map((appendixNode) => {
    const appendix = appendixNode as Record<string, unknown>;
    const label = readText(appendix.label);

    return {
      label,
      title: readText(appendix.title),
      body: readText(appendix.body),
      effectiveFrom: readText(appendix.effectiveFrom) || null,
      effectiveTo: readText(appendix.effectiveTo) || null,
      articlePath: `appendix:${label}`,
      kind: "appendix"
    } satisfies OpenLawAppendix;
  });

  return {
    law: {
      mst: readText(lawNode.mst) || null,
      lawId: readText(lawNode.lawId) || null,
      title: readText(lawNode.title),
      shortTitle: readText(lawNode.shortTitle) || null,
      promulgationDate: readText(lawNode.promulgationDate) || null,
      enforcementDate: readText(lawNode.enforcementDate) || null,
      sourceUrl: readText(lawNode.sourceUrl) || null
    } satisfies OpenLawLawDocument,
    articles,
    appendices
  };
}
