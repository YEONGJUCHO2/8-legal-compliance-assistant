import { randomUUID } from "node:crypto";

import type { Citation, FeedbackEventRow, QuestionHistoryCitationRow, QuestionHistoryRow } from "@/lib/db/rows";

import type { AskResponse, HistoryListResponse, HistorySnapshotResponse } from "./ask-schema";

export interface HistoryStore {
  persistRun(row: QuestionHistoryRow, response?: AskResponse): Promise<void>;
  persistCitations(rows: QuestionHistoryCitationRow[]): Promise<void>;
  getRun(id: string): Promise<QuestionHistoryRow | null>;
  getSnapshot(id: string): Promise<HistorySnapshotResponse | null>;
  getResult(id: string): Promise<AskResponse | null>;
  listRuns(userId: string, cursor?: string): Promise<HistoryListResponse>;
  cancel(runId: string, userId: string): Promise<void>;
  recordFeedback(input: {
    runId: string;
    userId: string;
    feedbackType: FeedbackEventRow["feedback_type"];
    now: string;
  }): Promise<{ ok: true; recordedAt: string }>;
}

type StoredSnapshot = {
  row: QuestionHistoryRow;
  citations: Citation[];
};

function mapPersistedCitation(row: QuestionHistoryCitationRow): Citation {
  return {
    law_id: null,
    article_id: row.article_id,
    article_version_id: row.article_version_id,
    text: row.quote,
    quote: row.quote,
    law_title: "",
    article_number: "",
    mcp_verified: row.verified_at_mcp !== null,
    verified_at: row.verified_at_mcp,
    in_force_at_query_date: true,
    verification_source: row.verification_source,
    rendered_from_verification: row.verification_source === "mcp",
    mcp_disagreement: row.mcp_disagreement,
    latest_article_version_id: row.latest_article_version_id,
    changed_summary: row.changed_summary
  };
}

function cloneResponse(response: AskResponse | null) {
  return response ? structuredClone(response) : null;
}

export function createInMemoryHistoryStore(): HistoryStore {
  const runs = new Map<string, QuestionHistoryRow>();
  const rawCitations = new Map<string, QuestionHistoryCitationRow[]>();
  const results = new Map<string, AskResponse>();
  const feedback = new Map<string, FeedbackEventRow[]>();

  return {
    async persistRun(row, response) {
      runs.set(row.id, structuredClone(row));

      if (response) {
        results.set(row.id, structuredClone(response));
      }
    },
    async persistCitations(rows) {
      for (const row of rows) {
        const existing = rawCitations.get(row.run_id) ?? [];
        rawCitations.set(row.run_id, [...existing, structuredClone(row)]);
      }
    },
    async getRun(id) {
      const row = runs.get(id);
      return row ? structuredClone(row) : null;
    },
    async getSnapshot(id) {
      const row = runs.get(id);
      if (!row) {
        return null;
      }

      const citations = (rawCitations.get(id) ?? []).map(mapPersistedCitation);

      return {
        snapshot: {
          ...structuredClone(row),
          citations
        }
      };
    },
    async getResult(id) {
      return cloneResponse(results.get(id) ?? null);
    },
    async listRuns(userId) {
      const history = [...runs.values()]
        .filter((row) => row.user_id === userId)
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
        .map((row) => ({
          id: row.id,
          user_query: row.user_query,
          query_effective_date: row.query_effective_date,
          status: row.status,
          answer_strength: row.answer_strength,
          conclusion: row.conclusion,
          clarification_question: row.clarification_question,
          changed_since_created: row.changed_since_created,
          answer_behavior_version: row.answer_behavior_version,
          created_at: row.created_at
        }));

      return { history };
    },
    async cancel(runId, userId) {
      const row = runs.get(runId);

      if (row && row.user_id === userId) {
        runs.set(runId, {
          ...row,
          status: "canceled"
        });
      }
    },
    async recordFeedback({ runId, userId, feedbackType, now }) {
      const event: FeedbackEventRow = {
        id: (feedback.get(runId)?.length ?? 0) + 1,
        run_id: runId,
        user_id: userId,
        feedback_type: feedbackType,
        created_at: now
      };

      feedback.set(runId, [...(feedback.get(runId) ?? []), event]);

      return {
        ok: true,
        recordedAt: now
      };
    }
  };
}

export function createHistoryRowId() {
  return randomUUID();
}
