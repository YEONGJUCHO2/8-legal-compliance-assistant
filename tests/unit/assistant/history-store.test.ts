import { describe, expect, test } from "vitest";

import type { AskResponse } from "@/lib/assistant/ask-schema";
import { createInMemoryHistoryStore } from "@/lib/assistant/history-store";
import type { QuestionHistoryCitationRow, QuestionHistoryRow } from "@/lib/db/rows";

const runRow: QuestionHistoryRow = {
  id: "run-1",
  user_id: "user-1",
  rerun_from_run_id: null,
  client_request_id: "req-1",
  user_query: "산안법 제10조",
  normalized_query: "산안법 제10조",
  query_effective_date: "2026-04-18",
  status: "answered",
  clarification_question: null,
  answer_strength: "conditional",
  conclusion: "조건부 답변",
  explanation: "설명",
  caution: "주의",
  changed_since_created: true,
  answer_behavior_version: "phase-13",
  reference_date_confirmed: true,
  engine_provider: "anthropic",
  schema_retry_count: 0,
  created_at: "2026-04-18T00:00:00.000Z"
};

const citationRows: QuestionHistoryCitationRow[] = [
  {
    id: 1,
    run_id: runRow.id,
    law_id: "law-uuid-1",
    article_id: "article-1",
    article_version_id: "article-version-1",
    quote: "제10조 본문",
    law_title: "산업안전보건법",
    article_number: "제10조",
    position: 0,
    verified_at_mcp: "2026-04-18T00:00:01.000Z",
    verification_source: "mcp",
    in_force_at_query_date: false,
    rendered_from_verification: false,
    mcp_disagreement: true,
    answer_strength_downgrade: "conditional",
    latest_article_version_id: "article-version-2",
    changed_summary: "text_changed",
    changed_at: "2026-04-18T00:00:01.000Z"
  }
];

const response: AskResponse = {
  kind: "answer",
  runId: runRow.id,
  status: "answered",
  strength: "conditional",
  citations: [
    {
      law_id: citationRows[0].law_id,
      article_id: citationRows[0].article_id,
      article_version_id: citationRows[0].article_version_id,
      text: citationRows[0].quote,
      quote: citationRows[0].quote,
      law_title: citationRows[0].law_title,
      article_number: citationRows[0].article_number,
      mcp_verified: true,
      verified_at: citationRows[0].verified_at_mcp,
      in_force_at_query_date: citationRows[0].in_force_at_query_date,
      verification_source: citationRows[0].verification_source,
      rendered_from_verification: citationRows[0].rendered_from_verification,
      mcp_disagreement: citationRows[0].mcp_disagreement,
      answer_strength_downgrade: citationRows[0].answer_strength_downgrade ?? undefined,
      latest_article_version_id: citationRows[0].latest_article_version_id,
      changed_summary: citationRows[0].changed_summary
    }
  ],
  effectiveDate: runRow.query_effective_date,
  renderedFrom: "mixed",
  behaviorVersion: runRow.answer_behavior_version,
  verifiedFacts: ["사실"],
  conclusion: runRow.conclusion ?? "",
  explanation: runRow.explanation ?? "",
  caution: runRow.caution ?? ""
};

describe("history-store", () => {
  test("round-trips denormalized citation snapshot fields in memory", async () => {
    const store = createInMemoryHistoryStore();

    await store.persistRun(runRow, response);
    await store.persistCitations(citationRows);

    await expect(store.getSnapshot(runRow.id)).resolves.toEqual({
      snapshot: {
        ...runRow,
        citations: response.citations
      }
    });
  });
});
