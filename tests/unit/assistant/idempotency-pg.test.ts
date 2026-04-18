import { describe, expect, test } from "vitest";

import { checkIdempotency, computePayloadHash } from "@/lib/assistant/idempotency";
import { createPgIdempotencyStore } from "@/lib/assistant/idempotency-pg";

import { createMockSql } from "../helpers/mock-postgres";

const request = {
  mode: "ask" as const,
  clientRequestId: "req-1",
  question: "프레스 작업 안전조치",
  referenceDate: "2026-04-18"
};

describe("idempotency-pg", () => {
  test("remembers a request and replays the matching payload", async () => {
    const payloadHash = computePayloadHash(request);
    const { sql } = createMockSql([
      (query, params) => {
        expect(query).toContain("INSERT INTO idempotency_records");
        expect(params[0]).toBe("user-1:req-1");
        expect(params[1]).toBe(payloadHash);
        expect(params[2]).toEqual({
          runId: "run-1"
        });
        return [];
      },
      (query, params) => {
        expect(query).toContain("DELETE FROM idempotency_records");
        expect(params[0]).toBe("2026-04-18T01:00:00.000Z");
        return [];
      },
      () => [
        {
          payload_hash: payloadHash,
          response: {
            runId: "run-1"
          },
          expires_at: "2026-04-19T00:00:00.000Z"
        }
      ]
    ]);
    const store = createPgIdempotencyStore({ db: sql });

    await store.remember({
      userId: "user-1",
      clientRequestId: request.clientRequestId,
      payloadHash,
      runId: "run-1",
      expiresAt: "2026-04-19T00:00:00.000Z"
    });

    await expect(checkIdempotency(store, request, "user-1", "2026-04-18T01:00:00.000Z")).resolves.toEqual({
      status: "replay",
      runId: "run-1"
    });
  });

  test("treats expired rows as missing during lookup", async () => {
    const { sql } = createMockSql([
      () => [
        {
          payload_hash: "stale-hash",
          response: {
            runId: "run-stale"
          },
          expires_at: "2026-04-17T23:59:59.000Z"
        }
      ]
    ]);
    const store = createPgIdempotencyStore({ db: sql });

    await expect(store.getExisting("user-1", "req-1", "2026-04-18T00:00:00.000Z")).resolves.toBeNull();
  });
});
