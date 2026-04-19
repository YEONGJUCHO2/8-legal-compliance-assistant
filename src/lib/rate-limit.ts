type Bucket = {
  tokens: number;
  updatedAtMs: number;
};

export interface RateLimitStore {
  read(key: string): Promise<Bucket | null>;
  write(key: string, bucket: Bucket): Promise<void>;
  consume?(
    key: string,
    now: string | Date
  ): Promise<
    | {
        allowed: true;
      }
    | {
        allowed: false;
        retryAfterMs: number;
      }
  >;
  reset?(): Promise<void>;
}

export function createInMemoryRateLimitStore({
  capacity = 20,
  refillPerSec = 10 / 60
}: {
  capacity?: number;
  refillPerSec?: number;
} = {}): RateLimitStore & {
  capacity: number;
  refillPerSec: number;
} {
  const buckets = new Map<string, Bucket>();

  return {
    capacity,
    refillPerSec,
    async read(key) {
      return buckets.get(key) ?? null;
    },
    async write(key, bucket) {
      buckets.set(key, bucket);
    },
    async consume(
      this: {
        capacity?: number;
        refillPerSec?: number;
      },
      key,
      now
    ) {
      const currentMs = toMillis(now);
      const currentCapacity = this.capacity ?? capacity;
      const currentRefillPerSec = this.refillPerSec ?? refillPerSec;
      const existing = buckets.get(key) ?? {
        tokens: currentCapacity,
        updatedAtMs: currentMs
      };
      const elapsedSec = Math.max(0, (currentMs - existing.updatedAtMs) / 1000);
      const replenished = Math.min(currentCapacity, existing.tokens + elapsedSec * currentRefillPerSec);

      if (replenished < 1) {
        const deficit = 1 - replenished;
        const retryAfterMs =
          currentRefillPerSec > 0 ? Math.ceil((deficit / currentRefillPerSec) * 1000) : 60_000;
        buckets.set(key, {
          tokens: replenished,
          updatedAtMs: currentMs
        });

        return {
          allowed: false as const,
          retryAfterMs
        };
      }

      buckets.set(key, {
        tokens: replenished - 1,
        updatedAtMs: currentMs
      });

      return {
        allowed: true as const
      };
    },
    async reset() {
      buckets.clear();
    }
  };
}

function toMillis(now: string | Date) {
  return (now instanceof Date ? now : new Date(now)).getTime();
}

export async function checkRateLimit(
  store: RateLimitStore & {
    capacity?: number;
    refillPerSec?: number;
    consume?: (
      key: string,
      now: string | Date
    ) => Promise<
      | {
          allowed: true;
        }
      | {
          allowed: false;
          retryAfterMs: number;
        }
    >;
  },
  key: string,
  now: string | Date
) {
  if (typeof store.consume === "function") {
    return store.consume(key, now);
  }

  const currentMs = toMillis(now);
  const capacity = store.capacity ?? 20;
  const refillPerSec = store.refillPerSec ?? 10 / 60;
  const existing = (await store.read(key)) ?? {
    tokens: capacity,
    updatedAtMs: currentMs
  };
  const elapsedSec = Math.max(0, (currentMs - existing.updatedAtMs) / 1000);
  const replenished = Math.min(capacity, existing.tokens + elapsedSec * refillPerSec);

  if (replenished < 1) {
    const deficit = 1 - replenished;
    const retryAfterMs = refillPerSec > 0 ? Math.ceil((deficit / refillPerSec) * 1000) : 60_000;
    await store.write(key, {
      tokens: replenished,
      updatedAtMs: currentMs
    });

    return {
      allowed: false as const,
      retryAfterMs
    };
  }

  await store.write(key, {
    tokens: replenished - 1,
    updatedAtMs: currentMs
  });

  return {
    allowed: true as const
  };
}
