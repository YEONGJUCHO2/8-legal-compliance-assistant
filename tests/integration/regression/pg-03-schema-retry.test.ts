// @vitest-environment node

import { describe, expect, test, vi } from "vitest";

import { createAnthropicAdapter } from "@/lib/assistant/engine/anthropic";
import { createInMemoryEngineSessionStore } from "@/lib/assistant/engine/session-store";
import { runQuery } from "@/lib/assistant/run-query";

import { REGRESSION_ALLOWED_KINDS, createRegressionDeps } from "./helpers";

function createAnthropicResponse(text: string) {
  return new Response(
    JSON.stringify({
      content: [
        {
          type: "text",
          text
        }
      ]
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    }
  );
}

describe("pg-03-schema-retry", () => {
  test("returns answer after one schema retry and persists schema_retry_count = 1", async () => {
    const sessionStore = createInMemoryEngineSessionStore();
    const { user, deps, historyStore } = await createRegressionDeps({
      engine: createAnthropicAdapter({
        apiKey: "test",
        sessionStore,
        fetchImpl: vi
          .fn()
          .mockResolvedValueOnce(createAnthropicResponse(JSON.stringify({ invalid: true })))
          .mockResolvedValueOnce(
            createAnthropicResponse(
              JSON.stringify({
                verified_facts: ["프레스 작업 전 방호장치를 점검해야 합니다."],
                conclusion: "점검 후 작업해야 합니다.",
                explanation: "관련 조문이 안전조치를 요구합니다.",
                caution: "설비별 점검표를 확인하세요."
              })
            )
          )
      }),
      engineSessionStore: sessionStore
    });

    const response = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "req-schema-retry-success",
        question: "산안법 제10조 안전조치",
        referenceDate: "2026-04-18"
      },
      user,
      deps,
      now: "2026-04-18T00:00:00.000Z"
    });

    expect(REGRESSION_ALLOWED_KINDS).toContain(response.kind);
    expect(response.kind).toBe("answer");
    if (response.kind !== "answer") {
      throw new Error("expected answer after a single schema retry");
    }

    const row = await historyStore.getRun(response.runId);
    expect(row?.schema_retry_count).toBe(1);
  });

  test("returns schema_error after two invalid outputs with no free-text fallback", async () => {
    const sessionStore = createInMemoryEngineSessionStore();
    const { user, deps, historyStore } = await createRegressionDeps({
      engine: createAnthropicAdapter({
        apiKey: "test",
        sessionStore,
        fetchImpl: vi
          .fn()
          .mockResolvedValueOnce(createAnthropicResponse(JSON.stringify({ invalid: true })))
          .mockResolvedValueOnce(createAnthropicResponse(JSON.stringify({ still_invalid: true })))
      }),
      engineSessionStore: sessionStore
    });

    const response = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "req-schema-retry-fail",
        question: "산안법 제10조 안전조치",
        referenceDate: "2026-04-18"
      },
      user,
      deps,
      now: "2026-04-18T00:00:00.000Z"
    });

    expect(REGRESSION_ALLOWED_KINDS).toContain(response.kind);
    expect(response.kind).toBe("schema_error");
    if (response.kind !== "schema_error") {
      throw new Error("expected schema_error after two invalid outputs");
    }
    expect(response.schemaRetryCount).toBe(2);

    const row = await historyStore.getRun(response.runId);
    expect(row?.schema_retry_count).toBeGreaterThanOrEqual(2);
  });
});
