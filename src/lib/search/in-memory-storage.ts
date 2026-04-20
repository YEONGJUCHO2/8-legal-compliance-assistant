import { normalizeTitle, resolveAlias } from "@/lib/open-law/normalize";
import {
  mergeArticleBodyFragments,
  type ArticleCandidate,
  type ArticleRecord,
  type LawStorage
} from "@/lib/search/storage";

function normalizeSearchText(value: string) {
  return normalizeTitle(value).toLowerCase();
}

function cloneCandidate(record: ArticleRecord, overrides?: Partial<ArticleCandidate>): ArticleCandidate {
  return {
    articleId: record.articleId,
    articleVersionId: record.articleVersionId,
    lawId: record.lawId,
    lawTitle: record.lawTitle,
    articleNo: record.articleNo,
    paragraph: record.paragraph,
    item: record.item,
    kind: record.kind,
    body: record.body,
    snippet: record.snippet,
    effectiveFrom: record.effectiveFrom,
    effectiveTo: record.effectiveTo,
    repealedAt: record.repealedAt,
    snapshotHash: record.snapshotHash,
    sourceHash: record.sourceHash,
    ...overrides
  };
}

export function createInMemoryStorage(articles: ArticleRecord[]): LawStorage {
  const articleMap = new Map(articles.map((article) => [article.articleId, article]));

  return {
    async findArticlesByLexical(queryTokens, { limit }) {
      const normalizedTokens = queryTokens.map((token) => normalizeSearchText(token));

      return articles
        .map((article) => {
          const haystack = normalizeSearchText(
            [article.lawTitle, article.title ?? "", article.articleNo, article.body].join(" ")
          );
          const tokenHits = normalizedTokens.filter((token) => haystack.includes(token)).length;

          if (tokenHits === 0) {
            return null;
          }

          return cloneCandidate(article, {
            lexicalHits: tokenHits,
            lexicalTokenCount: normalizedTokens.length
          });
        })
        .filter((candidate): candidate is ArticleCandidate => candidate !== null)
        .sort((left, right) => (right.lexicalHits ?? 0) - (left.lexicalHits ?? 0))
        .slice(0, limit);
    },
    async findArticlesByNumber(lawHint, articleNo) {
      const canonicalLawHint = lawHint ? resolveAlias(lawHint) : null;

      return articles
        .filter((article) => {
          const lawMatches = canonicalLawHint
            ? normalizeSearchText(article.lawTitle).includes(normalizeSearchText(canonicalLawHint))
            : true;

          return lawMatches && article.articleNo === articleNo;
        })
        .map((article) => cloneCandidate(article));
    },
    async findFromSnapshotCache(snapshotHashes) {
      if (snapshotHashes.length === 0) {
        return [];
      }

      const snapshotHashSet = new Set(snapshotHashes);

      return articles
        .filter((article) => snapshotHashSet.has(article.snapshotHash))
        .map((article) =>
          cloneCandidate(article, {
            matchedFromSnapshot: true
          })
        );
    },
    async hydrateArticles(articleIds) {
      return articleIds
        .map((articleId) => articleMap.get(articleId))
        .filter((article): article is ArticleRecord => article !== undefined);
    },
    async loadFullArticleBody({ lawId, articleNo, referenceDate }) {
      return mergeArticleBodyFragments(
        articles
          .filter((article) => {
            const startsBeforeReference = article.effectiveFrom === null || article.effectiveFrom <= referenceDate;
            const endsAfterReference = article.effectiveTo === null || referenceDate <= article.effectiveTo;

            return article.lawId === lawId && article.articleNo === articleNo && startsBeforeReference && endsAfterReference;
          })
          .map((article) => ({
            kind: article.kind,
            paragraph: article.paragraph,
            item: article.item,
            body: article.body
          }))
      );
    }
  };
}
