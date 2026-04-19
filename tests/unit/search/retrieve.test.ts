import { describe, expect, test, vi } from "vitest";

import { createInMemoryStorage } from "@/lib/search/in-memory-storage";
import { retrieve } from "@/lib/search/retrieve";

import { loadFixtureArticles } from "./fixture-data";

describe("retrieve", () => {
  test("returns ranked targeted-cache candidates with one hydrate batch", async () => {
    const storage = createInMemoryStorage(loadFixtureArticles());
    const hydrateSpy = vi.spyOn(storage, "hydrateArticles");

    const result = await retrieve(storage, {
      query: "산안법 시행규칙 제4조 협조 요청",
      referenceDate: "2026-01-01",
      snapshotHashes: ["snap-sanan-5"]
    });

    expect(result.strategy).toBe("targeted_cache");
    expect(result.emitted_disagreement_capable).toBe(true);
    expect(result.weak).toBe("strong");
    expect(result.candidates[0]).toMatchObject({
      law_title: "산업안전보건법 시행규칙",
      article_no: "제4조",
      article_id: "sanan-5"
    });
    expect(result.candidates[0].score_components.cache_match).toBe(0.2);
    expect(hydrateSpy).toHaveBeenCalledTimes(1);
  });

  test("boosts appendix hits for 별표 lookups", async () => {
    const storage = createInMemoryStorage(loadFixtureArticles());

    const result = await retrieve(storage, {
      query: "별표 1 건설업체 산업재해발생률",
      referenceDate: "2026-01-01"
    });

    expect(result.candidates[0]).toMatchObject({
      kind: "appendix",
      article_no: "별표 1"
    });
    expect(result.candidates[0].score_components.appendix_boost).toBe(0.15);
  });
});
