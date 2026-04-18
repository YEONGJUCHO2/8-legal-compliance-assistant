import type { QuestionHistoryCitationRow } from "@/lib/db/rows";

import type { VerifiedCitation } from "./types";

const PENDING_RUN_ID = "phase-07-persist-pending";

export function buildCitationPersistence(verified: VerifiedCitation[]): QuestionHistoryCitationRow[] {
  return verified.map((citation, index) => ({
    id: index + 1,
    run_id: PENDING_RUN_ID,
    law_id: citation.lawId,
    article_id: citation.id,
    article_version_id: citation.articleVersionId,
    quote: citation.rendered_from_verification ? citation.mcpBody ?? citation.localBody : citation.localBody,
    law_title: citation.lawTitle,
    article_number: citation.articleNo,
    position: citation.position ?? index,
    verified_at_mcp: citation.verifiedAt,
    verification_source: citation.verification_source === "mcp" ? "mcp" : "local",
    in_force_at_query_date: citation.inForce,
    rendered_from_verification: citation.rendered_from_verification,
    mcp_disagreement: citation.disagreement,
    answer_strength_downgrade: citation.answerStrengthDowngrade ?? null,
    latest_article_version_id: citation.latestArticleVersionId ?? null,
    changed_summary: citation.changedSummary ?? citation.failureReason ?? null,
    changed_at:
      citation.disagreement || citation.verification_source === "missing" ? citation.verifiedAt ?? null : null
  }));
}
