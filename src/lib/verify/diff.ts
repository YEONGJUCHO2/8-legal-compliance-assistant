function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function compareTexts(local: string, mcp: string) {
  const normalizedLocal = normalizeText(local);
  const normalizedMcp = normalizeText(mcp);
  const normalizedEqual = normalizedLocal === normalizedMcp;

  return {
    disagreement: !normalizedEqual,
    normalizedEqual,
    reason: normalizedEqual ? undefined : "text_changed"
  };
}
