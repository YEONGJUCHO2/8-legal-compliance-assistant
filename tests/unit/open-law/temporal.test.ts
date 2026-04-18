import { describe, expect, test } from "vitest";

import {
  isFutureEffective,
  isInForce,
  recordVersionRollover
} from "@/lib/open-law/temporal";

describe("open-law temporal helpers", () => {
  test("detects in-force windows", () => {
    expect(
      isInForce(
        { effectiveFrom: "2024-01-01", effectiveTo: null, repealedAt: null },
        "2025-01-01"
      )
    ).toBe(true);
  });

  test("respects repeal gaps", () => {
    expect(
      isInForce(
        { effectiveFrom: "2024-01-01", effectiveTo: "2024-06-01", repealedAt: "2024-06-01" },
        "2024-06-10"
      )
    ).toBe(false);
  });

  test("flags future-effective text", () => {
    expect(isFutureEffective({ effectiveFrom: "2025-01-01" }, "2024-12-31")).toBe(true);
  });

  test("creates a new version row when content changes or text is reinstated", () => {
    const rollover = recordVersionRollover(
      {
        id: "article-1",
        body: "이전 본문",
        contentHash: "old-hash",
        version: 2,
        effectiveFrom: "2024-01-01",
        effectiveTo: "2024-06-01",
        repealedAt: "2024-06-01"
      },
      "새 본문",
      {
        effectiveFrom: "2024-07-01"
      }
    );

    expect(rollover.changed).toBe(true);
    expect(rollover.nextArticle.version).toBe(3);
    expect(rollover.nextArticle.repealedAt).toBeNull();
    expect(rollover.newVersionRow).toMatchObject({
      articleId: "article-1",
      version: 3,
      effectiveFrom: "2024-07-01"
    });
  });
});
