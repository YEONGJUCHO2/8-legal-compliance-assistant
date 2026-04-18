import { describe, expect, test } from "vitest";

import { buildCitationPersistence } from "@/lib/verify/persist";

import { createVerifiedCitation } from "./fixture-data";

describe("buildCitationPersistence", () => {
  test("maps verified citations into question-history citation rows", () => {
    const rows = buildCitationPersistence([
      createVerifiedCitation(),
      createVerifiedCitation({
        id: "article-2",
        articleVersionId: "article-version-2",
        position: 1,
        verification_source: "mcp",
        rendered_from_verification: true,
        disagreement: true,
        mcpBody: "사업주는 강화된 안전조치를 하여야 한다.",
        latestArticleVersionId: "article-version-latest-2",
        changedSummary: "text_changed"
      }),
      createVerifiedCitation({
        id: "article-3",
        articleVersionId: "article-version-3",
        position: 2,
        verification_source: "missing",
        verifiedAt: null,
        failureReason: "article_missing"
      })
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      article_id: "article-1",
      article_version_id: "article-version-1",
      quote: "사업주는 필요한 안전조치를 하여야 한다.",
      verification_source: "local",
      mcp_disagreement: false
    });
    expect(rows[1]).toMatchObject({
      article_id: "article-2",
      quote: "사업주는 강화된 안전조치를 하여야 한다.",
      verification_source: "mcp",
      mcp_disagreement: true,
      latest_article_version_id: "article-version-latest-2",
      changed_summary: "text_changed"
    });
    expect(rows[2]).toMatchObject({
      article_id: "article-3",
      verification_source: "local",
      changed_summary: "article_missing"
    });
  });
});
