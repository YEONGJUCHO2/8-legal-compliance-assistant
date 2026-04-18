import type { QuestionHistoryCitationRow } from "@/lib/db/rows";

import type { VerifiedCitation } from "./types";

const PENDING_RUN_ID = "phase-07-persist-pending";

export function buildCitationPersistence(verified: VerifiedCitation[]): QuestionHistoryCitationRow[] {
  return verified.map((citation, index) => ({
    id: index + 1,
    run_id: PENDING_RUN_ID,
    article_id: citation.id,
    article_version_id: citation.articleVersionId,
    quote: citation.rendered_from_verification ? citation.mcpBody ?? citation.localBody : citation.localBody,
    position: citation.position ?? index,
    verified_at_mcp: citation.verifiedAt,
    verification_source: citation.verification_source === "mcp" ? "mcp" : "local",
    mcp_disagreement: citation.disagreement,
    latest_article_version_id: citation.latestArticleVersionId ?? null,
    changed_summary: citation.changedSummary ?? citation.failureReason ?? null,
    changed_at:
      citation.disagreement || citation.verification_source === "missing" ? citation.verifiedAt ?? null : null
  }));
}
