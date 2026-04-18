import { describe, expect, test } from "vitest";

import { createPgRateLimitStore } from "@/lib/rate-limit-pg";
import { checkRateLimit } from "@/lib/rate-limit";

import { createMockSql } from "./helpers/mock-postgres";

describe("rate-limit-pg", () => {
  test("uses FOR UPDATE atomic consume path for allowed requests", async () => {
    const { sql, calls } = createMockSql([
      (query, params) => {
        expect(query).toContain("INSERT INTO rate_limit_buckets");
        expect(params[0]).toBe("user-1");
        return [];
      },
      (query) => {
        expect(query).toContain("FOR UPDATE");
        return [
          {
            tokens: 2,
            updated_at: "2026-04-18T00:00:00.000Z"
          }
        ];
      },
      (query, params) => {
        expect(query).toContain("UPDATE rate_limit_buckets");
        expect(params[1]).toBe(1);
        return [];
      }
    ]);
    const store = createPgRateLimitStore({
      db: sql,
      capacity: 2,
      refillPerSec: 1
    });

    await expect(checkRateLimit(store, "user-1", "2026-04-18T00:00:00.000Z")).resolves.toEqual({
      allowed: true
    });

    expect(calls.some((call) => call.query.includes("FOR UPDATE"))).toBe(true);
  });

  test("returns retryAfter when the replenished bucket stays below one token", async () => {
    const { sql } = createMockSql([
      () => [],
      () => [
        {
          tokens: 0.25,
          updated_at: "2026-04-18T00:00:00.000Z"
        }
      ],
      (query, params) => {
        expect(query).toContain("UPDATE rate_limit_buckets");
        expect(params[1]).toBe(0.25);
        return [];
      }
    ]);
    const store = createPgRateLimitStore({
      db: sql,
      capacity: 2,
      refillPerSec: 1
    });

    await expect(checkRateLimit(store, "user-1", "2026-04-18T00:00:00.000Z")).resolves.toEqual({
      allowed: false,
      retryAfterMs: 750
    });
  });
});
