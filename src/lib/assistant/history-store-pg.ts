import { randomUUID } from "node:crypto";

import type { Sql } from "postgres";

import { AskResponseSchema, type AskResponse, type HistoryListResponse, type HistorySnapshotResponse } from "@/lib/assistant/ask-schema";
import { getDb } from "@/lib/db/client";
import type { Citation, QuestionHistoryCitationRow, QuestionHistoryRow } from "@/lib/db/rows";

import type { HistoryStore } from "./history-store";

type RunDbRow = {
  id: string;
  user_id: string;
  rerun_from_run_id: string | null;
  client_request_id: string | null;
  question: string;
  normalized_query: string;
  effective_date: string | Date;
  status: QuestionHistoryRow["status"];
  clarification_question: string | null;
  answer_strength: QuestionHistoryRow["answer_strength"];
  conclusion: string | null;
  explanation: string | null;
  caution: string | null;
  changed_since_created: boolean;
  behavior_version: string;
  reference_date_confirmed: boolean;
  engine_provider: QuestionHistoryRow["engine_provider"];
  schema_retry_count: number;
  created_at: string | Date;
  response_json?: AskResponse | string | null;
};

type CitationDbRow = {
  law_id: string | null;
  article_id: string;
  article_version_id: string;
  cited_as: string;
  law_title: string;
  article_number: string;
  position: number;
  verified_at: string | Date | null;
  verification_source: "local" | "mcp";
  in_force_at_query_date: boolean;
  rendered_from_verification: boolean;
  mcp_disagreement: boolean;
  answer_strength_downgrade: "conditional" | "verification_pending" | null;
  latest_article_version_id: string | null;
  changed_summary: string | null;
  changed_at: string | Date | null;
};

function toIsoDate(value: string | Date) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function toIsoDateTime(value: string | Date | null) {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function mapRunRow(row: RunDbRow): QuestionHistoryRow {
  return {
    id: row.id,
    user_id: row.user_id,
    rerun_from_run_id: row.rerun_from_run_id,
    client_request_id: row.client_request_id,
    user_query: row.question,
    normalized_query: row.normalized_query,
    query_effective_date: toIsoDate(row.effective_date),
    status: row.status,
    clarification_question: row.clarification_question,
    answer_strength: row.answer_strength,
    conclusion: row.conclusion,
    explanation: row.explanation,
    caution: row.caution,
    changed_since_created: row.changed_since_created,
    answer_behavior_version: row.behavior_version,
    reference_date_confirmed: row.reference_date_confirmed,
    engine_provider: row.engine_provider,
    schema_retry_count: row.schema_retry_count,
    created_at: toIsoDateTime(row.created_at) ?? new Date(0).toISOString()
  };
}

function mapCitationRow(row: CitationDbRow): Citation {
  const verifiedAt = toIsoDateTime(row.verified_at);

  return {
    law_id: row.law_id,
    article_id: row.article_id,
    article_version_id: row.article_version_id,
    text: row.cited_as,
    quote: row.cited_as,
    law_title: row.law_title,
    article_number: row.article_number,
    mcp_verified: verifiedAt !== null,
    verified_at: verifiedAt,
    in_force_at_query_date: row.in_force_at_query_date,
    verification_source: row.verification_source,
    rendered_from_verification: row.rendered_from_verification,
    mcp_disagreement: row.mcp_disagreement,
    answer_strength_downgrade: row.answer_strength_downgrade ?? undefined,
    latest_article_version_id: row.latest_article_version_id,
    changed_summary: row.changed_summary
  };
}

function parseStoredResponse(value: AskResponse | string | null | undefined) {
  if (!value) {
    return null;
  }

  const candidate =
    typeof value === "string"
      ? (JSON.parse(value) as unknown)
      : value;
  const parsed = AskResponseSchema.safeParse(candidate);

  return parsed.success ? parsed.data : null;
}

async function selectRun(db: Sql, id: string) {
  const rows = await db.unsafe<RunDbRow[]>(
    `
      SELECT
        id,
        user_id,
        rerun_from_run_id,
        client_request_id,
        question,
        normalized_query,
        effective_date,
        status,
        clarification_question,
        answer_strength,
        conclusion,
        explanation,
        caution,
        changed_since_created,
        behavior_version,
        reference_date_confirmed,
        engine_provider,
        schema_retry_count,
        created_at,
        response_json
      FROM assistant_runs
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return rows[0] ?? null;
}

export function createPgHistoryStore(db: Sql = getDb()): HistoryStore {
  return {
    async persistRun(row, response) {
      await db.unsafe(
        `
          INSERT INTO assistant_runs (
            id,
            user_id,
            rerun_from_run_id,
            client_request_id,
            question,
            normalized_query,
            effective_date,
            status,
            clarification_question,
            answer_strength,
            conclusion,
            explanation,
            caution,
            changed_since_created,
            behavior_version,
            reference_date_confirmed,
            engine_provider,
            schema_retry_count,
            created_at,
            response_json
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
          )
          ON CONFLICT (id) DO UPDATE
          SET user_id = EXCLUDED.user_id,
              rerun_from_run_id = EXCLUDED.rerun_from_run_id,
              client_request_id = EXCLUDED.client_request_id,
              question = EXCLUDED.question,
              normalized_query = EXCLUDED.normalized_query,
              effective_date = EXCLUDED.effective_date,
              status = EXCLUDED.status,
              clarification_question = EXCLUDED.clarification_question,
              answer_strength = EXCLUDED.answer_strength,
              conclusion = EXCLUDED.conclusion,
              explanation = EXCLUDED.explanation,
              caution = EXCLUDED.caution,
              changed_since_created = EXCLUDED.changed_since_created,
              behavior_version = EXCLUDED.behavior_version,
              reference_date_confirmed = EXCLUDED.reference_date_confirmed,
              engine_provider = EXCLUDED.engine_provider,
              schema_retry_count = EXCLUDED.schema_retry_count,
              created_at = EXCLUDED.created_at,
              response_json = COALESCE(EXCLUDED.response_json, assistant_runs.response_json)
        `,
        [
          row.id,
          row.user_id,
          row.rerun_from_run_id,
          row.client_request_id,
          row.user_query,
          row.normalized_query,
          row.query_effective_date,
          row.status,
          row.clarification_question,
          row.answer_strength,
          row.conclusion,
          row.explanation,
          row.caution,
          row.changed_since_created,
          row.answer_behavior_version,
          row.reference_date_confirmed,
          row.engine_provider,
          row.schema_retry_count,
          row.created_at,
          response ?? null
        ]
      );
    },
    async persistCitations(rows) {
      if (rows.length === 0) {
        return;
      }

      await db.begin(async (tx) => {
        for (const row of rows) {
          await tx.unsafe(
            `
              INSERT INTO assistant_run_citations (
                run_id,
                law_id,
                article_id,
                article_version_id,
                cited_as,
                law_title,
                article_number,
                position,
                verified_at,
                verification_source,
                in_force_at_query_date,
                rendered_from_verification,
                mcp_disagreement,
                answer_strength_downgrade,
                latest_article_version_id,
                changed_summary,
                changed_at
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
              )
            `,
            [
              row.run_id,
              row.law_id,
              row.article_id,
              row.article_version_id,
              row.quote,
              row.law_title,
              row.article_number,
              row.position,
              row.verified_at_mcp,
              row.verification_source,
              row.in_force_at_query_date,
              row.rendered_from_verification,
              row.mcp_disagreement,
              row.answer_strength_downgrade,
              row.latest_article_version_id,
              row.changed_summary,
              row.changed_at
            ]
          );
        }
      });
    },
    async getRun(id) {
      const row = await selectRun(db, id);

      return row ? mapRunRow(row) : null;
    },
    async getSnapshot(id) {
      const row = await selectRun(db, id);

      if (!row) {
        return null;
      }

      const citationRows = await db.unsafe<CitationDbRow[]>(
        `
          SELECT
            law_id,
            article_id,
            article_version_id,
            cited_as,
            law_title,
            article_number,
            position,
            verified_at,
            verification_source,
            in_force_at_query_date,
            rendered_from_verification,
            mcp_disagreement,
            answer_strength_downgrade,
            latest_article_version_id,
            changed_summary,
            changed_at
          FROM assistant_run_citations
          WHERE run_id = $1
          ORDER BY position ASC
        `,
        [id]
      );

      return {
        snapshot: {
          ...mapRunRow(row),
          citations: citationRows.map((citationRow) => mapCitationRow(citationRow))
        }
      } satisfies HistorySnapshotResponse;
    },
    async getResult(id) {
      const row = await selectRun(db, id);
      return parseStoredResponse(row?.response_json);
    },
    async listRuns(userId, _cursor) {
      const rows = await db.unsafe<RunDbRow[]>(
        `
          SELECT
            id,
            user_id,
            rerun_from_run_id,
            client_request_id,
            question,
            normalized_query,
            effective_date,
            status,
            clarification_question,
            answer_strength,
            conclusion,
            explanation,
            caution,
            changed_since_created,
            behavior_version,
            reference_date_confirmed,
            engine_provider,
            schema_retry_count,
            created_at
          FROM assistant_runs
          WHERE user_id = $1
          ORDER BY created_at DESC
        `,
        [userId]
      );

      return {
        history: rows.map((row) => {
          const mapped = mapRunRow(row);

          return {
            id: mapped.id,
            user_query: mapped.user_query,
            query_effective_date: mapped.query_effective_date,
            status: mapped.status,
            answer_strength: mapped.answer_strength,
            conclusion: mapped.conclusion,
            clarification_question: mapped.clarification_question,
            changed_since_created: mapped.changed_since_created,
            answer_behavior_version: mapped.answer_behavior_version,
            created_at: mapped.created_at
          };
        })
      } satisfies HistoryListResponse;
    },
    async cancel(runId, userId) {
      await db.unsafe(
        `
          UPDATE assistant_runs
          SET status = 'canceled'
          WHERE id = $1
            AND user_id = $2
        `,
        [runId, userId]
      );
    },
    async recordFeedback({ runId, userId, feedbackType, now }) {
      await db.unsafe(
        `
          INSERT INTO feedback_events (id, run_id, user_id, kind, payload, created_at)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [randomUUID(), runId, userId, feedbackType, {}, now]
      );

      return {
        ok: true as const,
        recordedAt: now
      };
    }
  };
}
