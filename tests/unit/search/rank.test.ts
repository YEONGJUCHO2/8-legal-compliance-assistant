import { describe, expect, test } from "vitest";

import { rankCandidates } from "@/lib/search/rank";
import type { ArticleCandidate } from "@/lib/search/storage";

const baseCandidate: ArticleCandidate = {
  articleId: "article-1",
  articleVersionId: "article-1-v1",
  lawId: "law-1",
  lawTitle: "산업안전보건법",
  articleNo: "제10조",
  paragraph: "1",
  item: "1",
  kind: "item",
  body: "사업주는 필요한 안전조치를 하여야 한다.",
  snippet: "사업주는 필요한 안전조치를 하여야 한다.",
  effectiveFrom: "2024-01-01",
  effectiveTo: null,
  repealedAt: null,
  snapshotHash: "snap-1",
  sourceHash: "source-1",
  lexicalHits: 2,
  lexicalTokenCount: 2,
  matchedFromSnapshot: true
};

describe("rankCandidates", () => {
  test("assigns score components and caps the merged score at 1.0", () => {
    const ranked = rankCandidates(
      ["안전조치", "산업안전보건법"],
      [
        {
          kind: "article",
          articleNo: "제10조",
          paragraph: "1",
          item: "1"
        }
      ],
      [baseCandidate],
      { referenceDate: "2025-01-01" }
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0].score_components).toMatchObject({
      lexical: 1,
      article_number: 0.9,
      cache_match: 0.2,
      effective_date_boost: 0.1
    });
    expect(ranked[0].score).toBe(1);
  });

  test("deduplicates the same article and keeps the highest score", () => {
    const ranked = rankCandidates(
      ["안전조치"],
      [
        {
          kind: "article",
          articleNo: "제10조",
          paragraph: null,
          item: null
        }
      ],
      [
        {
          ...baseCandidate,
          paragraph: null,
          item: null,
          lexicalHits: 1,
          lexicalTokenCount: 1
        },
        baseCandidate
      ],
      { referenceDate: "2025-01-01" }
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0].paragraph).toBe("1");
    expect(ranked[0].score_components.article_number).toBe(0.9);
  });
});
