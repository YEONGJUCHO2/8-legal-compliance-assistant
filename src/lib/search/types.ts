import type { UUID } from "@/lib/db/rows";

export type ScoreComponents = {
  lexical?: number;
  article_number?: number;
  cache_match?: number;
  appendix_boost?: number;
  effective_date_boost?: number;
};

export type ArticleNumberHint =
  | {
      kind: "article";
      articleNo: string;
      paragraph: string | null;
      item: string | null;
    }
  | {
      kind: "appendix";
      label: string;
    };

export interface RetrievalCandidate {
  article_id: UUID;
  article_version_id: UUID;
  law_id: UUID;
  law_title: string;
  article_no: string;
  paragraph: string | null;
  item: string | null;
  kind: "article" | "paragraph" | "item" | "appendix";
  body: string;
  snippet: string;
  effective_from: string | null;
  effective_to: string | null;
  repealed_at: string | null;
  snapshot_hash: string;
  source_hash: string;
  score: number;
  score_components: ScoreComponents;
}

export interface RetrievalResult {
  candidates: RetrievalCandidate[];
  strategy: "targeted_cache";
  emitted_disagreement_capable: true;
}

export type WeakEvidenceSignal = "strong" | "empty" | "weak" | "ambiguous";

export type RetrievalEvalItem = {
  id: string;
  query: string;
  referenceDate: string;
  expectedLawTitle: string;
  expectedArticleNo: string;
};
