import { isInForce } from "@/lib/open-law/temporal";
import { MCPNotFoundError, type KoreanLawMcpClient } from "@/lib/open-law/mcp-client";

import { createDeadline } from "./deadline";
import { compareTexts } from "./diff";
import type { CitationToVerify, VerificationInput, VerificationOutput, VerifiedCitation } from "./types";

const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 6;
const DEFAULT_SAFETY_MARGIN_MS = 100;

function createPendingCitation(citation: CitationToVerify, reason: string): VerifiedCitation {
  return {
    ...citation,
    verification_source: "missing",
    rendered_from_verification: false,
    disagreement: false,
    inForce: false,
    answerStrengthDowngrade: "verification_pending",
    verifiedAt: null,
    failureReason: reason,
    latestArticleVersionId: null,
    changedSummary: null
  };
}

async function verifyOneCitation(
  client: KoreanLawMcpClient,
  citation: CitationToVerify,
  referenceDate: string
): Promise<VerifiedCitation> {
  try {
    const [article, effectiveRange] = await Promise.all([
      client.lookupArticle({
        lawId: citation.lawId,
        articleNo: citation.articleNo,
        paragraph: citation.paragraph,
        item: citation.item
      }),
      client.queryEffectiveDate({
        lawId: citation.lawId,
        articleNo: citation.articleNo,
        referenceDate
      })
    ]);
    const compared = compareTexts(citation.localBody, article.body);
    const inForce = isInForce(
      {
        effectiveFrom: effectiveRange.effectiveFrom,
        effectiveTo: effectiveRange.effectiveTo,
        repealedAt: effectiveRange.repealedAt
      },
      referenceDate
    );

    return {
      ...citation,
      verification_source: compared.disagreement ? "mcp" : "local_only",
      rendered_from_verification: compared.disagreement,
      disagreement: compared.disagreement,
      mcpBody: compared.disagreement ? article.body : undefined,
      mcpSnapshotHash: compared.disagreement ? article.snapshotHash : undefined,
      inForce,
      answerStrengthDowngrade: compared.disagreement || !inForce ? "conditional" : undefined,
      verifiedAt: new Date().toISOString(),
      failureReason: compared.reason,
      latestArticleVersionId: article.latestArticleVersionId ?? null,
      changedSummary: compared.disagreement ? article.changeSummary ?? compared.reason ?? null : null
    };
  } catch (error) {
    if (error instanceof MCPNotFoundError) {
      return {
        ...createPendingCitation(citation, "article_missing"),
        changedSummary: "article_missing"
      };
    }

    return {
      ...createPendingCitation(citation, error instanceof Error ? error.message : "mcp_error"),
      changedSummary: error instanceof Error ? error.message : "mcp_error"
    };
  }
}

function computeOverall(citations: VerifiedCitation[], partial: boolean): VerificationOutput["overall"] {
  if (citations.some((citation) => citation.disagreement)) {
    return "mcp_disagreement";
  }

  const transportFailureCount = citations.filter(
    (citation) =>
      citation.answerStrengthDowngrade === "verification_pending" &&
      citation.failureReason !== undefined &&
      citation.failureReason !== "article_missing" &&
      citation.failureReason !== "deadline_budget_exhausted"
  ).length;

  if (transportFailureCount >= Math.ceil(citations.length / 2)) {
    return "degraded";
  }

  if (
    partial ||
    citations.some((citation) => citation.answerStrengthDowngrade === "verification_pending")
  ) {
    return "verification_pending";
  }

  return "verified";
}

export async function verifyCitations(
  client: KoreanLawMcpClient,
  input: VerificationInput
): Promise<VerificationOutput> {
  const concurrency = Math.min(Math.max(input.concurrency ?? DEFAULT_CONCURRENCY, 1), MAX_CONCURRENCY);
  const deadline = createDeadline({
    totalMs: input.budgetMs,
    safetyMarginMs: input.safetyMarginMs ?? DEFAULT_SAFETY_MARGIN_MS
  });
  const results: Array<VerifiedCitation | undefined> = new Array(input.citations.length);
  let nextIndex = 0;
  let partial = false;
  let deadlineExpired = false;
  let platformTimeoutPreempted = false;

  const markRemainingAsPending = (startIndex: number) => {
    for (let index = startIndex; index < input.citations.length; index += 1) {
      if (!results[index]) {
        results[index] = createPendingCitation(input.citations[index], "deadline_budget_exhausted");
      }
    }
  };

  const acquireNextIndex = () => {
    if (nextIndex >= input.citations.length) {
      return null;
    }

    if (deadline.shouldPreempt()) {
      platformTimeoutPreempted = true;
      deadlineExpired = true;
      partial = true;
      const startIndex = nextIndex;
      nextIndex = input.citations.length;
      markRemainingAsPending(startIndex);
      return null;
    }

    const currentIndex = nextIndex;
    nextIndex += 1;
    return currentIndex;
  };

  const workers = Array.from({ length: Math.min(concurrency, input.citations.length) }, async () => {
    while (true) {
      const index = acquireNextIndex();

      if (index === null) {
        return;
      }

      results[index] = await verifyOneCitation(client, input.citations[index], input.referenceDate);
    }
  });

  await Promise.all(workers);

  const citations = results.map((citation, index) =>
    citation ?? createPendingCitation(input.citations[index], "deadline_budget_exhausted")
  );

  if (!deadlineExpired && deadline.expired()) {
    deadlineExpired = true;
  }

  if (!partial) {
    const verifiedCount = citations.filter((citation) => citation.verifiedAt !== null).length;
    partial = verifiedCount > 0 && verifiedCount < citations.length;
  }

  return {
    citations,
    overall: computeOverall(citations, partial),
    partial,
    deadlineExpired,
    platformTimeoutPreempted
  };
}
