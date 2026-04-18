import { describe, expect, test } from "vitest";

import type { AskResponse } from "@/lib/assistant/ask-schema";
import type { QuestionHistoryCitationRow, QuestionHistoryRow } from "@/lib/db/rows";
import { createPgHistoryStore } from "@/lib/assistant/history-store-pg";

import { createMockSql } from "./helpers/mock-postgres";

const runRow: QuestionHistoryRow = {
  id: "7b8cc0fc-cab8-4c7c-8bc8-d30c527f7fd1",
  user_id: "8794e87a-fb81-4216-94fe-e6106dbcc31a",
  rerun_from_run_id: null,
  client_request_id: "req-history-1",
  user_query: "산안법 제10조 프레스 작업 안전조치",
  normalized_query: "산안법 제10조 프레스 작업 안전조치",
  query_effective_date: "2026-04-18",
  status: "answered",
  clarification_question: null,
  answer_strength: "clear",
  conclusion: "프레스 작업 전 방호장치를 점검해야 합니다.",
  explanation: "관련 조문이 작업 전 점검 의무를 요구합니다.",
  caution: "설비별 추가 점검 기준을 확인하세요.",
  changed_since_created: false,
  answer_behavior_version: "phase-12-runtime",
  reference_date_confirmed: false,
  engine_provider: "anthropic",
  schema_retry_count: 0,
  created_at: "2026-04-18T00:00:00.000Z"
};

const citationRows: QuestionHistoryCitationRow[] = [
  {
    id: 1,
    run_id: runRow.id,
    article_id: "f34c78ab-c6c1-48ce-a642-ed8211e66778",
    article_version_id: "ver-1",
    quote: "제10조 본문",
    position: 0,
    verified_at_mcp: "2026-04-18T00:00:01.000Z",
    verification_source: "mcp",
    mcp_disagreement: false,
    latest_article_version_id: null,
    changed_summary: null,
    changed_at: null
  }
];

const answerResponse: AskResponse = {
  kind: "answer",
  runId: runRow.id,
  status: "answered",
  strength: "clear",
  citations: [
    {
      law_id: null,
      article_id: citationRows[0].article_id,
      article_version_id: citationRows[0].article_version_id,
      text: citationRows[0].quote,
      quote: citationRows[0].quote,
      law_title: "",
      article_number: "",
      mcp_verified: true,
      verified_at: citationRows[0].verified_at_mcp,
      in_force_at_query_date: true,
      verification_source: "mcp",
      rendered_from_verification: true,
      mcp_disagreement: false,
      latest_article_version_id: null,
      changed_summary: null
    }
  ],
  effectiveDate: runRow.query_effective_date,
  renderedFrom: "mcp_verification",
  behaviorVersion: runRow.answer_behavior_version,
  verifiedFacts: ["프레스 작업 전 방호장치를 점검해야 합니다."],
  conclusion: runRow.conclusion ?? "",
  explanation: runRow.explanation ?? "",
  caution: runRow.caution ?? ""
};

function buildRunDbRow(row: QuestionHistoryRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    rerun_from_run_id: row.rerun_from_run_id,
    client_request_id: row.client_request_id,
    question: row.user_query,
    normalized_query: row.normalized_query,
    effective_date: row.query_effective_date,
    status: row.status,
    clarification_question: row.clarification_question,
    answer_strength: row.answer_strength,
    conclusion: row.conclusion,
    explanation: row.explanation,
    caution: row.caution,
    changed_since_created: row.changed_since_created,
    behavior_version: row.answer_behavior_version,
    reference_date_confirmed: row.reference_date_confirmed,
    engine_provider: row.engine_provider,
    schema_retry_count: row.schema_retry_count,
    created_at: row.created_at
  };
}

describe("history-store-pg", () => {
  test("persists runs and citations then reads snapshot, result, and list history", async () => {
    const { sql, calls } = createMockSql([
      (query, params) => {
        expect(query).toContain("INSERT INTO assistant_run_citations");
        expect(params[0]).toBe(runRow.id);
        expect(params[1]).toBe(citationRows[0].article_id);
        expect(params[2]).toBe(citationRows[0].article_version_id);
        expect(params[3]).toBe(citationRows[0].quote);
        return [];
      },
      (query, params) => {
        expect(query).toContain("INSERT INTO assistant_runs");
        expect(query).toContain("ON CONFLICT (id) DO UPDATE");
        expect(params[0]).toBe(runRow.id);
        expect(params[1]).toBe(runRow.user_id);
        expect(params[3]).toBe(runRow.client_request_id);
        expect(params[4]).toBe(runRow.user_query);
        expect(params[14]).toBe(runRow.answer_behavior_version);
        expect(params[19]).toEqual(answerResponse);
        return [];
      },
      () => [buildRunDbRow(runRow)],
      () => [buildRunDbRow(runRow)],
      () => [
        {
          article_id: citationRows[0].article_id,
          article_version_id: citationRows[0].article_version_id,
          cited_as: citationRows[0].quote,
          position: citationRows[0].position,
          verified_at: citationRows[0].verified_at_mcp,
          verification_source: citationRows[0].verification_source,
          mcp_disagreement: citationRows[0].mcp_disagreement,
          latest_article_version_id: citationRows[0].latest_article_version_id,
          changed_summary: citationRows[0].changed_summary,
          changed_at: citationRows[0].changed_at
        }
      ],
      () => [{ response_json: answerResponse }],
      () => [buildRunDbRow(runRow)]
    ]);
    const store = createPgHistoryStore(sql);

    await store.persistCitations(citationRows);
    await store.persistRun(runRow, answerResponse);

    await expect(store.getRun(runRow.id)).resolves.toEqual(runRow);
    await expect(store.getSnapshot(runRow.id)).resolves.toEqual({
      snapshot: {
        ...runRow,
        citations: answerResponse.citations
      }
    });
    await expect(store.getResult(runRow.id)).resolves.toEqual(answerResponse);
    await expect(store.listRuns(runRow.user_id)).resolves.toEqual({
      history: [
        {
          id: runRow.id,
          user_query: runRow.user_query,
          query_effective_date: runRow.query_effective_date,
          status: runRow.status,
          answer_strength: runRow.answer_strength,
          conclusion: runRow.conclusion,
          clarification_question: runRow.clarification_question,
          changed_since_created: runRow.changed_since_created,
          answer_behavior_version: runRow.answer_behavior_version,
          created_at: runRow.created_at
        }
      ]
    });

    expect(calls.some((call) => call.query.includes("assistant_run_citations"))).toBe(true);
  });

  test("returns null for missing run, snapshot, and result", async () => {
    const { sql } = createMockSql([() => [], () => [], () => []]);
    const store = createPgHistoryStore(sql);

    await expect(store.getRun("missing-run")).resolves.toBeNull();
    await expect(store.getSnapshot("missing-run")).resolves.toBeNull();
    await expect(store.getResult("missing-run")).resolves.toBeNull();
  });

  test("cancels a scoped run and records feedback", async () => {
    const { sql, calls } = createMockSql([
      (query, params) => {
        expect(query).toContain("UPDATE assistant_runs");
        expect(query).toContain("WHERE id = $1");
        expect(params[0]).toBe(runRow.id);
        expect(params[1]).toBe(runRow.user_id);
        return [];
      },
      (query, params) => {
        expect(query).toContain("INSERT INTO feedback_events");
        expect(params[1]).toBe(runRow.id);
        expect(params[2]).toBe(runRow.user_id);
        expect(params[3]).toBe("wrong_citation");
        return [];
      }
    ]);
    const store = createPgHistoryStore(sql);

    await store.cancel(runRow.id, runRow.user_id);

    await expect(
      store.recordFeedback({
        runId: runRow.id,
        userId: runRow.user_id,
        feedbackType: "wrong_citation",
        now: "2026-04-18T00:05:00.000Z"
      })
    ).resolves.toEqual({
      ok: true,
      recordedAt: "2026-04-18T00:05:00.000Z"
    });

    expect(calls).toHaveLength(2);
  });
});
