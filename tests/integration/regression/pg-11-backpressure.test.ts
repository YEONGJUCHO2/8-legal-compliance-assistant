// @vitest-environment node

import { describe, expect, test } from "vitest";

import { runQuery } from "@/lib/assistant/run-query";
import { createInMemoryRateLimitStore } from "@/lib/rate-limit";

import { createRegressionDeps } from "./helpers";

describe("pg-11-backpressure", () => {
  test("returns the documented rate_limited envelope fields when the bucket is exhausted immediately", async () => {
    const { user, deps } = await createRegressionDeps({
      rateLimitStore: createInMemoryRateLimitStore({
        capacity: 0,
        refillPerSec: 0
      })
    });

    const response = await runQuery({
      request: {
        mode: "ask",
        clientRequestId: "req-backpressure-envelope",
        question: "산안법 제10조 안전조치",
        referenceDate: "2026-04-18"
      },
      user,
      deps,
      now: "2026-04-18T00:00:00.000Z"
    });

    expect(response.kind).toBe("rate_limited");
    if (response.kind !== "rate_limited") {
      throw new Error("expected rate_limited response");
    }
    expect(Number.isInteger(response.retryAfterSeconds)).toBe(true);
    expect(response.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("rejects exactly N of 2N same-tick concurrent requests without queue starvation", async () => {
    const capacity = 3;
    const { user, deps } = await createRegressionDeps({
      rateLimitStore: createInMemoryRateLimitStore({
        capacity,
        refillPerSec: 0
      })
    });

    const startedAt = Date.now();
    const responses = await Promise.all(
      Array.from({ length: capacity * 2 }, (_, index) =>
        runQuery({
          request: {
            mode: "ask",
            clientRequestId: `req-backpressure-${index}`,
            question: "산안법 제10조 안전조치",
            referenceDate: "2026-04-18"
          },
          user,
          deps,
          now: "2026-04-18T00:00:00.000Z"
        })
      )
    );
    const elapsedMs = Date.now() - startedAt;
    const allowedCount = responses.filter((response) => response.kind !== "rate_limited").length;
    const blockedCount = responses.filter((response) => response.kind === "rate_limited").length;

    expect(allowedCount).toBe(capacity);
    expect(blockedCount).toBe(capacity);
    expect(elapsedMs).toBeLessThan(2000);
  });
});
