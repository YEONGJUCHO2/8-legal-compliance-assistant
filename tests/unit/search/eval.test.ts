import { describe, expect, test } from "vitest";

import { runRetrievalEval } from "@/lib/search/eval";
import { createInMemoryStorage } from "@/lib/search/in-memory-storage";

import { loadFixtureArticles, SEARCH_GOLD_SET } from "./fixture-data";

describe("runRetrievalEval", () => {
  test("calculates top1, top3, and wrong-law-in-top3 metrics", async () => {
    const storage = createInMemoryStorage(loadFixtureArticles());

    const result = await runRetrievalEval(storage, [
      ...SEARCH_GOLD_SET,
      {
        id: "q4",
        query: "안전조치",
        referenceDate: "2025-01-01",
        expectedLawTitle: "중대재해 처벌 등에 관한 법률",
        expectedArticleNo: "제4조"
      }
    ]);

    expect(result.top1).toBe(0.75);
    expect(result.top3).toBe(0.75);
    expect(result.wrongLawInTop3).toBe(0.25);
    expect(result.perItem.find((item) => item.id === "q4")).toMatchObject({
      wrongLawInTop3: true
    });
  });
});
