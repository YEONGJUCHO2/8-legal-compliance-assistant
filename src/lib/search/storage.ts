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

export interface ArticleBodyFragment {
  kind: "article" | "paragraph" | "item" | "appendix";
  paragraph: string | null;
  item: string | null;
  body: string;
}

const ARTICLE_KIND_ORDER: Record<ArticleBodyFragment["kind"], number> = {
  article: 0,
  paragraph: 1,
  item: 2,
  appendix: 3
};

function kindGroup(kind: ArticleBodyFragment["kind"]) {
  if (kind === "article") {
    return 0;
  }

  if (kind === "appendix") {
    return 2;
  }

  return 1;
}

function compareNullableOrder(left: string | null, right: string | null) {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return -1;
  }

  if (right === null) {
    return 1;
  }

  return left.localeCompare(right, "ko-KR", {
    numeric: true
  });
}

export function mergeArticleBodyFragments(fragments: ArticleBodyFragment[]): string | null {
  const seen = new Set<string>();
  const parts = [...fragments]
    .sort((left, right) => {
      const groupOrder = kindGroup(left.kind) - kindGroup(right.kind);

      if (groupOrder !== 0) {
        return groupOrder;
      }

      const paragraphOrder = compareNullableOrder(left.paragraph, right.paragraph);

      if (paragraphOrder !== 0) {
        return paragraphOrder;
      }

      const kindOrder = ARTICLE_KIND_ORDER[left.kind] - ARTICLE_KIND_ORDER[right.kind];

      if (kindOrder !== 0) {
        return kindOrder;
      }

      return compareNullableOrder(left.item, right.item);
    })
    .flatMap((fragment) => {
      const key = [fragment.kind, fragment.paragraph ?? "", fragment.item ?? ""].join("|");
      const normalizedBody = fragment.body.trim();

      if (!normalizedBody || seen.has(key)) {
        return [];
      }

      seen.add(key);
      return [normalizedBody];
    });

  return parts.length > 0 ? parts.join("\n\n") : null;
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
  loadFullArticleBody(input: {
    lawId: string;
    articleNo: string;
    referenceDate: string;
  }): Promise<string | null>;
}
