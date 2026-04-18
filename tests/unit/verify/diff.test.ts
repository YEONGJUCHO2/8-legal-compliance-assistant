import { describe, expect, test } from "vitest";

import { compareTexts } from "@/lib/verify/diff";

describe("compareTexts", () => {
  test("treats whitespace-only differences as equal", () => {
    const result = compareTexts("사업주는\n필요한  안전조치를 하여야 한다.", "사업주는 필요한 안전조치를 하여야 한다.");

    expect(result).toEqual({
      disagreement: false,
      normalizedEqual: true
    });
  });

  test("reports disagreement when normalized text differs", () => {
    const result = compareTexts("사업주는 필요한 안전조치를 하여야 한다.", "사업주는 강화된 안전조치를 하여야 한다.");

    expect(result.disagreement).toBe(true);
    expect(result.normalizedEqual).toBe(false);
    expect(result.reason).toBe("text_changed");
  });
});
