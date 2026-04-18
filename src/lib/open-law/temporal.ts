import { computeContentHash } from "@/lib/open-law/sanitize";

type TemporalArticle = {
  effectiveFrom?: string | null;
  effective_from?: string | null;
  effectiveTo?: string | null;
  effective_to?: string | null;
  repealedAt?: string | null;
  repealed_at?: string | null;
};

export type VersionedTemporalArticle = TemporalArticle & {
  id: string;
  body: string;
  contentHash: string;
  version: number;
};

export type VersionRolloverResult = {
  changed: boolean;
  nextArticle: VersionedTemporalArticle;
  newVersionRow: {
    articleId: string;
    version: number;
    body: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    repealedAt: string | null;
    contentHash: string;
    changeType: string;
  } | null;
};

function readDateField(article: TemporalArticle, camelKey: "effectiveFrom" | "effectiveTo" | "repealedAt") {
  const snakeKey = camelKey
    .replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`) as "effective_from" | "effective_to" | "repealed_at";

  return article[camelKey] ?? article[snakeKey] ?? null;
}

export function isInForce(article: TemporalArticle, referenceDate: string) {
  const effectiveFrom = readDateField(article, "effectiveFrom");
  const effectiveTo = readDateField(article, "effectiveTo");
  const repealedAt = readDateField(article, "repealedAt");

  const afterStart = effectiveFrom === null || effectiveFrom <= referenceDate;
  const beforeEnd = effectiveTo === null || referenceDate < effectiveTo;
  const beforeRepeal = repealedAt === null || repealedAt > referenceDate;

  return afterStart && beforeEnd && beforeRepeal;
}

export function isFutureEffective(article: TemporalArticle, referenceDate: string) {
  const effectiveFrom = readDateField(article, "effectiveFrom");
  return effectiveFrom !== null && referenceDate < effectiveFrom;
}

export function recordVersionRollover(
  article: VersionedTemporalArticle,
  newBody: string,
  options?: {
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
    repealedAt?: string | null;
  }
): VersionRolloverResult {
  const nextHash = computeContentHash(newBody);
  if (nextHash === article.contentHash) {
    return {
      changed: false,
      nextArticle: article,
      newVersionRow: null
    };
  }

  const nextEffectiveFrom = options?.effectiveFrom ?? readDateField(article, "effectiveFrom");
  const nextEffectiveTo = options?.effectiveTo ?? readDateField(article, "effectiveTo");
  const currentRepealedAt = readDateField(article, "repealedAt");
  const reinstated =
    currentRepealedAt !== null && nextEffectiveFrom !== null && currentRepealedAt <= nextEffectiveFrom;
  const nextRepealedAt = reinstated ? null : options?.repealedAt ?? currentRepealedAt;

  return {
    changed: true,
    nextArticle: {
      ...article,
      body: newBody,
      contentHash: nextHash,
      version: article.version + 1,
      effectiveFrom: nextEffectiveFrom,
      effectiveTo: nextEffectiveTo,
      repealedAt: nextRepealedAt
    },
    newVersionRow: {
      articleId: article.id,
      version: article.version + 1,
      body: newBody,
      effectiveFrom: nextEffectiveFrom,
      effectiveTo: nextEffectiveTo,
      repealedAt: nextRepealedAt,
      contentHash: nextHash,
      changeType: reinstated ? "reinstated" : "content_changed"
    }
  };
}
