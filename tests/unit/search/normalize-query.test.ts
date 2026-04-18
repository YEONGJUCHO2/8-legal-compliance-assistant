import { describe, expect, test } from "vitest";

import { normalizeQuery } from "@/lib/search/normalize-query";

describe("normalizeQuery", () => {
  test("expands aliases and extracts article / paragraph / item hints", () => {
    const normalized = normalizeQuery("산안법 제10조 제1항 제1호 안전조치");

    expect(normalized.lawHints).toContain("산업안전보건법");
    expect(normalized.tokens).toContain("산업안전보건법");
    expect(normalized.tokens).toContain("안전조치");
    expect(normalized.articleNumberHints).toEqual([
      {
        kind: "article",
        articleNo: "제10조",
        paragraph: "1",
        item: "1"
      }
    ]);
  });

  test("extracts appendix hints for 별표 lookups", () => {
    const normalized = normalizeQuery("안전보건기준 별표 1 프레스");

    expect(normalized.lawHints).toContain("산업안전보건기준에 관한 규칙");
    expect(normalized.articleNumberHints).toContainEqual({
      kind: "appendix",
      label: "별표 1"
    });
  });
});
