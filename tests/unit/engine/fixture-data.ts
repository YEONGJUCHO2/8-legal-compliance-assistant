import type { RetrievalResult } from "@/lib/search/types";

export function createFixtureRetrieval(): RetrievalResult & { weak: "strong" } {
  return {
    strategy: "targeted_cache",
    emitted_disagreement_capable: true,
    weak: "strong",
    candidates: [
      {
        article_id: "article-1",
        article_version_id: "article-version-1",
        law_id: "law-1",
        law_title: "산업안전보건법",
        article_no: "제10조",
        paragraph: null,
        item: null,
        kind: "article",
        body: "사업주는 근로자의 안전을 확보하기 위한 조치를 해야 한다.",
        snippet: "근로자의 안전을 확보하기 위한 조치",
        effective_from: "2024-01-01",
        effective_to: null,
        repealed_at: null,
        snapshot_hash: "snap-1",
        source_hash: "source-1",
        score: 0.91,
        score_components: {
          lexical: 0.61,
          article_number: 0.2,
          cache_match: 0.1
        }
      },
      {
        article_id: "article-2",
        article_version_id: "article-version-2",
        law_id: "law-2",
        law_title: "중대재해 처벌 등에 관한 법률",
        article_no: "제4조",
        paragraph: null,
        item: null,
        kind: "article",
        body: "사업주 또는 경영책임자는 안전보건 확보의무를 이행해야 한다.",
        snippet: "안전보건 확보의무",
        effective_from: "2024-01-01",
        effective_to: null,
        repealed_at: null,
        snapshot_hash: "snap-2",
        source_hash: "source-2",
        score: 0.77,
        score_components: {
          lexical: 0.47,
          article_number: 0.2,
          cache_match: 0.1
        }
      }
    ]
  };
}
