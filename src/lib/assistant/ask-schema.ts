import { z } from "zod";

import type { Citation, QuestionHistoryRow } from "@/lib/db/rows";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTimeSchema = z.string().datetime({ offset: true });

const askModeSchema = z.object({
  mode: z.literal("ask"),
  clientRequestId: z.string().min(1),
  question: z.string().min(1),
  referenceDate: isoDateSchema,
  skipClarification: z.boolean().optional(),
  clarificationResponses: z.record(z.string(), z.string()).optional(),
  parentRunId: z.string().optional(),
  sessionId: z.string().optional()
});

const rerunModeSchema = z.object({
  mode: z.literal("rerun_current_law"),
  clientRequestId: z.string().min(1),
  parentRunId: z.string().min(1),
  question: z.string().optional(),
  referenceDate: isoDateSchema.optional(),
  skipClarification: z.boolean().optional(),
  clarificationResponses: z.record(z.string(), z.string()).optional(),
  sessionId: z.string().optional()
});

export const AskRequestSchema = z.discriminatedUnion("mode", [askModeSchema, rerunModeSchema]);
export type AskRequest = z.infer<typeof AskRequestSchema>;

export function isFutureReferenceDate(referenceDate: string, serverToday = new Date().toISOString().slice(0, 10)) {
  return referenceDate > serverToday;
}

const citationSchema = z.object({
  law_id: z.string().nullable(),
  article_id: z.string(),
  article_version_id: z.string(),
  text: z.string(),
  quote: z.string().optional(),
  law_title: z.string(),
  article_number: z.string(),
  mcp_verified: z.boolean(),
  verified_at: z.string().nullable(),
  in_force_at_query_date: z.boolean(),
  verification_source: z.enum(["local", "mcp"]),
  rendered_from_verification: z.boolean().optional(),
  mcp_disagreement: z.boolean().optional(),
  latest_article_version_id: z.string().nullable().optional(),
  changed_summary: z.string().nullable().optional()
});

const answerPayloadSchema = z.object({
  runId: z.string(),
  sessionId: z.string().optional(),
  status: z.literal("answered"),
  strength: z.enum(["clear", "conditional", "verification_pending"]),
  citations: z.array(citationSchema),
  effectiveDate: isoDateSchema,
  renderedFrom: z.enum(["local_index", "mcp_verification", "mixed"]),
  behaviorVersion: z.string(),
  generatedFromSkip: z.boolean().optional(),
  verifiedFacts: z.array(z.string()),
  conclusion: z.string(),
  explanation: z.string(),
  caution: z.string(),
  answeredScope: z.array(z.string()).optional(),
  unansweredScope: z.array(z.string()).optional(),
  priorityOrder: z.array(z.string()).optional(),
  collapsedLawSummary: z.string().optional(),
  lawSections: z
    .array(
      z.object({
        law_title: z.string(),
        summary: z.string(),
        why_it_applies: z.string().optional(),
        check_first: z.array(z.string()).optional()
      })
    )
    .optional(),
  changedSinceCreated: z.boolean().optional()
});

export const AskResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("answer")
  }).merge(answerPayloadSchema),
  z.object({
    kind: z.literal("clarify"),
    runId: z.string(),
    question: z.string(),
    reasonCode: z.enum(["missing_fact", "date_confirmation", "ambiguous_law", "low_confidence"]).optional()
  }),
  z.object({
    kind: z.literal("no_match"),
    runId: z.string(),
    message: z.string(),
    nextActions: z.array(z.string()).optional()
  }),
  z.object({
    kind: z.literal("schema_error"),
    runId: z.string(),
    message: z.string(),
    schemaRetryCount: z.literal(2)
  }),
  z.object({
    kind: z.literal("verification_pending"),
    runId: z.string(),
    message: z.string(),
    exportLocked: z.literal(true),
    canContinueViewing: z.literal(true),
    answer: answerPayloadSchema.extend({
      strength: z.literal("verification_pending")
    }).optional()
  }),
  z.object({
    kind: z.literal("date_confirmation_required"),
    runId: z.string(),
    message: z.string(),
    hint: z.string().optional(),
    reason: z.string().optional()
  }),
  z.object({
    kind: z.literal("idempotency_conflict"),
    message: z.string()
  }),
  z.object({
    kind: z.literal("rate_limited"),
    retryAfterSeconds: z.number().int().positive()
  }),
  z.object({
    kind: z.literal("canceled"),
    runId: z.string(),
    message: z.string()
  }),
  z.object({
    kind: z.literal("auth_expired"),
    recoveryUrl: z.literal("/login")
  }),
  z.object({
    kind: z.literal("error"),
    message: z.string()
  })
]);

export type AskResponse = z.infer<typeof AskResponseSchema>;
export type AnswerEnvelope = Extract<AskResponse, { kind: "answer" }>;
export type VerificationPendingEnvelope = Extract<AskResponse, { kind: "verification_pending" }>;

const questionHistoryRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  rerun_from_run_id: z.string().nullable(),
  client_request_id: z.string().nullable(),
  user_query: z.string(),
  normalized_query: z.string(),
  query_effective_date: isoDateSchema,
  status: z.enum(["clarify", "answered", "verification_pending", "no_match", "schema_error", "engine_error", "canceled"]),
  clarification_question: z.string().nullable(),
  answer_strength: z.enum(["clear", "conditional", "verification_pending"]).nullable(),
  conclusion: z.string().nullable(),
  explanation: z.string().nullable(),
  caution: z.string().nullable(),
  changed_since_created: z.boolean(),
  answer_behavior_version: z.string(),
  reference_date_confirmed: z.boolean(),
  engine_provider: z.enum(["codex", "anthropic"]),
  schema_retry_count: z.number().int(),
  created_at: isoDateTimeSchema
});

export type HistoryListItem = {
  id: string;
  user_query: string;
  query_effective_date: string;
  status: QuestionHistoryRow["status"];
  answer_strength: QuestionHistoryRow["answer_strength"];
  conclusion: string | null;
  clarification_question: string | null;
  changed_since_created: boolean;
  answer_behavior_version: string;
  created_at: string;
};

export type HistoryListResponse = {
  history: HistoryListItem[];
};

export const HistoryListResponseSchema = z.object({
  history: z.array(
    z.object({
      id: z.string(),
      user_query: z.string(),
      query_effective_date: isoDateSchema,
      status: questionHistoryRowSchema.shape.status,
      answer_strength: questionHistoryRowSchema.shape.answer_strength,
      conclusion: z.string().nullable(),
      clarification_question: z.string().nullable(),
      changed_since_created: z.boolean(),
      answer_behavior_version: z.string(),
      created_at: isoDateTimeSchema
    })
  )
});

export type HistorySnapshotResponse = {
  snapshot: QuestionHistoryRow & {
    citations: Citation[];
  };
};

export const HistorySnapshotResponseSchema = z.object({
  snapshot: questionHistoryRowSchema.extend({
    citations: z.array(citationSchema)
  })
});
