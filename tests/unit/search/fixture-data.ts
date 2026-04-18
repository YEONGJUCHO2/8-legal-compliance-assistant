import { readFileSync } from "node:fs";
import path from "node:path";

import { computeContentHash, computeSourceHash, sanitizeLawText } from "@/lib/open-law/sanitize";
import { parseLawDetail } from "@/lib/open-law/xml";
import type { ArticleRecord } from "@/lib/search/storage";

const fixturesDir = path.join(process.cwd(), "tests", "fixtures", "open-law");

export function loadFixtureArticles(): ArticleRecord[] {
  const sanAnXml = readFileSync(path.join(fixturesDir, "san-an-detail.xml"), "utf8");
  const detail = parseLawDetail(sanAnXml);
  const sourceHash = computeSourceHash(sanAnXml);

  const lawArticles = [
    ...detail.articles.map((article, index) => ({
      articleId: `sanan-${index + 1}`,
      articleVersionId: `sanan-${index + 1}-v1`,
      lawId: "law-sanan",
      lawTitle: detail.law.title,
      articleNo: article.articleNo,
      paragraph: article.paragraph,
      item: article.item,
      kind: article.kind,
      body: sanitizeLawText(article.body),
      title: article.title,
      snippet: sanitizeLawText(article.body).slice(0, 80),
      effectiveFrom: article.effectiveFrom,
      effectiveTo: article.effectiveTo,
      repealedAt: article.repealedAt,
      snapshotHash: `snap-sanan-${index + 1}`,
      sourceHash
    })),
    ...detail.appendices.map((appendix, index) => ({
      articleId: `sanan-appendix-${index + 1}`,
      articleVersionId: `sanan-appendix-${index + 1}-v1`,
      lawId: "law-sanan",
      lawTitle: detail.law.title,
      articleNo: appendix.label,
      paragraph: null,
      item: null,
      kind: appendix.kind,
      body: sanitizeLawText(appendix.body),
      title: appendix.title,
      snippet: sanitizeLawText(appendix.body).slice(0, 80),
      effectiveFrom: appendix.effectiveFrom,
      effectiveTo: appendix.effectiveTo,
      repealedAt: null,
      snapshotHash: `snap-sanan-appendix-${index + 1}`,
      sourceHash
    }))
  ];

  const middleLawArticle: ArticleRecord = {
    articleId: "sapa-1",
    articleVersionId: "sapa-1-v1",
    lawId: "law-sapa",
    lawTitle: "중대재해 처벌 등에 관한 법률",
    articleNo: "제4조",
    paragraph: null,
    item: null,
    kind: "article",
    body: "경영책임자는 안전 및 보건 확보의무를 이행하여야 한다.",
    title: "사업주와 경영책임자등의 안전 및 보건 확보의무",
    snippet: "경영책임자는 안전 및 보건 확보의무를 이행하여야 한다.",
    effectiveFrom: "2022-01-27",
    effectiveTo: null,
    repealedAt: null,
    snapshotHash: "snap-sapa-1",
    sourceHash: computeContentHash("중대재해 처벌 등에 관한 법률 제4조")
  };

  return [...lawArticles, middleLawArticle];
}

export const SEARCH_GOLD_SET = [
  {
    id: "q1",
    query: "산안법 제10조 안전조치",
    referenceDate: "2025-01-01",
    expectedLawTitle: "산업안전보건법",
    expectedArticleNo: "제10조"
  },
  {
    id: "q2",
    query: "별표 1 프레스",
    referenceDate: "2025-01-01",
    expectedLawTitle: "산업안전보건법",
    expectedArticleNo: "별표 1"
  },
  {
    id: "q3",
    query: "중처법 경영책임자 의무",
    referenceDate: "2025-01-01",
    expectedLawTitle: "중대재해 처벌 등에 관한 법률",
    expectedArticleNo: "제4조"
  }
] as const;
