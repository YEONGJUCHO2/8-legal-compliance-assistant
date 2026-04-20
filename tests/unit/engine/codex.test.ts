import { describe, expect, test, vi } from "vitest";

import { createCodexAdapter, CodexDaemonError } from "@/lib/assistant/engine/codex";
import { buildPrompt } from "@/lib/assistant/engine/prompt";
import { createInMemoryEngineSessionStore } from "@/lib/assistant/engine/session-store";
import { engineOutputJsonSchemas } from "@/lib/assistant/schemas";

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("createCodexAdapter", () => {
  test("posts a structured request to the daemon and reuses a stable daemon session handle", async () => {
    const store = createInMemoryEngineSessionStore();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          sessionId: "daemon-session-1",
          schemaRetries: 0,
          response: {
            verified_facts: ["프레스 작업 전 안전장치 점검이 필요하다."],
            conclusion: "방호장치를 확인한 뒤 작업해야 합니다.",
            explanation: "검색된 조문이 사업주의 안전조치 의무를 직접 규정합니다.",
            caution: "설비별 추가 기준은 별도로 확인해야 합니다."
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          sessionId: "daemon-session-1",
          schemaRetries: 0,
          response: {
            verified_facts: ["프레스 작업 전 안전장치 점검이 필요하다."],
            conclusion: "같은 세션으로 이어서 답변했습니다.",
            explanation: "이전 daemon session handle을 그대로 재사용했습니다.",
            caution: "설비별 추가 기준은 별도로 확인해야 합니다."
          }
        })
      );
    const adapter = createCodexAdapter({
      daemonUrl: "http://127.0.0.1:4200",
      deadlineMs: 1000,
      authToken: "codex-daemon-auth-token",
      fetchImpl,
      sessionStore: store,
      now: () => new Date("2026-04-19T00:00:00.000Z")
    });

    const first = await adapter.generate({
      userId: "user-1",
      prompt: createPrompt(),
      schemaRef: "answer"
    });
    const second = await adapter.generate({
      userId: "user-1",
      sessionId: first.sessionId,
      prompt: createPrompt(),
      schemaRef: "answer"
    });

    const [, firstRequest] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const [, secondRequest] = fetchImpl.mock.calls[1] as [string, RequestInit];
    const firstBody = JSON.parse(String(firstRequest.body)) as {
      prompt: string;
      schemaRef: string;
      schema: unknown;
      sessionId: string;
    };
    const secondBody = JSON.parse(String(secondRequest.body)) as {
      sessionId: string;
    };

    expect(first.response).toMatchObject({
      conclusion: "방호장치를 확인한 뒤 작업해야 합니다."
    });
    expect(second.response).toMatchObject({
      conclusion: "같은 세션으로 이어서 답변했습니다."
    });
    expect(first.sessionId).toBe(second.sessionId);
    expect(firstBody.prompt).toContain("SYSTEM");
    expect(firstBody.prompt).toContain("USER");
    expect(firstBody.schemaRef).toBe("answer");
    expect(firstBody.schema).toEqual(engineOutputJsonSchemas.answer);
    expect(firstBody.sessionId).toBeTruthy();
    expect(firstRequest.headers).toMatchObject({
      Authorization: "Bearer codex-daemon-auth-token"
    });
    expect(secondBody.sessionId).toBe(firstBody.sessionId);
  });

  test("returns a schema_error response when the daemon reports schema_error", async () => {
    const adapter = createCodexAdapter({
      daemonUrl: "http://127.0.0.1:4200",
      deadlineMs: 1000,
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "schema_error",
              message: "Engine response did not satisfy the required schema after one retry."
            }
          },
          422
        )
      ),
      sessionStore: createInMemoryEngineSessionStore()
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

  test("throws CodexDaemonError when the daemon is busy", async () => {
    const adapter = createCodexAdapter({
      daemonUrl: "http://127.0.0.1:4200",
      deadlineMs: 1000,
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "engine_busy",
              message: "codex daemon queue is full"
            }
          },
          503
        )
      ),
      sessionStore: createInMemoryEngineSessionStore()
    });

    await expect(
      adapter.generate({
        userId: "user-1",
        prompt: createPrompt(),
        schemaRef: "answer"
      })
    ).rejects.toMatchObject({
      code: "engine_busy",
      message: "codex daemon queue is full"
    });
  });

  test("maps aborted fetches to engine_timeout", async () => {
    const adapter = createCodexAdapter({
      daemonUrl: "http://127.0.0.1:4200",
      deadlineMs: 1000,
      fetchImpl: vi.fn(async () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      }),
      sessionStore: createInMemoryEngineSessionStore()
    });

    await expect(
      adapter.generate({
        userId: "user-1",
        prompt: createPrompt(),
        schemaRef: "answer"
      })
    ).rejects.toMatchObject({
      code: "engine_timeout",
      message: "engine_timeout"
    });
  });
});
