export function detectSuspiciousDateHint(question: string, referenceDate: string, serverToday = new Date().toISOString().slice(0, 10)) {
  const explicitMatch = question.match(/(20\d{2}년|\b20\d{2}(?:[.\-/]\d{1,2})?(?:[.\-/]\d{1,2})?\b)/);
  const explicitYear = explicitMatch
    ? explicitMatch[0].match(/20\d{2}/)?.[0] ?? null
    : null;
  const relativeMatch = question.match(/(작년|재작년|\d+년 전|지난달|사고 당시|개정 전)/);

  if (explicitYear && explicitYear !== referenceDate.slice(0, 4)) {
    return {
      conflict: true as const,
      reason: "explicit_date_mismatch",
      hint: explicitMatch?.[0]
    };
  }

  if (relativeMatch && referenceDate === serverToday) {
    return {
      conflict: true as const,
      reason: "relative_past_hint",
      hint: relativeMatch[0]
    };
  }

  return {
    conflict: false as const
  };
}
