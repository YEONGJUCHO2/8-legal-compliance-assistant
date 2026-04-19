"use client";

import { useMemo, useRef, useState } from "react";

import type { AskRequest, AnswerEnvelope, AskResponse, HistoryListItem, HistorySnapshotResponse } from "@/lib/assistant/ask-schema";
import { AuthExpiredError, getRun, postAsk, postExport, postFeedback, postLogout, postRerun } from "@/lib/api-client";

import { ExpertReviewModal } from "@/components/expert/ExpertReviewModal";
import { AskForm } from "@/components/form/AskForm";
import { HistoryPanel } from "@/components/history/HistoryPanel";
import { SnapshotView } from "@/components/history/SnapshotView";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { OnboardingPanel } from "@/components/onboarding/OnboardingPanel";
import { ServiceUpdateStrip } from "@/components/onboarding/ServiceUpdateStrip";
import { PacketRail } from "@/components/triage/PacketRail";
import { ClarificationCard } from "@/components/triage/ClarificationCard";
import { TriagePacket } from "@/components/triage/TriagePacket";
import { RecoveryCard, type RecoveryKind } from "@/components/ui/RecoveryCard";

function normalizePendingAnswer(
  answer: Exclude<Extract<AskResponse, { kind: "verification_pending" }>["answer"], undefined>
): AnswerEnvelope {
  return {
    kind: "answer",
    ...answer
  };
}

function mapResponseToRecovery(response: AskResponse): RecoveryKind | null {
  switch (response.kind) {
    case "no_match":
      return "no_match";
    case "schema_error":
      return "schema_error";
    case "verification_pending":
      return "verification_pending";
    case "date_confirmation_required":
      return "date_confirmation_required";
    case "auth_expired":
      return "auth_expired";
    case "rate_limited":
      return "rate_limit";
    default:
      return null;
  }
}

const loadingStages = ["질문 정리 중", "관련 조문 찾는 중", "최신 법령 대조 중"];

export function AppShell({
  initialHistory,
  serviceUpdate
}: {
  initialHistory: HistoryListItem[];
  serviceUpdate: {
    behaviorVersion: string;
    summary: string;
  };
}) {
  const [history, setHistory] = useState(initialHistory);
  const [answer, setAnswer] = useState<AnswerEnvelope | null>(null);
  const [snapshot, setSnapshot] = useState<HistorySnapshotResponse["snapshot"] | null>(null);
  const [clarify, setClarify] = useState<Extract<AskResponse, { kind: "clarify" }> | null>(null);
  const [recovery, setRecovery] = useState<RecoveryKind | null>(null);
  const [loading, setLoading] = useState(false);
  const [expertOpen, setExpertOpen] = useState(false);
  const [exportDisabled, setExportDisabled] = useState(false);
  const [lastRequest, setLastRequest] = useState<AskRequest | null>(null);
  const activeRequestId = useRef(0);
  const cancelledRequestIds = useRef(new Set<number>());

  const shellTitle = useMemo(() => (history.length === 0 ? "첫 질문 시작" : "최근 질문 이어보기"), [history.length]);

  async function handleExport(runId: string) {
    const exported = await postExport(runId, {
      format: "pdf",
      variant: "redaction_review",
      confirmRedactionReview: true
    });

    if (!exported.printHtml) {
      return;
    }

    const opened = window.open("", "_blank", "noopener,noreferrer");

    if (!opened) {
      return;
    }

    opened.document.open();
    opened.document.write(exported.printHtml);
    opened.document.close();
  }

  async function submitAsk(request: AskRequest) {
    const requestId = activeRequestId.current + 1;
    activeRequestId.current = requestId;
    cancelledRequestIds.current.delete(requestId);
    setLoading(true);
    setRecovery(null);
    setClarify(null);
    setSnapshot(null);
    setLastRequest(request);

    try {
      const response = await postAsk(request);

      if (cancelledRequestIds.current.has(requestId)) {
        return;
      }

      if (response.kind === "answer") {
        setAnswer(response);
        setExportDisabled(false);
      } else if (response.kind === "clarify") {
        setClarify(response);
      } else if (response.kind === "verification_pending") {
        if (response.answer) {
          setAnswer(normalizePendingAnswer(response.answer));
        }
        setExportDisabled(true);
      } else {
        setAnswer(null);
      }

      setRecovery(mapResponseToRecovery(response));
    } catch (error) {
      if (cancelledRequestIds.current.has(requestId)) {
        return;
      }

      if (error instanceof AuthExpiredError) {
        setRecovery("auth_expired");
      } else {
        setRecovery("offline");
      }
    } finally {
      if (!cancelledRequestIds.current.has(requestId)) {
        setLoading(false);
      }
    }
  }

  async function handleOpenRun(runId: string) {
    const next = await getRun(runId);
    setSnapshot(next.snapshot);
  }

  async function handleRerun(runId: string) {
    const response = await postRerun(runId);
    if (response.kind === "answer") {
      setAnswer(response);
      setRecovery(null);
      setExportDisabled(false);
    } else if (response.kind === "verification_pending") {
      if (response.answer) {
        setAnswer(normalizePendingAnswer(response.answer));
      }
      setRecovery("verification_pending");
      setExportDisabled(true);
    }
  }

  return (
    <main className="app-shell">
      <ServiceUpdateStrip update={serviceUpdate} />

      <section className="app-shell__hero">
        <div className="app-shell__hero-row">
          <div>
            <h1>{shellTitle}</h1>
            <p>기준일과 검증 상태를 분리해 보여 주는 컴플라이언스 트리아지 인터페이스입니다.</p>
          </div>
          <button
            type="button"
            className="app-shell__logout"
            onClick={() => {
              void postLogout().catch(() => {
                if (typeof window !== "undefined") {
                  window.location.href = "/login";
                }
              });
            }}
          >
            로그아웃
          </button>
        </div>
      </section>

      {history.length === 0 ? <OnboardingPanel /> : null}

      <div className="app-shell__layout">
        <section className="app-shell__main">
          <AskForm
            loading={loading}
            onSubmit={({ question, referenceDate, clarificationResponses }) =>
              submitAsk({
                mode: "ask",
                clientRequestId: `req-${Date.now()}`,
                question,
                referenceDate,
                clarificationResponses
              })
            }
          />

          {loading ? (
            <LoadingSkeleton
              stages={loadingStages}
              onCancel={() => {
                cancelledRequestIds.current.add(activeRequestId.current);
                setLoading(false);
              }}
            />
          ) : null}

          {clarify ? (
            <ClarificationCard
              question={clarify.question}
              onSkip={() => {
                if (!lastRequest || lastRequest.mode !== "ask") {
                  return;
                }

                void submitAsk({
                  ...lastRequest,
                  skipClarification: true,
                  parentRunId: clarify.runId
                });
              }}
            />
          ) : null}

          {recovery ? (
            <RecoveryCard
              kind={recovery}
              onPrimaryAction={() => {
                if (!lastRequest) {
                  return;
                }

                if (recovery === "date_confirmation_required" && lastRequest.mode === "ask") {
                  void submitAsk({
                    ...lastRequest,
                    clarificationResponses: {
                      ...(lastRequest.clarificationResponses ?? {}),
                      dateConfirmed: "true"
                    }
                  });
                  return;
                }

                if (recovery === "auth_expired") {
                  window.location.assign("/login");
                  return;
                }

                if (lastRequest.mode === "ask") {
                  void submitAsk(lastRequest);
                }
              }}
              onSecondaryAction={() => setExpertOpen(true)}
            />
          ) : null}

          {answer ? (
            <div className="app-shell__packet-grid">
              <TriagePacket question={lastRequest?.question ?? snapshot?.user_query ?? "현재 질문"} answer={answer} onExpertReview={() => setExpertOpen(true)} />
              <PacketRail
                question={lastRequest?.question ?? snapshot?.user_query ?? "현재 질문"}
                effectiveDate={answer.effectiveDate}
                answer={answer}
                exportDisabled={exportDisabled}
                onExport={() => void handleExport(answer.runId)}
                onExpertReview={() => setExpertOpen(true)}
              />
            </div>
          ) : null}

          {snapshot ? <SnapshotView snapshot={snapshot} onRerun={() => void handleRerun(snapshot.id)} /> : null}

          {answer ? (
            <div className="panel__actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  void postFeedback(answer.runId, {
                    feedbackType: "helpful"
                  });
                }}
              >
                도움 됨
              </button>
            </div>
          ) : null}
        </section>

        <HistoryPanel history={history} onOpenRun={(runId) => void handleOpenRun(runId)} onRerun={(runId) => void handleRerun(runId)} />
      </div>

      <ExpertReviewModal open={expertOpen} onClose={() => setExpertOpen(false)} />
    </main>
  );
}
