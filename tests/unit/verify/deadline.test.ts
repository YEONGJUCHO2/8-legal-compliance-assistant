import { describe, expect, test } from "vitest";

import { createDeadline } from "@/lib/verify/deadline";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createDeadline", () => {
  test("tracks remaining time and expiration", async () => {
    const deadline = createDeadline({
      totalMs: 60,
      safetyMarginMs: 15
    });

    expect(deadline.remaining()).toBeGreaterThan(0);
    expect(deadline.expired()).toBe(false);
    expect(deadline.shouldPreempt()).toBe(false);

    await sleep(50);

    expect(deadline.shouldPreempt()).toBe(true);

    await sleep(20);

    expect(deadline.expired()).toBe(true);
    expect(deadline.remaining()).toBe(0);
  });
});
