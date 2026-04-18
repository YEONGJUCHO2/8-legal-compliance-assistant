import type { UUID } from "@/lib/db/rows";

export interface ArticleCandidate {
  articleId: UUID;
  articleVersionId: UUID;
  lawId: UUID;
  lawTitle: string;
  articleNo: string;
  paragraph: string | null;
  item: string | null;
  kind: "article" | "paragraph" | "item" | "appendix";
  body: string;
  snippet: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  repealedAt: string | null;
  snapshotHash: string;
  sourceHash: string;
  lexicalHits?: number;
  lexicalTokenCount?: number;
  matchedFromSnapshot?: boolean;
}

export interface ArticleRecord extends ArticleCandidate {
  title?: string | null;
}

export interface LawStorage {
  findArticlesByLexical(
    queryTokens: string[],
    options: {
      referenceDate: string;
      limit: number;
    }
  ): Promise<ArticleCandidate[]>;
  findArticlesByNumber(
    lawHint: string | null,
    articleNo: string,
    options: {
      referenceDate: string;
    }
  ): Promise<ArticleCandidate[]>;
  findFromSnapshotCache(
    snapshotHashes: string[],
    options: {
      referenceDate: string;
    }
  ): Promise<ArticleCandidate[]>;
  hydrateArticles(articleIds: UUID[]): Promise<ArticleRecord[]>;
}
