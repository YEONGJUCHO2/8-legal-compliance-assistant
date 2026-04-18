import { describe, expect, test } from "vitest";

import { detectWeakEvidence } from "@/lib/search/weak-evidence";

describe("detectWeakEvidence", () => {
  test("returns empty when there are no candidates", () => {
    expect(
      detectWeakEvidence({
        candidates: [],
        strategy: "targeted_cache",
        emitted_disagreement_capable: true
      })
    ).toBe("empty");
  });

  test("returns weak when the top score is below threshold", () => {
    expect(
      detectWeakEvidence({
        candidates: [
          {
            article_id: "a1",
            article_version_id: "a1-v1",
            law_id: "law-1",
            law_title: "산업안전보건법",
            article_no: "제1조",
            paragraph: null,
            item: null,
            kind: "article",
            body: "본문",
            snapshot_hash: "snap-1",
            source_hash: "source-1",
            effective_from: "2024-01-01",
            effective_to: null,
            repealed_at: null,
            score: 0.3,
            score_components: { lexical: 0.3 },
            snippet: "본문"
          }
        ],
        strategy: "targeted_cache",
        emitted_disagreement_capable: true
      })
    ).toBe("weak");
  });

  test("returns ambiguous when close scores come from different laws", () => {
    expect(
      detectWeakEvidence({
        candidates: [
          {
            article_id: "a1",
            article_version_id: "a1-v1",
            law_id: "law-1",
            law_title: "산업안전보건법",
            article_no: "제1조",
            paragraph: null,
            item: null,
            kind: "article",
            body: "본문",
            snapshot_hash: "snap-1",
            source_hash: "source-1",
            effective_from: "2024-01-01",
            effective_to: null,
            repealed_at: null,
            score: 0.72,
            score_components: { lexical: 0.72 },
            snippet: "본문"
          },
          {
            article_id: "a2",
            article_version_id: "a2-v1",
            law_id: "law-2",
            law_title: "중대재해 처벌 등에 관한 법률",
            article_no: "제4조",
            paragraph: null,
            item: null,
            kind: "article",
            body: "본문",
            snapshot_hash: "snap-2",
            source_hash: "source-2",
            effective_from: "2024-01-01",
            effective_to: null,
            repealed_at: null,
            score: 0.68,
            score_components: { lexical: 0.68 },
            snippet: "본문"
          }
        ],
        strategy: "targeted_cache",
        emitted_disagreement_capable: true
      })
    ).toBe("ambiguous");
  });
});
