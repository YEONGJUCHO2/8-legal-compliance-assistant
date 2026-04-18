import type { AnswerEnvelope } from "@/lib/assistant/ask-schema";

const labels: Record<AnswerEnvelope["strength"], string> = {
  clear: "답변 강도: 명확",
  conditional: "답변 강도: 조건부 판단",
  verification_pending: "답변 강도: 검증 지연"
};

export function StrengthBadge({ strength }: { strength: AnswerEnvelope["strength"] }) {
  return (
    <span className={`strength-badge strength-${strength}`} data-strength={strength}>
      {labels[strength]}
    </span>
  );
}
