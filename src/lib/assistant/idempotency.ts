import { createHash } from "node:crypto";

type IdempotencyRecord = {
  userId: string;
  clientRequestId: string;
  payloadHash: string;
  runId: string;
  expiresAt: string;
};

export interface IdempotencyStore {
  getExisting(
    userId: string,
    clientRequestId: string,
    now: string
  ): Promise<Pick<IdempotencyRecord, "payloadHash" | "runId" | "expiresAt"> | null>;
  remember(record: IdempotencyRecord): Promise<void>;
  sweep(now: string): Promise<void>;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));

  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

export function computePayloadHash(request: unknown) {
  return createHash("sha256").update(stableStringify(request)).digest("hex");
}

export async function checkIdempotency(
  store: IdempotencyStore,
  request: {
    clientRequestId: string;
  } & Record<string, unknown>,
  userId: string,
  now: string
) {
  await store.sweep(now);

  const existing = await store.getExisting(userId, request.clientRequestId, now);

  if (!existing) {
    return {
      status: "fresh" as const
    };
  }

  const payloadHash = computePayloadHash(request);

  if (existing.payloadHash === payloadHash) {
    return {
      status: "replay" as const,
      runId: existing.runId
    };
  }

  return {
    status: "conflict" as const
  };
}

export function createInMemoryIdempotencyStore(): IdempotencyStore {
  const records = new Map<string, IdempotencyRecord>();

  return {
    async getExisting(userId, clientRequestId, now) {
      const record = records.get(`${userId}:${clientRequestId}`);

      if (!record || record.expiresAt <= now) {
        return null;
      }

      return {
        payloadHash: record.payloadHash,
        runId: record.runId,
        expiresAt: record.expiresAt
      };
    },
    async remember(record) {
      records.set(`${record.userId}:${record.clientRequestId}`, { ...record });
    },
    async sweep(now) {
      for (const [key, record] of records.entries()) {
        if (record.expiresAt <= now) {
          records.delete(key);
        }
      }
    }
  };
}
