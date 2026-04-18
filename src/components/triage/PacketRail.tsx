"use client";

import type { AnswerEnvelope } from "@/lib/assistant/ask-schema";

import { StrengthBadge } from "@/components/ui/StrengthBadge";

export function PacketRail({
  question,
  effectiveDate,
  answer,
  exportDisabled = false,
  onExport,
  onExpertReview
}: {
  question: string;
  effectiveDate: string;
  answer: AnswerEnvelope;
  exportDisabled?: boolean;
  onExport?: () => void;
  onExpertReview?: () => void;
}) {
  return (
    <aside className="panel packet-rail">
      <p className="packet-rail__line">{question}</p>
      <p className="packet-rail__line">기준일 {effectiveDate}</p>
      <StrengthBadge strength={answer.strength} />
      <p className="packet-rail__line">인용 {answer.citations.length}건</p>
      <ul className="packet-rail__facts">
        {answer.verifiedFacts.slice(0, 2).map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      <div className="panel__actions">
        <button type="button" disabled={exportDisabled} onClick={onExport}>
          PDF 내보내기
        </button>
        <button type="button" className="ghost-button" onClick={onExpertReview}>
          전문가 검토 요청
        </button>
      </div>
    </aside>
  );
}
