import { describe, expect, test } from "vitest";

import { checkRateLimit, createInMemoryRateLimitStore } from "@/lib/rate-limit";

describe("rate-limit", () => {
  test("allows burst capacity and refills over time", async () => {
    const store = createInMemoryRateLimitStore({
      capacity: 2,
      refillPerSec: 1
    });

    const first = await checkRateLimit(store, "user-1", "2026-04-18T00:00:00.000Z");
    const second = await checkRateLimit(store, "user-1", "2026-04-18T00:00:00.100Z");
    const third = await checkRateLimit(store, "user-1", "2026-04-18T00:00:00.200Z");
    const fourth = await checkRateLimit(store, "user-1", "2026-04-18T00:00:01.300Z");

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBeGreaterThan(0);
    expect(fourth.allowed).toBe(true);
  });
});
