"use client";

import type { AnswerEnvelope } from "@/lib/assistant/ask-schema";

import { CitationCard } from "@/components/ui/CitationCard";
import { StrengthBadge } from "@/components/ui/StrengthBadge";

export function TriagePacket({
  question,
  answer,
  onExpertReview
}: {
  question: string;
  answer: AnswerEnvelope;
  onExpertReview?: () => void;
}) {
  const hasMultiLaw = (answer.lawSections?.length ?? 0) > 1 || (answer.unansweredScope?.length ?? 0) > 0;

  return (
    <article className="panel triage-packet" data-testid="triage-packet">
      <p className="eyebrow">트리아지 패킷</p>
      <h2 className="panel__title">{question}</h2>
      {hasMultiLaw ? (
        <div className="scope-banner">
          <strong>답변 범위</strong>
          <span>{answer.answeredScope?.join(", ") || "확인된 범위"}</span>
          {answer.unansweredScope?.length ? <span>미답변: {answer.unansweredScope.join(", ")}</span> : null}
        </div>
      ) : null}
      <StrengthBadge strength={answer.strength} />

      <section className="triage-packet__section">
        <h3 className="panel__subtitle">검증된 사실</h3>
        <ul>
          {answer.verifiedFacts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </section>

      <section className="triage-packet__section">
        <h3 className="panel__subtitle">결론</h3>
        <p>{answer.conclusion}</p>
      </section>

      {answer.collapsedLawSummary ? <p className="law-summary">{answer.collapsedLawSummary}</p> : null}

      <section className="triage-packet__section">
        <h3 className="panel__subtitle">설명</h3>
        <p>{answer.explanation}</p>
      </section>

      <section className="triage-packet__section">
        <h3 className="panel__subtitle">인용 조문</h3>
        {answer.citations[0] ? (
          <CitationCard citation={answer.citations[0]} changedSinceCreated={answer.changedSinceCreated} />
        ) : (
          <p>인용 조문이 아직 없습니다.</p>
        )}
      </section>

      <section className="triage-packet__section">
        <h3 className="panel__subtitle">주의/예외</h3>
        <p>{answer.caution}</p>
      </section>

      <div className="panel__actions">
        <button type="button" onClick={onExpertReview}>
          전문가 검토 요청
        </button>
      </div>
    </article>
  );
}
