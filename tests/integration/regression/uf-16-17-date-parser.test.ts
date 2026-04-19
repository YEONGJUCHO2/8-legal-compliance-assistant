// @vitest-environment node

import { describe, expect, test } from "vitest";

import { detectSuspiciousDateHint } from "@/lib/assistant/date-gate";

describe("uf-16-17-date-parser", () => {
  test.each(["2024-03-01", "2024년 3월 1일", "2024년 3월", "2024.03.01", "2024/03/01"])(
    "treats supported absolute Korean date forms as aligned when the reference year matches: %s",
    (questionDate) => {
      expect(detectSuspiciousDateHint(`${questionDate} 기준 의무`, "2024-03-01", "2026-04-18")).toEqual({
        conflict: false
      });
    }
  );

  test.each(["2024-03-01", "2024년 3월 1일", "2024년 3월", "2024.03.01", "2024/03/01"])(
    "flags supported absolute date forms when the reference year differs: %s",
    (questionDate) => {
      expect(detectSuspiciousDateHint(`${questionDate} 기준 의무`, "2026-04-18", "2026-04-18")).toMatchObject({
        conflict: true,
        reason: "explicit_date_mismatch"
      });
    }
  );

  test.each(["지난달", "사고 당시", "작년"])("flags supported relative past phrases without auto-converting them: %s", (phrase) => {
    expect(detectSuspiciousDateHint(`${phrase} 기준 의무`, "2026-04-18", "2026-04-18")).toMatchObject({
      conflict: true,
      reason: "relative_past_hint",
      hint: phrase
    });
  });

  test("flags mixed absolute and relative phrases", () => {
    expect(detectSuspiciousDateHint("2024-03-01 사고 당시 상황", "2026-04-18", "2026-04-18")).toMatchObject({
      conflict: true,
      reason: "explicit_date_mismatch",
      hint: "2024-03-01"
    });
  });

  test.todo("flags '어제' as a relative phrase without auto-converting it");
  test.todo("flags '최근' as a relative phrase without auto-converting it");
  test.todo("flags '요즘' as a relative phrase without auto-converting it");
});
