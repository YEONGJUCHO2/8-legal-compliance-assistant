"use client";

export function LoadingSkeleton({
  stages,
  currentIndex = 0,
  onCancel
}: {
  stages: string[];
  currentIndex?: number;
  onCancel?: () => void;
}) {
  return (
    <section className="panel loading-skeleton">
      <div role="status" aria-live="polite">
        {stages[currentIndex] ?? stages[0]}
      </div>
      <ol>
        {stages.map((stage, index) => (
          <li key={stage} data-active={index === currentIndex}>
            {stage}
          </li>
        ))}
      </ol>
      <button type="button" className="ghost-button" onClick={onCancel}>
        요청 취소
      </button>
    </section>
  );
}
