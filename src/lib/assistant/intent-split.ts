function normalizeSplitText(question: string) {
  return question
    .replace(/\s+/g, " ")
    .replace(/[;·]/g, ",")
    .trim();
}

export function splitIntents(question: string) {
  const normalized = normalizeSplitText(question);
  const segments = normalized
    .split(/(?:,\s*|\s+)(?:그리고|또한|추가로|또)\s+|,\s*|\n+/)
    .map((segment) => segment.trim().replace(/[.。]+$/g, ""))
    .filter(Boolean)
    .slice(0, 3);

  if (segments.length === 0) {
    return [
      {
        id: "intent-1",
        subQuestion: normalized
      }
    ];
  }

  return segments.map((segment, index) => ({
    id: `intent-${index + 1}`,
    subQuestion: segment
  }));
}
