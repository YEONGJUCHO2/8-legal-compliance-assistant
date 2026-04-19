import { getDb } from "@/lib/db/client";
import { resolveAlias } from "@/lib/open-law/normalize";
import type { LawStorage } from "@/lib/search/storage";

type ArticleRow = {
  article_id: string;
  article_version_id: string;
  law_id: string;
  law_title: string;
  article_no: string;
  paragraph: string | null;
  item: string | null;
  kind: "article" | "paragraph" | "item" | "appendix";
  title: string | null;
  body: string;
  effective_from: string | null;
  effective_to: string | null;
  repealed_at: string | null;
  snapshot_hash: string;
  source_hash: string;
};

const ARTICLE_SELECT = `
  SELECT
    la.id AS article_id,
    COALESCE(lav.id::text, la.id::text) AS article_version_id,
    COALESCE(ld.law_id, ld.id::text) AS law_id,
    ld.title AS law_title,
    la.article_no,
    la.paragraph,
    la.item,
    la.kind,
    la.title,
    COALESCE(lav.body, la.body) AS body,
    COALESCE(lav.effective_from, la.effective_from) AS effective_from,
    COALESCE(lav.effective_to, la.effective_to) AS effective_to,
    NULL::text AS repealed_at,
    ld.snapshot_hash,
    ld.snapshot_hash AS source_hash
`;

const ARTICLE_FROM = `
  FROM law_articles la
  JOIN law_documents ld
    ON ld.id = la.law_id
  LEFT JOIN LATERAL (
    SELECT id, body, effective_from, effective_to
    FROM law_article_versions
    WHERE article_id = la.id
    ORDER BY effective_from DESC NULLS LAST, id DESC
    LIMIT 1
  ) lav ON true
`;

function normalizeSearchText(value: string) {
  return value.normalize("NFKC").toLowerCase();
}

function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function mapArticle(row: ArticleRow) {
  return {
    articleId: row.article_id,
    articleVersionId: row.article_version_id,
    lawId: row.law_id,
    lawTitle: row.law_title,
    articleNo: row.article_no,
    paragraph: row.paragraph,
    item: row.item,
    kind: row.kind,
    title: row.title,
    body: row.body,
    snippet: row.body.slice(0, 120),
    effectiveFrom: toIsoDate(row.effective_from),
    effectiveTo: toIsoDate(row.effective_to),
    repealedAt: toIsoDate(row.repealed_at),
    snapshotHash: row.snapshot_hash,
    sourceHash: row.source_hash
  };
}

export function createDbLawStorage(): LawStorage {
  const db = getDb();

  return {
    async findArticlesByLexical(queryTokens, { referenceDate: _referenceDate, limit }) {
      const normalizedTokens = queryTokens.map((token) => normalizeSearchText(token)).filter(Boolean);

      if (normalizedTokens.length === 0) {
        return [];
      }

      const likeParams = normalizedTokens.map((token) => `%${token}%`);
      const similarityIndex = likeParams.length + 1;
      const limitIndex = likeParams.length + 2;
      const tokenConditions = likeParams
        .map(
          (_token, index) =>
            `unaccent(lower(concat_ws(' ', ld.title, COALESCE(la.title, ''), la.article_no, COALESCE(lav.body, la.body)))) LIKE unaccent(lower($${index + 1}))`
        )
        .join(" OR ");
      const rows = await db.unsafe<ArticleRow[]>(
        `
          ${ARTICLE_SELECT},
          similarity(
            unaccent(lower(concat_ws(' ', ld.title, COALESCE(la.title, ''), la.article_no, COALESCE(lav.body, la.body)))),
            unaccent(lower($${similarityIndex}))
          ) AS lexical_similarity
          ${ARTICLE_FROM}
          WHERE (${tokenConditions})
          ORDER BY lexical_similarity DESC, la.article_no ASC
          LIMIT $${limitIndex}
        `,
        [...likeParams, normalizedTokens.join(" "), limit]
      );

      return rows
        .map((row) => {
          const article = mapArticle(row);
          const haystack = normalizeSearchText(
            [article.lawTitle, article.title ?? "", article.articleNo, article.body].join(" ")
          );
          const tokenHits = normalizedTokens.filter((token) => haystack.includes(token)).length;

          if (tokenHits === 0) {
            return null;
          }

          return {
            ...article,
            lexicalHits: tokenHits,
            lexicalTokenCount: normalizedTokens.length
          };
        })
        .filter((article): article is NonNullable<typeof article> => article !== null);
    },
    async findArticlesByNumber(lawHint, articleNo, { referenceDate: _referenceDate }) {
      const canonicalLawHint = lawHint ? resolveAlias(lawHint) : null;
      const params: string[] = [articleNo];
      const lawClause = canonicalLawHint
        ? `
            AND (
              unaccent(lower(ld.title)) LIKE unaccent(lower($2))
              OR unaccent(lower(COALESCE(ld.short_title, ''))) LIKE unaccent(lower($2))
              OR ld.law_id = $3
            )
          `
        : "";

      if (canonicalLawHint) {
        params.push(`%${normalizeSearchText(canonicalLawHint)}%`, canonicalLawHint);
      }

      const rows = await db.unsafe<ArticleRow[]>(
        `
          ${ARTICLE_SELECT}
          ${ARTICLE_FROM}
          WHERE la.article_no = $1
          ${lawClause}
          ORDER BY la.article_no ASC, la.paragraph ASC NULLS FIRST, la.item ASC NULLS FIRST
        `,
        params
      );

      return rows.map((row) => mapArticle(row));
    },
    async findFromSnapshotCache(snapshotHashes, { referenceDate: _referenceDate }) {
      if (snapshotHashes.length === 0) {
        return [];
      }

      const rows = await db.unsafe<ArticleRow[]>(
        `
          ${ARTICLE_SELECT}
          ${ARTICLE_FROM}
          WHERE ld.snapshot_hash = ANY($1::text[])
          ORDER BY ld.snapshot_hash ASC, la.article_no ASC
        `,
        [snapshotHashes]
      );

      return rows.map((row) => ({
        ...mapArticle(row),
        matchedFromSnapshot: true
      }));
    },
    async hydrateArticles(articleIds) {
      if (articleIds.length === 0) {
        return [];
      }

      const rows = await db.unsafe<ArticleRow[]>(
        `
          ${ARTICLE_SELECT}
          ${ARTICLE_FROM}
          WHERE la.id = ANY($1::uuid[])
        `,
        [articleIds]
      );
      const byId = new Map(rows.map((row) => [row.article_id, mapArticle(row)]));

      return articleIds
        .map((articleId) => byId.get(articleId))
        .filter((article): article is NonNullable<typeof article> => article !== undefined);
    }
  };
}
