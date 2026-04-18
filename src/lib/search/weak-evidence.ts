import type { RetrievalResult, WeakEvidenceSignal } from "@/lib/search/types";

export function detectWeakEvidence(result: RetrievalResult): WeakEvidenceSignal {
  if (result.candidates.length === 0) {
    return "empty";
  }

  const [top, second] = result.candidates;
  if (top.score < 0.35) {
    return "weak";
  }

  if (
    second &&
    top.law_id !== second.law_id &&
    Math.abs(top.score - second.score) < 0.1 &&
    second.score >= 0.35
  ) {
    return "ambiguous";
  }

  return "strong";
}
