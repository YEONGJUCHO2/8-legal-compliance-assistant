import type { AnswerEnvelope, AskResponse, HistoryListResponse, HistorySnapshotResponse } from "@/lib/assistant/ask-schema";

export function createAnswerFixture(overrides: Partial<AnswerEnvelope> = {}): AnswerEnvelope {
  return {
    kind: "answer",
    runId: "run-1",
    sessionId: "session-1",
    status: "answered",
    strength: "clear",
    citations: [
      {
        law_id: "law-1",
        article_id: "article-1",
        article_version_id: "article-1-v1",
        text: ["제10조 안전조치", "사업주는 프레스 작업 전 방호장치를 점검해야 한다.", "점검 결과는 작업 전에 확인한다.", "위험 발견 시 즉시 정지한다.", "필요한 보호구를 지급한다.", "작업 절차를 고지한다.", "교육 이수를 확인한다."].join("\n"),
        quote: "사업주는 프레스 작업 전 방호장치를 점검해야 한다.",
        law_title: "산업안전보건법",
        article_number: "제10조",
        mcp_verified: true,
        verified_at: "2026-04-18T09:00:00.000Z",
        in_force_at_query_date: true,
        verification_source: "mcp",
        rendered_from_verification: false,
        mcp_disagreement: false,
        latest_article_version_id: null,
        changed_summary: null
      }
    ],
    effectiveDate: "2026-04-18",
    renderedFrom: "local_index",
    behaviorVersion: "phase-09-ui",
    generatedFromSkip: false,
    verifiedFacts: ["프레스 작업 전 방호장치를 점검해야 합니다."],
    conclusion: "점검 후 작업해야 합니다.",
    explanation: "관련 조문은 작업 전 안전조치를 요구합니다.",
    caution: "설비와 공정에 따라 추가 점검이 필요할 수 있습니다.",
    answeredScope: ["프레스 작업 전 기본 안전조치"],
    unansweredScope: [],
    priorityOrder: ["방호장치 확인", "작업 중지 기준 검토"],
    collapsedLawSummary: "산업안전보건법과 시행규칙 요약",
    lawSections: [
      {
        law_title: "산업안전보건법",
        summary: "사업주는 프레스 작업 전 방호장치를 점검해야 합니다.",
        why_it_applies: "프레스 작업과 직접 연결됩니다.",
        check_first: ["방호장치 점검표", "교육 기록"]
      }
    ],
    changedSinceCreated: false,
    ...overrides
  };
}

export function createVerificationPendingFixture(): AskResponse {
  return {
    kind: "verification_pending",
    runId: "run-pending",
    message: "검증 지연: 최신 법령 대조가 끝나기 전이라 결론을 확정할 수 없습니다.",
    exportLocked: true,
    canContinueViewing: true,
    answer: {
      ...createAnswerFixture({
        runId: "run-pending",
        strength: "verification_pending"
      }),
      strength: "verification_pending"
    }
  };
}

export function createHistoryFixture(overrides?: Partial<HistoryListResponse["history"][number]>): HistoryListResponse {
  return {
    history: [
      {
        id: "run-1",
        user_query: "산안법 제10조 안전조치",
        query_effective_date: "2026-04-18",
        status: "answered",
        answer_strength: "clear",
        conclusion: "점검 후 작업해야 합니다.",
        clarification_question: null,
        changed_since_created: false,
        answer_behavior_version: "phase-09-ui",
        created_at: "2026-04-18T09:00:00.000Z",
        ...overrides
      }
    ]
  };
}

export function createSnapshotFixture(): HistorySnapshotResponse {
  const answer = createAnswerFixture();

  return {
    snapshot: {
      id: answer.runId,
      user_id: "user-1",
      rerun_from_run_id: null,
      client_request_id: "req-1",
      user_query: "산안법 제10조 안전조치",
      normalized_query: "산안법 제10조 안전조치",
      query_effective_date: answer.effectiveDate,
      status: "answered",
      clarification_question: null,
      answer_strength: answer.strength,
      conclusion: answer.conclusion,
      explanation: answer.explanation,
      caution: answer.caution,
      changed_since_created: false,
      answer_behavior_version: answer.behaviorVersion,
      reference_date_confirmed: false,
      engine_provider: "anthropic",
      schema_retry_count: 0,
      created_at: "2026-04-18T09:00:00.000Z",
      citations: answer.citations
    }
  };
}
