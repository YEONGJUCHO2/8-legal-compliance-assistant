import { isInForce } from "@/lib/open-law/temporal";
import type { ArticleCandidate } from "@/lib/search/storage";

export function filterByEffectiveDate(candidates: ArticleCandidate[], referenceDate: string) {
  return candidates.filter((candidate) =>
    isInForce(
      {
        effectiveFrom: candidate.effectiveFrom,
        effectiveTo: candidate.effectiveTo,
        repealedAt: candidate.repealedAt
      },
      referenceDate
    )
  );
}
