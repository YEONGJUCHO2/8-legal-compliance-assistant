// @vitest-environment node

import { describe, expect, test } from "vitest";

import { runQuery } from "@/lib/assistant/run-query";

import { MALICIOUS_CITATION_PAYLOADS } from "./fixtures/malicious-corpus";
import { REGRESSION_ALLOWED_KINDS, createDeterministicMcpClient, createRegressionDeps } from "./helpers";

describe("malicious-corpus", () => {
  test("keeps structured output stable even when citation bodies contain prompt injection strings", async () => {
    const payloadByArticleNo = Object.fromEntries(
      MALICIOUS_CITATION_PAYLOADS.map((payload, index) => [`제${index + 1}조`, payload])
    );
    const { user, deps } = await createRegressionDeps({
      mcp: createDeterministicMcpClient({
        articleBody: (articleNo) => payloadByArticleNo[articleNo] ?? `${articleNo} 본문`
      })
    });

    deps.retrieveFn = async () =>
      ({
        candidates: MALICIOUS_CITATION_PAYLOADS.map((payload, index) => ({
          article_id: `inj-${index + 1}`,
          article_version_id: `inj-${index + 1}-v1`,
          law_id: "law-inj",
          law_title: "산업안전보건법",
          article_no: `제${index + 1}조`,
          paragraph: null,
          item: null,
          kind: "article",
          body: payload,
          snippet: payload,
          effective_from: "2024-01-01",
          effective_to: null,
          repealed_at: null,
          snapshot_hash: `inj-snap-${index + 1}`,
          source_hash: `inj-source-${index + 1}`,
          score: 1,
          score_components: {
            lexical: 1
          }
        })),
        strategy: "targeted_cache",
        emitted_disagreement_capable: true,
        weak: "strong"
      }) as never;

    const response = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "req-malicious-corpus",
        question: "산안법 제10조 안전조치",
        referenceDate: "2026-04-18"
      },
      user,
      deps,
      now: "2026-04-18T00:00:00.000Z"
    });

    expect(REGRESSION_ALLOWED_KINDS).toContain(response.kind);

    const answer =
      response.kind === "answer" ? response : response.kind === "verification_pending" ? response.answer : undefined;

    expect(answer).toBeDefined();
    for (const payload of MALICIOUS_CITATION_PAYLOADS) {
      expect(answer?.conclusion.includes(payload)).toBe(false);
      expect(answer?.verifiedFacts.some((fact) => fact.includes(payload))).toBe(false);
    }
  });
});
