import { describe, expect, test } from "vitest";

import { buildStaleMarks } from "@/lib/verify/stale-mark";

import { createVerifiedCitation } from "./fixture-data";

describe("buildStaleMarks", () => {
  test("marks disagreement and missing citations as stale", () => {
    const marks = buildStaleMarks([
      createVerifiedCitation(),
      createVerifiedCitation({
        id: "article-2",
        lawId: "law-2",
        localSnapshotHash: "local-snap-2",
        disagreement: true,
        verification_source: "mcp",
        failureReason: "text_changed"
      }),
      createVerifiedCitation({
        id: "article-3",
        lawId: "law-3",
        localSnapshotHash: "local-snap-3",
        verification_source: "missing",
        failureReason: "article_missing"
      })
    ]);

    expect(marks).toEqual([
      {
        lawArticleId: "article-2",
        lawId: "law-2",
        snapshotHash: "local-snap-2",
        reason: "text_changed"
      },
      {
        lawArticleId: "article-3",
        lawId: "law-3",
        snapshotHash: "local-snap-3",
        reason: "article_missing"
      }
    ]);
  });
});
