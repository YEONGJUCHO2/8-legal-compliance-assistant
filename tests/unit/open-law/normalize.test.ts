import { describe, expect, test } from "vitest";

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
});
