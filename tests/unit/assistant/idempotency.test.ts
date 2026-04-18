import { describe, expect, test } from "vitest";

import {
  checkIdempotency,
  computePayloadHash,
  createInMemoryIdempotencyStore
} from "@/lib/assistant/idempotency";

const request = {
  mode: "ask" as const,
  clientRequestId: "req-1",
  question: "프레스 작업 안전조치",
  referenceDate: "2026-04-18"
};

describe("idempotency", () => {
  test("hashes payloads stably", () => {
    expect(
      computePayloadHash({
        referenceDate: "2026-04-18",
        question: "프레스 작업 안전조치",
        mode: "ask",
        clientRequestId: "req-1"
      })
    ).toBe(computePayloadHash(request));
  });

  test("returns fresh, replay, and conflict states", async () => {
    const store = createInMemoryIdempotencyStore();
    const fresh = await checkIdempotency(store, request, "user-1", "2026-04-18T00:00:00.000Z");

    expect(fresh).toEqual({
      status: "fresh"
    });

    await store.remember({
      userId: "user-1",
      clientRequestId: request.clientRequestId,
      payloadHash: computePayloadHash(request),
      runId: "run-1",
      expiresAt: "2026-04-19T00:00:00.000Z"
    });

    await expect(checkIdempotency(store, request, "user-1", "2026-04-18T01:00:00.000Z")).resolves.toEqual({
      status: "replay",
      runId: "run-1"
    });

    await expect(
      checkIdempotency(
        store,
        {
          ...request,
          question: "중처법 의무"
        },
        "user-1",
        "2026-04-18T01:00:00.000Z"
      )
    ).resolves.toEqual({
      status: "conflict"
    });
  });
});
