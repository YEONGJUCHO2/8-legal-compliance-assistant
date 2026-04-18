import { randomUUID } from "node:crypto";

import type { Citation, QuestionHistoryCitationRow, QuestionHistoryRow } from "@/lib/db/rows";
import { buildPrompt } from "@/lib/assistant/engine/prompt";
import { resolveBehaviorVersion } from "@/lib/behavior-version";
import { createLogger, logAssistantRunEvent, withRequestContext } from "@/lib/logging";
import { recordRunMetrics } from "@/lib/metrics/assistant-metrics";
import { createInMemoryRateLimitStore, checkRateLimit } from "@/lib/rate-limit";
import { verifyCitations } from "@/lib/verify/engine";
import { buildCitationPersistence } from "@/lib/verify/persist";
import type { VerificationOutput, VerifiedCitation } from "@/lib/verify/types";

import type { AssistantDeps } from "./deps";
import { type AnswerEnvelope, type AskRequest, type AskResponse } from "./ask-schema";
import { detectSuspiciousDateHint } from "./date-gate";
import { checkIdempotency, computePayloadHash } from "./idempotency";
import { splitIntents } from "./intent-split";

const VERIFY_BUDGET_MS = 3000;
const VERIFY_CONCURRENCY_CAP = 5;
const ROUTE_MAX_DURATION_MS = 60_000;
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

function nowIsoString(now?: string | Date, deps?: AssistantDeps) {
  if (now) {
    return (now instanceof Date ? now : new Date(now)).toISOString();
  }

  return (deps?.now?.() ?? new Date()).toISOString();
}

function buildRunRow(input: {
  runId: string;
  userId: string;
  request: AskRequest;
  now: string;
  behaviorVersion: string;
  status: QuestionHistoryRow["status"];
  clarificationQuestion?: string | null;
  answerStrength?: QuestionHistoryRow["answer_strength"];
  conclusion?: string | null;
  explanation?: string | null;
  caution?: string | null;
  schemaRetryCount?: number;
  rerunFromRunId?: string | null;
  engineProvider?: QuestionHistoryRow["engine_provider"];
}) {
  return {
    id: input.runId,
    user_id: input.userId,
    rerun_from_run_id: input.rerunFromRunId ?? input.request.parentRunId ?? null,
    client_request_id: input.request.clientRequestId ?? null,
    user_query: input.request.question ?? "",
    normalized_query: (input.request.question ?? "").trim().toLowerCase(),
    query_effective_date: input.request.referenceDate ?? "",
    status: input.status,
    clarification_question: input.clarificationQuestion ?? null,
    answer_strength: input.answerStrength ?? null,
    conclusion: input.conclusion ?? null,
    explanation: input.explanation ?? null,
    caution: input.caution ?? null,
    changed_since_created: false,
    answer_behavior_version: input.behaviorVersion,
    reference_date_confirmed: input.request.clarificationResponses?.dateConfirmed === "true",
    engine_provider: input.engineProvider ?? "anthropic",
    schema_retry_count: input.schemaRetryCount ?? 0,
    created_at: input.now
  } satisfies QuestionHistoryRow;
}

function buildClarifyResponse(
  runId: string,
  question: string,
  reasonCode?: "missing_fact" | "date_confirmation" | "ambiguous_law" | "low_confidence"
): Extract<AskResponse, { kind: "clarify" }> {
  return {
    kind: "clarify",
    runId,
    question,
    reasonCode
  };
}

function buildNoMatchResponse(runId: string): Extract<AskResponse, { kind: "no_match" }> {
  return {
    kind: "no_match",
    runId,
    message: "질문과 직접 관련된 법령 조문을 확인하지 못했습니다. 작업 공정, 설비명, 상황을 더 구체적으로 적어 주세요.",
    nextActions: ["작업 공정과 설비명을 구체적으로 적어 주세요.", "적용을 의심하는 법령명이 있으면 함께 적어 주세요."]
  };
}

function buildCitationList(verified: VerifiedCitation[]): Citation[] {
  return verified.map((citation) => {
    const renderedText = citation.rendered_from_verification ? citation.mcpBody ?? citation.localBody : citation.localBody;
    const verificationSource = citation.verification_source === "missing" ? "missing" : "mcp";

    return {
      law_id: citation.lawId,
      article_id: citation.id,
      article_version_id: citation.articleVersionId,
      text: renderedText,
      quote: renderedText,
      law_title: citation.lawTitle,
      article_number: citation.articleNo,
      mcp_verified: citation.verifiedAt !== null && verificationSource !== "missing",
      verified_at: citation.verifiedAt,
      in_force_at_query_date: citation.inForce,
      verification_source: verificationSource,
      rendered_from_verification: citation.rendered_from_verification || undefined,
      mcp_disagreement: citation.disagreement,
      answer_strength_downgrade: citation.answerStrengthDowngrade,
      latest_article_version_id: citation.latestArticleVersionId ?? null,
      changed_summary: citation.changedSummary ?? citation.failureReason ?? null
    };
  });
}

function buildRenderedFrom(citations: Citation[]) {
  if (citations.some((citation) => citation.rendered_from_verification)) {
    return "mcp_verification" as const;
  }

  if (
    citations.some((citation) => citation.verification_source === "mcp") &&
    citations.some((citation) => citation.verification_source === "local")
  ) {
    return "mixed" as const;
  }

  return "local_index" as const;
}

function buildAnswerStrength(verification: VerificationOutput) {
  if (verification.overall === "verification_pending" || verification.overall === "degraded") {
    return "verification_pending" as const;
  }

  if (
    verification.overall === "mcp_disagreement" ||
    verification.citations.some((citation) => citation.answerStrengthDowngrade === "conditional")
  ) {
    return "conditional" as const;
  }

  return "clear" as const;
}

function buildAnswerEnvelope(input: {
  runId: string;
  request: AskRequest;
  behaviorVersion: string;
  verified: VerifiedCitation[];
  verification: VerificationOutput;
  answer: {
    verified_facts: string[];
    conclusion: string;
    explanation: string;
    caution: string;
    answered_scope?: string[];
    unanswered_scope?: string[];
    priority_order?: string[];
    collapsed_law_summary?: string;
    law_sections?: Array<{
      law_title: string;
      summary: string;
      why_it_applies?: string;
      check_first?: string[];
    }>;
  };
  sessionId?: string;
  generatedFromSkip?: boolean;
  answeredScopeFallback?: string[];
  unansweredScopeFallback?: string[];
}): AnswerEnvelope {
  const citations = buildCitationList(input.verified);

  return {
    kind: "answer",
    runId: input.runId,
    sessionId: input.sessionId,
    status: "answered",
    strength: buildAnswerStrength(input.verification),
    citations,
    effectiveDate: input.request.referenceDate ?? "",
    renderedFrom: buildRenderedFrom(citations),
    behaviorVersion: input.behaviorVersion,
    generatedFromSkip: input.generatedFromSkip,
    verifiedFacts: input.answer.verified_facts,
    conclusion: input.answer.conclusion,
    explanation: input.answer.explanation,
    caution: input.answer.caution,
    answeredScope: input.answer.answered_scope ?? input.answeredScopeFallback,
    unansweredScope: input.answer.unanswered_scope ?? input.unansweredScopeFallback,
    priorityOrder: input.answer.priority_order,
    collapsedLawSummary: input.answer.collapsed_law_summary,
    lawSections: input.answer.law_sections,
    changedSinceCreated: false
  };
}

function maybeCanceled(deps: AssistantDeps, requestId?: string) {
  return deps.cancellation?.isCanceled(requestId) ?? false;
}

function buildVerificationPendingResponse(runId: string, answer?: AnswerEnvelope): AskResponse {
  return {
    kind: "verification_pending",
    status: "verification_pending",
    runId,
    message: "법령 검증이 지연되어 확정 답변으로 표시할 수 없습니다. 검증 상태를 먼저 확인해 주세요.",
    exportLocked: true,
    canContinueViewing: true,
    answer:
      answer &&
      ({
        ...answer,
        strength: "verification_pending"
      } as AnswerEnvelope & { strength: "verification_pending" })
  };
}

function buildRateLimitedResponse(retryAfterMs: number): Extract<AskResponse, { kind: "rate_limited" }> {
  return {
    kind: "rate_limited",
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000))
  };
}

function dedupeVerificationInputs(candidates: Array<{
  article_id: string;
  article_version_id: string;
  law_id: string;
  law_title: string;
  article_no: string;
  paragraph: string | null;
  item: string | null;
  body: string;
  snapshot_hash: string;
  source_hash: string;
}>) {
  const byKey = new Map<string, {
    id: string;
    articleVersionId: string;
    lawId: string;
    lawTitle: string;
    articleNo: string;
    paragraph?: string;
    item?: string;
    localBody: string;
    localSnapshotHash: string;
    localSourceHash: string;
    position: number;
  }>();

  candidates.forEach((candidate, index) => {
    const key = [candidate.law_id, candidate.article_no, candidate.paragraph ?? "", candidate.item ?? ""].join("|");

    if (!byKey.has(key)) {
      byKey.set(key, {
        id: candidate.article_id,
        articleVersionId: candidate.article_version_id,
        lawId: candidate.law_id,
        lawTitle: candidate.law_title,
        articleNo: candidate.article_no,
        paragraph: candidate.paragraph ?? undefined,
        item: candidate.item ?? undefined,
        localBody: candidate.body,
        localSnapshotHash: candidate.snapshot_hash,
        localSourceHash: candidate.source_hash,
        position: index
      });
    }
  });

  return [...byKey.values()];
}

function buildPersistedCitationRows(runId: string, verified: VerifiedCitation[]): QuestionHistoryCitationRow[] {
  return buildCitationPersistence(verified).map((row, index) => ({
    ...row,
    id: index + 1,
    run_id: runId
  }));
}

function performanceNow() {
  return globalThis.performance?.now() ?? Date.now();
}

function idempotencyExpiry(nowIso: string) {
  return new Date(new Date(nowIso).getTime() + IDEMPOTENCY_WINDOW_MS).toISOString();
}

async function rememberIdempotency(deps: AssistantDeps, userId: string, request: AskRequest, runId: string, nowIso: string) {
  await deps.idempotencyStore.remember({
    userId,
    clientRequestId: request.clientRequestId,
    payloadHash: computePayloadHash(request),
    runId,
    expiresAt: idempotencyExpiry(nowIso)
  });
}

function buildRetrievalScores(candidates: Array<{
  article_id: string;
  score: number;
  score_components: {
    lexical?: number;
  };
}>) {
  return candidates.map((candidate) => ({
    article_id: candidate.article_id,
    lexical_score: candidate.score_components.lexical,
    combined_score: candidate.score
  }));
}

function buildCitationMeta(citations: VerifiedCitation[]): NonNullable<Parameters<typeof logAssistantRunEvent>[1]["citations"]> {
  return citations.map((citation) => ({
    article_id: citation.id,
    article_version_id: citation.articleVersionId,
    verification_source: citation.verification_source === "mcp" ? "mcp" : "local"
  }));
}

function resolveVerificationState(
  verification: VerificationOutput | null,
  strength: QuestionHistoryRow["answer_strength"] | null | undefined
) {
  if (strength === "verification_pending" || verification?.overall === "verification_pending" || verification?.overall === "degraded") {
    return "verification_pending" as const;
  }

  if (strength === "conditional" || verification?.overall === "mcp_disagreement") {
    return "conditional" as const;
  }

  if (verification) {
    return "verified" as const;
  }

  return undefined;
}

export async function runQuery({
  request,
  user,
  deps,
  now,
  requestId
}: {
  request: Extract<AskRequest, { mode: "ask" | "rerun_current_law" }> & {
    question: string;
    referenceDate: string;
  };
  user: {
    id: string;
  } | null;
  deps: AssistantDeps;
  now?: string | Date;
  requestId?: string;
}): Promise<AskResponse> {
  const nowIso = nowIsoString(now, deps);
  const behaviorVersion = resolveBehaviorVersion();
  const effectiveRequestId = requestId ?? deps.generateRequestId?.() ?? `reqid_${randomUUID()}`;
  const logger = withRequestContext(deps.logger ?? createLogger(), {
    requestId: effectiveRequestId,
    userId: user?.id
  });
  const stageBurn: Partial<Record<"retrieval" | "generation" | "verification", number>> = {};
  let verification: VerificationOutput | null = null;
  let engineLatencyMs = 0;
  let retrievalScores: Array<{
    article_id: string;
    lexical_score?: number;
    combined_score?: number;
  }> = [];

  const emitRunEvent = ({
    run,
    errorCode,
    citations,
    rateLimitState = "allowed"
  }: {
    run?: QuestionHistoryRow;
    errorCode?: string;
    citations?: VerifiedCitation[];
    rateLimitState?: "allowed" | "rejected";
  }) => {
    logAssistantRunEvent(logger, {
      request_id: effectiveRequestId,
      user_id: user?.id ?? null,
      run_id: run?.id,
      query_effective_date: request.referenceDate,
      retrieval_scores: retrievalScores.length > 0 ? retrievalScores : undefined,
      citations: citations ? buildCitationMeta(citations) : undefined,
      strength: run?.answer_strength ?? null,
      engine_provider: run?.engine_provider ?? deps.engine.provider,
      engine_latency_ms: engineLatencyMs || undefined,
      schema_retries: run?.schema_retry_count,
      stage_budget_burn_ms: stageBurn,
      verification_concurrency:
        verification && verification.citations.length > 0
          ? {
              in_flight: Math.min(verification.citations.length, VERIFY_CONCURRENCY_CAP),
              cap: VERIFY_CONCURRENCY_CAP
            }
          : undefined,
      schema_retry_exhausted: run ? run.schema_retry_count >= 2 : undefined,
      verification_state: resolveVerificationState(verification, run?.answer_strength),
      behavior_version: run?.answer_behavior_version ?? behaviorVersion,
      rate_limit_state: rateLimitState,
      error_code: errorCode,
      route_max_duration_ms: ROUTE_MAX_DURATION_MS,
      created_at: nowIso
    });
  };

  const persistOutcome = async ({
    run,
    response,
    citations,
    remember = true,
    errorCode
  }: {
    run: QuestionHistoryRow;
    response: AskResponse;
    citations?: VerifiedCitation[];
    remember?: boolean;
    errorCode?: string;
  }) => {
    await deps.historyStore.persistRun(run, response);

    if (citations && citations.length > 0) {
      await deps.historyStore.persistCitations(buildPersistedCitationRows(run.id, citations));
    }

    if (remember) {
      await rememberIdempotency(deps, authedUser.id, request, run.id, nowIso);
    }

    recordRunMetrics(run, verification, engineLatencyMs, stageBurn);
    emitRunEvent({
      run,
      citations,
      errorCode
    });

    return response;
  };

  if (!user) {
    return {
      kind: "auth_expired",
      recoveryUrl: "/login"
    };
  }

  const authedUser = user;

  const rateLimit = await checkRateLimit(
    deps.rateLimitStore ?? createInMemoryRateLimitStore(),
    authedUser.id,
    now instanceof Date ? now : now ?? deps.now?.() ?? new Date()
  );

  if (!rateLimit.allowed) {
    const response = buildRateLimitedResponse(rateLimit.retryAfterMs);
    emitRunEvent({
      errorCode: "rate_limited",
      rateLimitState: "rejected"
    });
    return response;
  }

  if (maybeCanceled(deps, request.clientRequestId)) {
    const runId = randomUUID();
    const response: AskResponse = {
      kind: "canceled",
      runId,
      message: "요청이 취소되었습니다."
    };
    return persistOutcome({
      run: buildRunRow({
        runId,
        userId: authedUser.id,
        request,
        now: nowIso,
        behaviorVersion,
        status: "canceled",
        engineProvider: deps.engine.provider
      }),
      response,
      remember: false,
      errorCode: "canceled"
    });
  }

  const idempotency = await checkIdempotency(deps.idempotencyStore, request, authedUser.id, nowIso);

  if (idempotency.status === "replay") {
    const replayed = await deps.historyStore.getResult(idempotency.runId);
    return replayed ?? {
      kind: "error",
      message: "기존 요청 결과를 복원하지 못했습니다."
    };
  }

  if (idempotency.status === "conflict") {
    return {
      kind: "idempotency_conflict",
      message: "같은 clientRequestId에 다른 payload가 사용되어 요청을 거부했습니다."
    };
  }

  const runId = randomUUID();
  const dateGate = detectSuspiciousDateHint(request.question, request.referenceDate, deps.today?.() ?? request.referenceDate);

  if (dateGate.conflict && request.clarificationResponses?.dateConfirmed !== "true") {
    const response: AskResponse = {
      kind: "date_confirmation_required",
      runId,
      message: "질문에 과거 시점 힌트가 있어 기준일 확인이 필요합니다.",
      hint: dateGate.hint,
      reason: dateGate.reason
    };
    return persistOutcome({
      run: buildRunRow({
        runId,
        userId: authedUser.id,
        request,
        now: nowIso,
        behaviorVersion,
        status: "clarify",
        clarificationQuestion: response.message,
        engineProvider: deps.engine.provider
      }),
      response,
      errorCode: "date_confirmation_required"
    });
  }

  const intents = splitIntents(request.question);
  const answeredIntents: string[] = [];
  const unansweredIntents: string[] = [];
  const retrievalResults = [];
  const retrievalStartedAt = performanceNow();

  for (const intent of intents) {
    const result = await deps.retrieveFn(deps.storage, {
      query: intent.subQuestion,
      referenceDate: request.referenceDate
    });

    if (result.weak === "empty") {
      unansweredIntents.push(intent.subQuestion);
      continue;
    }

    if ((result.weak === "weak" || result.weak === "ambiguous") && request.skipClarification !== true) {
      const response = buildClarifyResponse(runId, "적용 시점, 작업 공정, 설비명을 조금 더 구체적으로 알려주세요.", result.weak === "ambiguous" ? "ambiguous_law" : "missing_fact");
      return persistOutcome({
        run: buildRunRow({
          runId,
          userId: authedUser.id,
          request,
          now: nowIso,
          behaviorVersion,
          status: "clarify",
          clarificationQuestion: response.question,
          engineProvider: deps.engine.provider
        }),
        response,
        errorCode: result.weak === "ambiguous" ? "ambiguous_law" : "missing_fact"
      });
    }

    retrievalResults.push(result);
    answeredIntents.push(intent.subQuestion);

    if (result.weak !== "strong") {
      unansweredIntents.push(intent.subQuestion);
    }
  }
  stageBurn.retrieval = performanceNow() - retrievalStartedAt;

  if (retrievalResults.length === 0) {
    const response = buildNoMatchResponse(runId);
    return persistOutcome({
      run: buildRunRow({
        runId,
        userId: authedUser.id,
        request,
        now: nowIso,
        behaviorVersion,
        status: "no_match",
        conclusion: response.message,
        engineProvider: deps.engine.provider
      }),
      response,
      errorCode: "no_match"
    });
  }

  const mergedCandidates = retrievalResults.flatMap((result) => result.candidates);
  retrievalScores = buildRetrievalScores(mergedCandidates);
  const verificationInput = dedupeVerificationInputs(mergedCandidates);
  const verificationStartedAt = performanceNow();
  verification = await verifyCitations(deps.mcp, {
    citations: verificationInput,
    referenceDate: request.referenceDate,
    budgetMs: VERIFY_BUDGET_MS
  });
  stageBurn.verification = performanceNow() - verificationStartedAt;

  if (maybeCanceled(deps, request.clientRequestId)) {
    const response: AskResponse = {
      kind: "canceled",
      runId,
      message: "요청이 취소되었습니다."
    };
    return persistOutcome({
      run: buildRunRow({
        runId,
        userId: authedUser.id,
        request,
        now: nowIso,
        behaviorVersion,
        status: "canceled",
        engineProvider: deps.engine.provider
      }),
      response,
      remember: false,
      errorCode: "canceled_after_verification"
    });
  }

  const prompt = buildPrompt({
    userQuestion: request.question,
    referenceDate: request.referenceDate,
    retrieval: {
      candidates: mergedCandidates,
      strategy: "targeted_cache",
      emitted_disagreement_capable: true,
      weak: retrievalResults[0].weak
    },
    schemaRef: "answer",
    intent: request.mode
  });
  const generationStartedAt = performanceNow();
  const engineResult = await deps.engine.generate({
    userId: authedUser.id,
    sessionId: request.sessionId,
    prompt,
    schemaRef: "answer"
  });
  engineLatencyMs = performanceNow() - generationStartedAt;
  stageBurn.generation = engineLatencyMs;

  if ("type" in engineResult.response && engineResult.response.type === "schema_error") {
    const response: AskResponse = {
      kind: "schema_error",
      runId,
      message: engineResult.response.message,
      schemaRetryCount: 2
    };
    return persistOutcome({
      run: buildRunRow({
        runId,
        userId: authedUser.id,
        request,
        now: nowIso,
        behaviorVersion,
        status: "schema_error",
        conclusion: engineResult.response.message,
        schemaRetryCount: 2,
        engineProvider: deps.engine.provider
      }),
      response,
      errorCode: "schema_error"
    });
  }

  if ("type" in engineResult.response && engineResult.response.type === "clarify") {
    const response = buildClarifyResponse(runId, engineResult.response.question, engineResult.response.reasonCode);
    return persistOutcome({
      run: buildRunRow({
        runId,
        userId: authedUser.id,
        request,
        now: nowIso,
        behaviorVersion,
        status: "clarify",
        clarificationQuestion: response.question,
        engineProvider: deps.engine.provider
      }),
      response,
      errorCode: "clarify"
    });
  }

  if ("type" in engineResult.response && engineResult.response.type === "no_match") {
    const response: AskResponse = {
      kind: "no_match",
      runId,
      message: engineResult.response.message,
      nextActions: engineResult.response.next_actions
    };
    return persistOutcome({
      run: buildRunRow({
        runId,
        userId: authedUser.id,
        request,
        now: nowIso,
        behaviorVersion,
        status: "no_match",
        conclusion: response.message,
        engineProvider: deps.engine.provider
      }),
      response,
      errorCode: "engine_no_match"
    });
  }

  if ("type" in engineResult.response && engineResult.response.type === "verification_pending") {
    const response = buildVerificationPendingResponse(runId);
    return persistOutcome({
      run: buildRunRow({
        runId,
        userId: authedUser.id,
        request,
        now: nowIso,
        behaviorVersion,
        status: "verification_pending",
        answerStrength: "verification_pending",
        engineProvider: deps.engine.provider
      }),
      response,
      errorCode: "engine_verification_pending"
    });
  }

  const answer = buildAnswerEnvelope({
    runId,
    request,
    behaviorVersion,
    verified: verification.citations,
    verification,
    answer: engineResult.response,
    sessionId: engineResult.sessionId,
    generatedFromSkip: request.skipClarification === true,
    answeredScopeFallback: answeredIntents,
    unansweredScopeFallback: unansweredIntents.length > 0 ? unansweredIntents : undefined
  });

  const finalResponse =
    verification.overall === "verification_pending" || verification.overall === "degraded"
      ? buildVerificationPendingResponse(runId, {
          ...answer,
          strength: "verification_pending"
        })
      : answer;
  const status = finalResponse.kind === "verification_pending" ? "verification_pending" : "answered";
  const strength = finalResponse.kind === "verification_pending" ? "verification_pending" : answer.strength;

  return persistOutcome({
    run: buildRunRow({
      runId,
      userId: authedUser.id,
      request,
      now: nowIso,
      behaviorVersion,
      status,
      answerStrength: strength,
      conclusion: answer.conclusion,
      explanation: answer.explanation,
      caution: answer.caution,
      schemaRetryCount: engineResult.schemaRetries,
      engineProvider: deps.engine.provider
    }),
    response: finalResponse,
    citations: verification.citations,
    errorCode: finalResponse.kind === "verification_pending" ? verification.overall : undefined
  });
}
