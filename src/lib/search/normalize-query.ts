import { ALIAS_DICTIONARY, normalizeTitle } from "@/lib/open-law/normalize";
import type { ArticleNumberHint } from "@/lib/search/types";

export type NormalizedQuery = {
  raw: string;
  normalizedQuery: string;
  tokens: string[];
  lawHints: string[];
  articleNumberHints: ArticleNumberHint[];
};

export function tokenizeQuery(value: string) {
  return value
    .replace(/[,"'“”‘’!?()[\]{}]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function parseArticleNumberHints(value: string): ArticleNumberHint[] {
  const normalizedValue = normalizeTitle(value);
  const articleNumberHints: ArticleNumberHint[] = [];
  const articlePattern = /제\s*(\d+)조(?:\s*제\s*(\d+)항)?(?:\s*제\s*(\d+)호)?/g;
  for (const match of normalizedValue.matchAll(articlePattern)) {
    articleNumberHints.push({
      kind: "article",
      articleNo: `제${match[1]}조`,
      paragraph: match[2] ?? null,
      item: match[3] ?? null
    });
  }

  const appendixPattern = /(별표|별지)\s*(\d+)/g;
  for (const match of normalizedValue.matchAll(appendixPattern)) {
    articleNumberHints.push({
      kind: "appendix",
      label: `${match[1]} ${match[2]}`
    });
  }

  return articleNumberHints;
}

export function normalizeQuery(raw: string): NormalizedQuery {
  const normalizedQuery = normalizeTitle(raw);
  const lower = normalizedQuery.toLowerCase();
  const lawHints = Array.from(
    new Set(
      Object.entries(ALIAS_DICTIONARY)
        .filter(([alias]) => lower.includes(alias))
        .map(([, canonical]) => canonical)
    )
  );

  const articleNumberHints = parseArticleNumberHints(normalizedQuery);

  const tokens = Array.from(
    new Set([...tokenizeQuery(normalizedQuery), ...lawHints.flatMap((hint) => tokenizeQuery(hint))])
  );

  return {
    raw,
    normalizedQuery,
    tokens,
    lawHints,
    articleNumberHints
  };
}
