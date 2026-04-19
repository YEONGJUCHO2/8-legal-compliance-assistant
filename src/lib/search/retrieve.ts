import { filterByEffectiveDate } from "@/lib/search/filter";
import { normalizeQuery } from "@/lib/search/normalize-query";
import { rankCandidates } from "@/lib/search/rank";
import type { ArticleCandidate, LawStorage } from "@/lib/search/storage";
import type { ArticleNumberHint, RetrievalResult, WeakEvidenceSignal } from "@/lib/search/types";
import { detectWeakEvidence } from "@/lib/search/weak-evidence";

function mergeCandidates(candidates: ArticleCandidate[]) {
  const byKey = new Map<string, ArticleCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.articleId}:${candidate.articleVersionId}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { ...candidate });
      continue;
    }

    byKey.set(key, {
      ...existing,
      lexicalHits: Math.max(existing.lexicalHits ?? 0, candidate.lexicalHits ?? 0) || undefined,
      lexicalTokenCount: Math.max(existing.lexicalTokenCount ?? 0, candidate.lexicalTokenCount ?? 0) || undefined,
      matchedFromSnapshot: existing.matchedFromSnapshot || candidate.matchedFromSnapshot
    });
  }

  return [...byKey.values()];
}

export async function retrieve(
  storage: LawStorage,
  {
    query,
    referenceDate,
    limit = 10,
    snapshotHashes = [],
    queryHints
  }: {
    query: string;
    referenceDate: string;
    limit?: number;
    snapshotHashes?: string[];
    queryHints?: {
      tokens: string[];
      lawHints: string[];
      articleNumberHints: ArticleNumberHint[];
    };
  }
): Promise<RetrievalResult & { weak: WeakEvidenceSignal }> {
  const normalizedBase = normalizeQuery(query);
  const normalized = queryHints
    ? {
        ...normalizedBase,
        tokens: queryHints.tokens,
        lawHints: queryHints.lawHints,
        articleNumberHints: queryHints.articleNumberHints
      }
    : normalizedBase;

  const [lexicalCandidates, numberCandidateGroups, snapshotCandidates] = await Promise.all([
    storage.findArticlesByLexical(normalized.tokens, {
      referenceDate,
      limit: Math.max(limit * 3, 15)
    }),
    Promise.all(
      normalized.articleNumberHints.map((hint) =>
        storage.findArticlesByNumber(
          normalized.lawHints[0] ?? null,
          hint.kind === "appendix" ? hint.label : hint.articleNo,
          { referenceDate }
        )
      )
    ),
    storage.findFromSnapshotCache(snapshotHashes, { referenceDate })
  ]);

  const merged = mergeCandidates([
    ...lexicalCandidates,
    ...numberCandidateGroups.flat(),
    ...snapshotCandidates
  ]);
  const hydrated = await storage.hydrateArticles(Array.from(new Set(merged.map((candidate) => candidate.articleId))));
  const hydratedById = new Map(hydrated.map((article) => [article.articleId, article]));
  const hydratedCandidates = merged.map((candidate) => ({
    ...(hydratedById.get(candidate.articleId) ?? candidate),
    ...candidate
  }));
  const filtered = filterByEffectiveDate(hydratedCandidates, referenceDate);
  const ranked = rankCandidates(normalized.tokens, normalized.articleNumberHints, filtered, {
    referenceDate
  }).slice(0, limit);

  const result: RetrievalResult = {
    candidates: ranked,
    strategy: "targeted_cache",
    emitted_disagreement_capable: true
  };

  return {
    ...result,
    weak: detectWeakEvidence(result)
  };
}
