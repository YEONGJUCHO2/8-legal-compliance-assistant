"use client";

import { z } from "zod";

import {
  AskRequestSchema,
  AskResponseSchema,
  HistoryListResponseSchema,
  HistorySnapshotResponseSchema,
  type AskRequest,
  type AskResponse,
  type HistoryListResponse,
  type HistorySnapshotResponse
} from "@/lib/assistant/ask-schema";

const feedbackResponseSchema = z.object({
  ok: z.boolean(),
  recordedAt: z.string().datetime({ offset: true })
});

const exportResponseSchema = z.object({
  ok: z.literal(true),
  format: z.enum(["pdf", "clipboard", "print"]),
  variant: z.enum(["redaction_review", "full_text"]),
  effectiveDate: z.string(),
  requiresUserReview: z.boolean(),
  clipboardText: z.string().optional(),
  printHtml: z.string().optional(),
  payloadUrl: z.string().optional()
});

export class AuthExpiredError extends Error {
  readonly recoveryUrl: string;

  constructor(recoveryUrl: string) {
    super("auth_expired");
    this.name = "AuthExpiredError";
    this.recoveryUrl = recoveryUrl;
  }
}

async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit | undefined, schema: z.ZodSchema<T>) {
  const response = await fetch(input, init);
  const json = await response.json();

  if (response.status === 401 && json?.kind === "auth_expired") {
    throw new AuthExpiredError(json.recoveryUrl);
  }

  return schema.parse(json);
}

export async function postAsk(body: AskRequest): Promise<AskResponse> {
  return fetchJson(
    "/api/ask",
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(AskRequestSchema.parse(body))
    },
    AskResponseSchema
  );
}

export async function postRerun(runId: string): Promise<AskResponse> {
  return fetchJson(
    "/api/answer-with-current-law",
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        runId
      })
    },
    AskResponseSchema
  );
}

export async function getHistory(): Promise<HistoryListResponse> {
  return fetchJson("/api/history", undefined, HistoryListResponseSchema);
}

export async function getRun(id: string): Promise<HistorySnapshotResponse> {
  return fetchJson(`/api/history/${id}`, undefined, HistorySnapshotResponseSchema);
}

export async function postFeedback(
  runId: string,
  payload: {
    feedbackType: "helpful" | "wrong_citation" | "wrong_conclusion";
  }
) {
  return fetchJson(
    "/api/feedback",
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        runId,
        feedbackType: payload.feedbackType
      })
    },
    feedbackResponseSchema
  );
}

export async function postExport(
  runId: string,
  payload: {
    format: "pdf" | "clipboard" | "print";
    variant: "redaction_review" | "full_text";
    confirmRedactionReview: boolean;
  }
) {
  return fetchJson(
    "/api/export",
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        runId,
        ...payload
      })
    },
    exportResponseSchema
  );
}
