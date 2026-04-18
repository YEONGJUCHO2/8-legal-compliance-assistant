import type { Sql } from "postgres";

import { getDb } from "@/lib/db/client";
import type { RateLimitStore } from "@/lib/rate-limit";

type Bucket = {
  tokens: number;
  updatedAtMs: number;
};

type BucketRow = {
  tokens: number | string;
  updated_at: string | Date;
};

type ConsumeResult =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      retryAfterMs: number;
    };

function toMillis(now: string | Date) {
  return (now instanceof Date ? now : new Date(now)).getTime();
}

function toIsoDateTime(now: string | Date) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

export function createPgRateLimitStore({
  db = getDb(),
  capacity = 20,
  refillPerSec = 10 / 60,
  now: _now
}: {
  db?: Sql;
  capacity?: number;
  refillPerSec?: number;
  now?: () => string | Date;
} = {}): RateLimitStore & {
  capacity: number;
  refillPerSec: number;
  consume(key: string, now: string | Date): Promise<ConsumeResult>;
} {
  return {
    capacity,
    refillPerSec,
    async read(key) {
      const rows = await db.unsafe<BucketRow[]>(
        `
          SELECT tokens, updated_at
          FROM rate_limit_buckets
          WHERE key = $1
          LIMIT 1
        `,
        [key]
      );
      const row = rows[0];

      if (!row) {
        return null;
      }

      return {
        tokens: Number(row.tokens),
        updatedAtMs: toMillis(row.updated_at)
      } satisfies Bucket;
    },
    async write(key, bucket) {
      await db.unsafe(
        `
          INSERT INTO rate_limit_buckets (key, tokens, updated_at)
          VALUES ($1, $2, $3)
          ON CONFLICT (key) DO UPDATE
          SET tokens = EXCLUDED.tokens,
              updated_at = EXCLUDED.updated_at
        `,
        [key, bucket.tokens, new Date(bucket.updatedAtMs).toISOString()]
      );
    },
    async consume(key, now) {
      const currentMs = toMillis(now);
      const currentIso = toIsoDateTime(now);

      return db.begin(async (tx) => {
        await tx.unsafe(
          `
            INSERT INTO rate_limit_buckets (key, tokens, updated_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (key) DO NOTHING
          `,
          [key, capacity, currentIso]
        );

        const rows = await tx.unsafe<BucketRow[]>(
          `
            SELECT tokens, updated_at
            FROM rate_limit_buckets
            WHERE key = $1
            FOR UPDATE
          `,
          [key]
        );
        const row = rows[0] ?? {
          tokens: capacity,
          updated_at: currentIso
        };
        const elapsedSec = Math.max(0, (currentMs - toMillis(row.updated_at)) / 1000);
        const replenished = Math.min(capacity, Number(row.tokens) + elapsedSec * refillPerSec);

        if (replenished < 1) {
          const deficit = 1 - replenished;
          const retryAfterMs = refillPerSec > 0 ? Math.ceil((deficit / refillPerSec) * 1000) : 60_000;

          await tx.unsafe(
            `
              UPDATE rate_limit_buckets
              SET tokens = $2,
                  updated_at = $3
              WHERE key = $1
            `,
            [key, replenished, currentIso]
          );

          return {
            allowed: false as const,
            retryAfterMs
          };
        }

        await tx.unsafe(
          `
            UPDATE rate_limit_buckets
            SET tokens = $2,
                updated_at = $3
            WHERE key = $1
          `,
          [key, replenished - 1, currentIso]
        );

        return {
          allowed: true as const
        };
      });
    }
  };
}
