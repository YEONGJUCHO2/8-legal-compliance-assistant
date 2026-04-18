import { normalizeTitle } from "@/lib/open-law/normalize";
import { isInForce } from "@/lib/open-law/temporal";
import type { ArticleCandidate } from "@/lib/search/storage";
import type { ArticleNumberHint, RetrievalCandidate, ScoreComponents } from "@/lib/search/types";

function buildLexicalScore(tokens: string[], candidate: ArticleCandidate) {
  if (tokens.length === 0) {
    return 0;
  }

  if (
    candidate.lexicalHits !== undefined &&
    candidate.lexicalTokenCount !== undefined &&
    candidate.lexicalTokenCount > 0
  ) {
    return candidate.lexicalHits / candidate.lexicalTokenCount;
  }

  const haystack = normalizeTitle(
    [candidate.lawTitle, candidate.articleNo, candidate.body, candidate.snippet].join(" ")
  ).toLowerCase();
  const hitCount = tokens.filter((token) => haystack.includes(normalizeTitle(token).toLowerCase())).length;

  return hitCount / tokens.length;
}

function buildArticleNumberScore(hints: ArticleNumberHint[], candidate: ArticleCandidate) {
  let articleNumber = 0;
  let appendixBoost = 0;

  for (const hint of hints) {
    if (hint.kind === "appendix") {
      if (candidate.kind === "appendix" && candidate.articleNo === hint.label) {
        appendixBoost = Math.max(appendixBoost, 0.15);
      }
      continue;
    }

    if (candidate.articleNo !== hint.articleNo) {
      continue;
    }

    const exactMatch =
      (hint.paragraph ?? null) === (candidate.paragraph ?? null) && (hint.item ?? null) === (candidate.item ?? null);

    articleNumber = Math.max(articleNumber, exactMatch ? 0.9 : 0.5);
  }

  return { articleNumber, appendixBoost };
}

function scoreCandidate(tokens: string[], hints: ArticleNumberHint[], candidate: ArticleCandidate, referenceDate: string) {
  const lexical = buildLexicalScore(tokens, candidate);
  const { articleNumber, appendixBoost } = buildArticleNumberScore(hints, candidate);
  const cacheMatch = candidate.matchedFromSnapshot ? 0.2 : 0;
  const effectiveDateBoost = isInForce(candidate, referenceDate) ? 0.1 : 0;
  const scoreComponents: ScoreComponents = {
    lexical: lexical || undefined,
    article_number: articleNumber || undefined,
    cache_match: cacheMatch || undefined,
    appendix_boost: appendixBoost || undefined,
    effective_date_boost: effectiveDateBoost || undefined
  };
  const score = Math.min(1, lexical + articleNumber + cacheMatch + appendixBoost + effectiveDateBoost);

  return { score, scoreComponents };
}

export function rankCandidates(
  tokens: string[],
  articleNumberHints: ArticleNumberHint[],
  candidates: ArticleCandidate[],
  options: {
    referenceDate: string;
  }
): RetrievalCandidate[] {
  const byArticleId = new Map<string, RetrievalCandidate>();
  const mergeComponent = (left?: number, right?: number) =>
    left === undefined && right === undefined ? undefined : Math.max(left ?? 0, right ?? 0);

  for (const candidate of candidates) {
    const { score, scoreComponents } = scoreCandidate(
      tokens,
      articleNumberHints,
      candidate,
      options.referenceDate
    );

    const rankedCandidate: RetrievalCandidate = {
      article_id: candidate.articleId,
      article_version_id: candidate.articleVersionId,
      law_id: candidate.lawId,
      law_title: candidate.lawTitle,
      article_no: candidate.articleNo,
      paragraph: candidate.paragraph,
      item: candidate.item,
      kind: candidate.kind,
      body: candidate.body,
      snippet: candidate.snippet,
      effective_from: candidate.effectiveFrom,
      effective_to: candidate.effectiveTo,
      repealed_at: candidate.repealedAt,
      snapshot_hash: candidate.snapshotHash,
      source_hash: candidate.sourceHash,
      score,
      score_components: scoreComponents
    };

    const existing = byArticleId.get(candidate.articleId);
    if (!existing) {
      byArticleId.set(candidate.articleId, rankedCandidate);
      continue;
    }

    const mergedScoreComponents: ScoreComponents = {
      lexical: mergeComponent(existing.score_components.lexical, rankedCandidate.score_components.lexical),
      article_number: mergeComponent(
        existing.score_components.article_number,
        rankedCandidate.score_components.article_number
      ),
      cache_match: mergeComponent(existing.score_components.cache_match, rankedCandidate.score_components.cache_match),
      appendix_boost: mergeComponent(
        existing.score_components.appendix_boost,
        rankedCandidate.score_components.appendix_boost
      ),
      effective_date_boost: mergeComponent(
        existing.score_components.effective_date_boost,
        rankedCandidate.score_components.effective_date_boost
      )
    };

    const mergedScore = Math.min(
      1,
      (mergedScoreComponents.lexical ?? 0) +
        (mergedScoreComponents.article_number ?? 0) +
        (mergedScoreComponents.cache_match ?? 0) +
        (mergedScoreComponents.appendix_boost ?? 0) +
        (mergedScoreComponents.effective_date_boost ?? 0)
    );

    byArticleId.set(candidate.articleId, {
      ...existing,
      paragraph: existing.paragraph ?? rankedCandidate.paragraph,
      item: existing.item ?? rankedCandidate.item,
      kind: existing.kind === "article" && rankedCandidate.kind !== "article" ? rankedCandidate.kind : existing.kind,
      body: existing.body.length >= rankedCandidate.body.length ? existing.body : rankedCandidate.body,
      snippet:
        existing.snippet.length >= rankedCandidate.snippet.length ? existing.snippet : rankedCandidate.snippet,
      score_components: mergedScoreComponents,
      score: Math.max(existing.score, rankedCandidate.score, mergedScore)
    });
  }

  return [...byArticleId.values()].sort((left, right) => right.score - left.score);
}
