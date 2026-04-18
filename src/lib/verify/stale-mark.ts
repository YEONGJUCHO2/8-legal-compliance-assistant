import type { StaleMark, VerifiedCitation } from "./types";

export function buildStaleMarks(verified: VerifiedCitation[]): StaleMark[] {
  return verified.flatMap((citation) => {
    if (!citation.disagreement && citation.verification_source !== "missing") {
      return [];
    }

    return [
      {
        lawArticleId: citation.id,
        lawId: citation.lawId,
        snapshotHash: citation.localSnapshotHash,
        reason:
          citation.changedSummary ??
          citation.failureReason ??
          (citation.disagreement ? "mcp_disagreement" : "article_missing")
      }
    ];
  });
}
