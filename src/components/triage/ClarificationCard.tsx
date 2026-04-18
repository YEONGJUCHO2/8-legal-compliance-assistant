"use client";

export function ClarificationCard({
  question,
  onSkip
}: {
  question: string;
  onSkip?: () => void;
}) {
  return (
    <section className="panel clarification-card">
      <h2 className="panel__title">추가 확인이 필요합니다</h2>
      <p>{question}</p>
      <div className="panel__actions">
        <button type="button">추가 정보 입력</button>
        <button type="button" className="ghost-button" onClick={onSkip}>
          현재 정보로 계속
        </button>
      </div>
    </section>
  );
}
