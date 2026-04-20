import { describe, expect, test } from "vitest";

import { MVP_LAW_TITLES } from "@/lib/open-law/mvp-corpus";
import {
  ALIAS_DICTIONARY,
  normalizeTitle,
  resolveAlias
} from "@/lib/open-law/normalize";

describe("open-law title normalization", () => {
  test("normalizes punctuation, whitespace, and parenthesis spacing", () => {
    expect(normalizeTitle("  산업안전보건법 · 시행령  ")).toBe("산업안전보건법 시행령");
    expect(normalizeTitle("중대재해 처벌 등에 관한 법률( 시행령 )")).toBe(
      "중대재해 처벌 등에 관한 법률 (시행령)"
    );
  });

  test("resolves normalized aliases to canonical law titles", () => {
    expect(resolveAlias("산안법")).toBe("산업안전보건법");
    expect(resolveAlias("중처법")).toBe("중대재해 처벌 등에 관한 법률");
    expect(resolveAlias("안전보건기준")).toBe("산업안전보건기준에 관한 규칙");
    expect(ALIAS_DICTIONARY[normalizeTitle("산안법").toLowerCase()]).toBe("산업안전보건법");
  });

  test("extends the MVP corpus with qualification and construction law coverage", () => {
    expect(MVP_LAW_TITLES).toContain("유해·위험작업의 취업 제한에 관한 규칙");
    expect(MVP_LAW_TITLES).toContain("건설기술 진흥법");
    expect(MVP_LAW_TITLES).toContain("건설기술 진흥법 시행령");
    expect(MVP_LAW_TITLES).toContain("근로기준법");
    expect(MVP_LAW_TITLES).not.toContain("산업안전보건교육규정");
  });

  test("resolves new aliases for qualification and construction titles", () => {
    expect(resolveAlias("유해위험작업 취업제한 규칙")).toBe("유해·위험작업의 취업 제한에 관한 규칙");
    expect(resolveAlias("유해ㆍ위험작업의 취업 제한에 관한 규칙")).toBe("유해·위험작업의 취업 제한에 관한 규칙");
    expect(resolveAlias("건진법")).toBe("건설기술 진흥법");
    expect(resolveAlias("건진법 시행령")).toBe("건설기술 진흥법 시행령");
    expect(resolveAlias("근기법")).toBe("근로기준법");
  });
});
