// @vitest-environment node

import { describe, expect, test } from "vitest";

import { verifyCitations } from "@/lib/verify/engine";
import type { CitationToVerify } from "@/lib/verify/types";

import { createDeterministicMcpClient } from "./helpers";

function createCitationBatch(size: number): CitationToVerify[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `article-${index + 1}`,
    articleVersionId: `article-version-${index + 1}`,
    lawId: `law-${index + 1}`,
    lawTitle: "산업안전보건법",
    articleNo: `제${index + 1}조`,
    localBody: `제${index + 1}조 본문`,
    localSnapshotHash: `snap-${index + 1}`,
    localSourceHash: `source-${index + 1}`,
    position: index
  }));
}

describe("verification-parallelism", () => {
  test("keeps 10 citations under budget when MCP calls are fast", async () => {
    const citations = createCitationBatch(10);
    const client = createDeterministicMcpClient({
      lookupArticleDelayMs: 5,
      queryEffectiveDateDelayMs: 5
    });
    const startedAt = Date.now();

    const result = await verifyCitations(client, {
      citations,
      referenceDate: "2026-04-18",
      budgetMs: 5000
    });

    const elapsedMs = Date.now() - startedAt;

    expect(result.overall).toBe("verified");
    expect(result.partial).toBe(false);
    expect(elapsedMs).toBeLessThan(5000);
  });

  test("downgrades slow MCP paths when the budget is exhausted", async () => {
    const citations = createCitationBatch(10);
    const client = createDeterministicMcpClient({
      lookupArticleDelayMs: 300,
      queryEffectiveDateDelayMs: 300
    });

    const result = await verifyCitations(client, {
      citations,
      referenceDate: "2026-04-18",
      budgetMs: 100
    });

    expect(["verification_pending", "degraded"]).toContain(result.overall);
  });

  test("characterizes current verification as parallel by staying inside a 200ms budget", async () => {
    const citations = createCitationBatch(10);
    const client = createDeterministicMcpClient({
      lookupArticleDelayMs: 50,
      queryEffectiveDateDelayMs: 50
    });
    const startedAt = Date.now();

    const result = await verifyCitations(client, {
      citations,
      referenceDate: "2026-04-18",
      budgetMs: 200
    });

    const elapsedMs = Date.now() - startedAt;

    expect(result.overall).toBe("verified");
    expect(result.partial).toBe(false);
    expect(elapsedMs).toBeLessThan(250);
  });
});
