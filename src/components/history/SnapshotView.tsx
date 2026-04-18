"use client";

import type { HistorySnapshotResponse } from "@/lib/assistant/ask-schema";

import { PacketRail } from "@/components/triage/PacketRail";
import { TriagePacket } from "@/components/triage/TriagePacket";

export function SnapshotView({
  snapshot,
  onRerun
}: {
  snapshot: HistorySnapshotResponse["snapshot"];
  onRerun?: () => void;
}) {
  const answer = {
    kind: "answer" as const,
    runId: snapshot.id,
    status: "answered" as const,
    strength: snapshot.answer_strength ?? "conditional",
    citations: snapshot.citations,
    effectiveDate: snapshot.query_effective_date,
    renderedFrom: "mixed" as const,
    behaviorVersion: snapshot.answer_behavior_version,
    verifiedFacts: [snapshot.explanation ?? "확인된 사실 요약 없음"],
    conclusion: snapshot.conclusion ?? "결론 없음",
    explanation: snapshot.explanation ?? "설명 없음",
    caution: snapshot.caution ?? "주의사항 없음"
  };

  return (
    <div className="snapshot-layout">
      <TriagePacket question={snapshot.user_query} answer={answer} />
      <PacketRail question={snapshot.user_query} effectiveDate={snapshot.query_effective_date} answer={answer} />
      <button type="button" onClick={onRerun}>
        현재 법령으로 새 답변 생성
      </button>
    </div>
  );
}
