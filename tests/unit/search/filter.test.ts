import { describe, expect, test } from "vitest";

import { filterByEffectiveDate } from "@/lib/search/filter";
import type { ArticleCandidate } from "@/lib/search/storage";

const candidates: ArticleCandidate[] = [
  {
    articleId: "current",
    articleVersionId: "current-v1",
    lawId: "law-1",
    lawTitle: "산업안전보건법",
    articleNo: "제1조",
    paragraph: null,
    item: null,
    kind: "article",
    body: "현재 시행 중",
    snippet: "현재 시행 중",
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    repealedAt: null,
    snapshotHash: "snap-current",
    sourceHash: "source-current"
  },
  {
    articleId: "future",
    articleVersionId: "future-v1",
    lawId: "law-1",
    lawTitle: "산업안전보건법",
    articleNo: "제2조",
    paragraph: null,
    item: null,
    kind: "article",
    body: "미래 시행",
    snippet: "미래 시행",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    repealedAt: null,
    snapshotHash: "snap-future",
    sourceHash: "source-future"
  }
];

describe("filterByEffectiveDate", () => {
  test("keeps only articles in force for the requested date", () => {
    const filtered = filterByEffectiveDate(candidates, "2025-01-01");

    expect(filtered.map((candidate) => candidate.articleId)).toEqual(["current"]);
  });
});
