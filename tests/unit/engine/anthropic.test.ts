import { describe, expect, test, vi } from "vitest";

import { createAnthropicAdapter, EngineTransportError } from "@/lib/assistant/engine/anthropic";
import { buildPrompt } from "@/lib/assistant/engine/prompt";
import { createInMemoryEngineSessionStore } from "@/lib/assistant/engine/session-store";

import { createFixtureRetrieval } from "./fixture-data";

function createPrompt() {
  return buildPrompt({
    userQuestion: "프레스 작업 시 필요한 안전조치는 무엇인가요?",
    referenceDate: "2025-01-01",
    retrieval: createFixtureRetrieval(),
    schemaRef: "answer",
    intent: "answer"
  });
}

function createAnthropicResponse(text: string, status = 200) {
  return new Response(
    JSON.stringify({
      id: "msg_123",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "text",
          text
        }
      ]
    }),
    {
      status,
      headers: {
        "content-type": "application/json"
      }
    }
  );
}

describe("createAnthropicAdapter", () => {
  test("returns a validated response on success", async () => {
    const store = createInMemoryEngineSessionStore();
    const fetchImpl = vi.fn(async () =>
      createAnthropicResponse(
        JSON.stringify({
          verified_facts: ["프레스 작업 전 안전장치 점검이 필요하다."],
          conclusion: "안전장치 점검과 작업표준 준수가 필요합니다.",
          explanation: "제공된 조문은 사업주의 안전조치 의무를 요구합니다.",
          caution: "설비 유형과 공정에 따라 추가 의무가 있을 수 있습니다."
        })
      )
    );
    const adapter = createAnthropicAdapter({
      apiKey: "anthropic-key",
      fetchImpl,
      sessionStore: store
    });

    const result = await adapter.generate({
      userId: "user-1",
      prompt: createPrompt(),
      schemaRef: "answer"
    });

    expect(result.schemaRetries).toBe(0);
    expect(result.sessionId).toBeTruthy();
    expect(result.response).toMatchObject({
      conclusion: "안전장치 점검과 작업표준 준수가 필요합니다."
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("retries once after a schema validation failure and then succeeds", async () => {
    const store = createInMemoryEngineSessionStore();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(createAnthropicResponse(JSON.stringify({ invalid: true })))
      .mockResolvedValueOnce(
        createAnthropicResponse(
          JSON.stringify({
            verified_facts: ["프레스 작업 전 방호장치 확인"],
            conclusion: "방호장치 확인 후 작업해야 합니다.",
            explanation: "검색된 조문이 안전조치 의무를 직접 규정합니다.",
            caution: "현장별 추가 기준을 별도 확인하세요."
          })
        )
      );
    const adapter = createAnthropicAdapter({
      apiKey: "anthropic-key",
      fetchImpl,
      sessionStore: store
    });

    const result = await adapter.generate({
      userId: "user-1",
      prompt: createPrompt(),
      schemaRef: "answer"
    });

    const [, secondRequest] = fetchImpl.mock.calls[1] as [string, RequestInit];
    const secondBody = JSON.parse(String(secondRequest.body)) as {
      system: string;
    };

    expect(result.schemaRetries).toBe(1);
    expect(result.response).toMatchObject({
      conclusion: "방호장치 확인 후 작업해야 합니다."
    });
    expect(secondBody.system).toContain("Previous response violated the required JSON schema");
  });

  test("returns schema_error after a second schema failure", async () => {
    const store = createInMemoryEngineSessionStore();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(createAnthropicResponse(JSON.stringify({ invalid: true })))
      .mockResolvedValueOnce(createAnthropicResponse(JSON.stringify({ still_invalid: true })));
    const adapter = createAnthropicAdapter({
      apiKey: "anthropic-key",
      fetchImpl,
      sessionStore: store
    });

    const result = await adapter.generate({
      userId: "user-1",
      prompt: createPrompt(),
      schemaRef: "answer"
    });

    expect(result.schemaRetries).toBe(2);
    expect(result.response).toEqual({
      type: "schema_error",
      message: "Engine response did not satisfy the required schema after one retry.",
      schema_retry_count: 2
    });
  });

  test("throws EngineTransportError on non-2xx responses", async () => {
    const store = createInMemoryEngineSessionStore();
    const fetchImpl = vi.fn(async () => createAnthropicResponse("upstream failure", 503));
    const adapter = createAnthropicAdapter({
      apiKey: "anthropic-key",
      fetchImpl,
      sessionStore: store
    });

    await expect(
      adapter.generate({
        userId: "user-1",
        prompt: createPrompt(),
        schemaRef: "answer"
      })
    ).rejects.toBeInstanceOf(EngineTransportError);
  });
});
