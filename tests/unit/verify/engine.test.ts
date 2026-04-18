import { describe, expect, test } from "vitest";

import { createKoreanLawMcpClient } from "@/lib/open-law/mcp-client";
import { buildStaleMarks } from "@/lib/verify/stale-mark";
import { verifyCitations } from "@/lib/verify/engine";

import { createVerificationCitations } from "./fixture-data";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Scenario = {
  body?: string;
  snapshotHash?: string;
  latestArticleVersionId?: string | null;
  changeSummary?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  repealedAt?: string | null;
  missing?: boolean;
  throwError?: boolean;
  delayMs?: number;
};

function createFetchImpl(scenarios: Record<string, Scenario>): typeof fetch {
  return async (input) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const articleNo = url.searchParams.get("articleNo") ?? "";
    const scenario = scenarios[articleNo] ?? {};

    if (scenario.delayMs) {
      await sleep(scenario.delayMs);
    }

    if (scenario.throwError) {
      throw new Error(`mcp_down:${articleNo}`);
    }

    if (url.pathname.endsWith("/laws/lookup")) {
      return jsonResponse({
        lawId: "fallback-law",
        title: url.searchParams.get("title")
      });
    }

    if (url.pathname.endsWith("/articles/lookup")) {
      if (scenario.missing) {
        return new Response("not found", { status: 404 });
      }

      return jsonResponse({
        lawId: url.searchParams.get("lawId"),
        articleNo,
        paragraph: url.searchParams.get("paragraph"),
        item: url.searchParams.get("item"),
        body: scenario.body ?? `mcp:${articleNo}`,
        snapshotHash: scenario.snapshotHash ?? `mcp-snap:${articleNo}`,
        latestArticleVersionId: scenario.latestArticleVersionId ?? null,
        changeSummary: scenario.changeSummary ?? null
      });
    }

    return jsonResponse({
      effectiveFrom: scenario.effectiveFrom ?? "2024-01-01",
      effectiveTo: scenario.effectiveTo ?? null,
      repealedAt: scenario.repealedAt ?? null
    });
  };
}

describe("verifyCitations", () => {
  test("verifies matching citations successfully", async () => {
    const citations = createVerificationCitations();
    const fetchImpl = createFetchImpl({
      제10조: { body: citations[0].localBody },
      제4조: { body: citations[1].localBody },
      제15조: { body: citations[2].localBody }
    });
    const client = createKoreanLawMcpClient({
      baseUrl: "https://mcp.example.test",
      fetchImpl
    });

    const result = await verifyCitations(client, {
      citations,
      referenceDate: "2025-01-01",
      budgetMs: 1000
    });

    expect(result.overall).toBe("verified");
    expect(result.partial).toBe(false);
    expect(result.deadlineExpired).toBe(false);
    expect(result.citations.every((citation) => citation.verification_source === "local_only")).toBe(true);
  });

  test("flags disagreement and produces stale marks", async () => {
    const citations = createVerificationCitations();
    const fetchImpl = createFetchImpl({
      제10조: {
        body: "사업주는 강화된 안전조치를 하여야 한다.",
        latestArticleVersionId: "article-version-latest-1",
        changeSummary: "text_changed"
      },
      제4조: { body: citations[1].localBody },
      제15조: { body: citations[2].localBody }
    });
    const client = createKoreanLawMcpClient({
      baseUrl: "https://mcp.example.test",
      fetchImpl
    });

    const result = await verifyCitations(client, {
      citations,
      referenceDate: "2025-01-01",
      budgetMs: 1000
    });
    const marks = buildStaleMarks(result.citations);

    expect(result.overall).toBe("mcp_disagreement");
    expect(result.citations[0]).toMatchObject({
      rendered_from_verification: true,
      verification_source: "mcp",
      disagreement: true
    });
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({
      lawArticleId: "article-1",
      reason: "text_changed"
    });
  });

  test("downgrades missing citations to verification_pending", async () => {
    const citations = createVerificationCitations();
    const fetchImpl = createFetchImpl({
      제10조: { body: citations[0].localBody },
      제4조: { missing: true },
      제15조: { body: citations[2].localBody }
    });
    const client = createKoreanLawMcpClient({
      baseUrl: "https://mcp.example.test",
      fetchImpl
    });

    const result = await verifyCitations(client, {
      citations,
      referenceDate: "2025-01-01",
      budgetMs: 1000
    });

    expect(result.overall).toBe("verification_pending");
    expect(result.citations[1]).toMatchObject({
      verification_source: "missing",
      answerStrengthDowngrade: "verification_pending",
      failureReason: "article_missing"
    });
  });

  test("marks out-of-force citations as conditional", async () => {
    const citations = createVerificationCitations();
    const fetchImpl = createFetchImpl({
      제10조: { body: citations[0].localBody },
      제4조: { body: citations[1].localBody, effectiveTo: "2024-12-31" },
      제15조: { body: citations[2].localBody }
    });
    const client = createKoreanLawMcpClient({
      baseUrl: "https://mcp.example.test",
      fetchImpl
    });

    const result = await verifyCitations(client, {
      citations,
      referenceDate: "2025-01-01",
      budgetMs: 1000
    });

    expect(result.overall).toBe("verified");
    expect(result.citations[1]).toMatchObject({
      inForce: false,
      answerStrengthDowngrade: "conditional"
    });
  });

  test("preempts on deadline budget exhaustion and returns partial verification_pending citations", async () => {
    const citations = Array.from({ length: 10 }, (_, index) => ({
      id: `article-${index + 1}`,
      articleVersionId: `article-version-${index + 1}`,
      lawId: `law-${index + 1}`,
      lawTitle: "산업안전보건법",
      articleNo: `제${index + 1}조`,
      localBody: `본문 ${index + 1}`,
      localSnapshotHash: `local-snap-${index + 1}`,
      localSourceHash: `local-source-${index + 1}`,
      position: index
    }));
    const scenarios = Object.fromEntries(
      citations.map((citation, index) => [
        citation.articleNo,
        {
          body: citation.localBody,
          delayMs: index < 5 ? 220 : 0
        }
      ])
    );
    const fetchImpl = createFetchImpl(scenarios);
    const client = createKoreanLawMcpClient({
      baseUrl: "https://mcp.example.test",
      fetchImpl
    });

    const result = await verifyCitations(client, {
      citations,
      referenceDate: "2025-01-01",
      budgetMs: 250,
      concurrency: 5
    });

    expect(result.partial).toBe(true);
    expect(result.deadlineExpired).toBe(true);
    expect(result.platformTimeoutPreempted).toBe(true);
    expect(result.overall).toBe("verification_pending");
    expect(result.citations.slice(5).every((citation) => citation.answerStrengthDowngrade === "verification_pending")).toBe(
      true
    );
  });

  test("returns degraded on full MCP downtime without misclassifying it as a preempted deadline", async () => {
    const citations = createVerificationCitations();
    const fetchImpl = createFetchImpl({
      제10조: { throwError: true },
      제4조: { throwError: true },
      제15조: { throwError: true }
    });
    const client = createKoreanLawMcpClient({
      baseUrl: "https://mcp.example.test",
      fetchImpl
    });

    const result = await verifyCitations(client, {
      citations,
      referenceDate: "2025-01-01",
      budgetMs: 1000
    });

    expect(result.overall).toBe("degraded");
    expect(result.platformTimeoutPreempted).toBe(false);
    expect(result.citations.every((citation) => citation.answerStrengthDowngrade === "verification_pending")).toBe(
      true
    );
  });
});
