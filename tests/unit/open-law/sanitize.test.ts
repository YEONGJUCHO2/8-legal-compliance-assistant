// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test, vi } from "vitest";

import * as sanitizeModule from "@/lib/open-law/sanitize";
import { parseLawDetail } from "@/lib/open-law/xml";

const fixturesDir = path.join(process.cwd(), "tests", "fixtures", "open-law");

describe("open-law sanitization", () => {
  test("removes executable payloads, amendment reasons, and disallowed markup", async () => {
    const xml = await readFile(path.join(fixturesDir, "malicious-corpus.xml"), "utf8");
    const detail = parseLawDetail(xml);
    const dropSpy = vi
      .spyOn(sanitizeModule.sanitizationHooks, "onDrop")
      .mockImplementation(() => undefined);

    const sanitized = sanitizeModule.sanitizeLawText(detail.articles[0].body);

    expect(sanitized).toContain("정상 문장");
    expect(sanitized).not.toMatch(/script|iframe|data:text\/html|개정이유|onerror/i);
    expect(sanitizeModule.ALLOWED_TEXT_PATTERN.test(sanitized)).toBe(true);
    expect(dropSpy).toHaveBeenCalled();
  });

  test("strips control characters and keeps content hash stable", () => {
    const raw = "안전\u0007보건 교육";
    const dropSpy = vi
      .spyOn(sanitizeModule.sanitizationHooks, "onDrop")
      .mockImplementation(() => undefined);

    const sanitized = sanitizeModule.sanitizeLawText(raw);
    const hashA = sanitizeModule.computeContentHash(sanitized);
    const hashB = sanitizeModule.computeContentHash(sanitizeModule.sanitizeLawText(raw));

    expect(sanitized).toBe("안전보건 교육");
    expect(hashA).toBe(hashB);
    expect(sanitizeModule.computeSourceHash("<law />")).toMatch(/^[a-f0-9]{64}$/);
    expect(dropSpy).toHaveBeenCalled();
  });
});
