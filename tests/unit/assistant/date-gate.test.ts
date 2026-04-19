import { describe, expect, test } from "vitest";

import { detectSuspiciousDateHint } from "@/lib/assistant/date-gate";

describe("detectSuspiciousDateHint", () => {
  test("flags explicit past-year conflicts against a current reference date", () => {
    const result = detectSuspiciousDateHint("2024년 기준으로 안전조치 의무가 궁금합니다.", "2026-04-18", "2026-04-18");

    expect(result).toEqual({
      conflict: true,
      reason: "explicit_date_mismatch",
      hint: "2024년"
    });
  });

  test("flags relative past-date hints when referenceDate is today-like", () => {
    const result = detectSuspiciousDateHint("작년 사고 당시 기준으로 알려줘", "2026-04-18", "2026-04-18");

    expect(result.conflict).toBe(true);
    expect(result.reason).toBe("relative_past_hint");
    expect(result.hint).toBe("작년");
  });

  test.each(["어제", "최근", "요즘"])("flags %s as a relative phrase", (phrase) => {
    const result = detectSuspiciousDateHint(`${phrase} 기준으로 알려줘`, "2026-04-18", "2026-04-18");

    expect(result).toEqual({
      conflict: true,
      reason: "relative_past_hint",
      hint: phrase
    });
  });

  test("returns no conflict when the detected year matches the reference date", () => {
    const result = detectSuspiciousDateHint("2026년 기준으로 알려줘", "2026-04-18", "2026-04-18");

    expect(result).toEqual({
      conflict: false
    });
  });
});
