import type { Sql } from "postgres";

import { getDb } from "@/lib/db/client";

import type { IdempotencyStore } from "./idempotency";

type ExistingRow = {
  payload_hash: string;
  response: unknown;
  expires_at: string | Date | null;
};

type RememberInput = Parameters<IdempotencyStore["remember"]>[0];

function buildKey(userId: string, clientRequestId: string) {
  return `${userId}:${clientRequestId}`;
}

function toIsoDateTime(value: string | Date | null) {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function extractRunId(response: unknown) {
  const candidate =
    typeof response === "string"
      ? (JSON.parse(response) as unknown)
      : response;

  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const runId = (candidate as { runId?: unknown }).runId;
  return typeof runId === "string" ? runId : null;
}

export function createPgIdempotencyStore({
  db = getDb(),
  now: _now
}: {
  db?: Sql;
  now?: () => string | Date;
} = {}): IdempotencyStore {
  return {
    async getExisting(userId, clientRequestId, now) {
      const rows = await db.unsafe<ExistingRow[]>(
        `
          SELECT payload_hash, response, expires_at
          FROM idempotency_records
          WHERE key = $1
          LIMIT 1
        `,
        [buildKey(userId, clientRequestId)]
      );
      const row = rows[0];
      const expiresAt = toIsoDateTime(row?.expires_at ?? null);

      if (!row || !expiresAt || expiresAt <= now) {
        return null;
      }

      const runId = extractRunId(row.response);

      if (!runId) {
        return null;
      }

      return {
        payloadHash: row.payload_hash,
        runId,
        expiresAt
      };
    },
    async remember(record: RememberInput) {
      await db.unsafe(
        `
          INSERT INTO idempotency_records (key, payload_hash, response, expires_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (key) DO UPDATE
          SET payload_hash = EXCLUDED.payload_hash,
              response = EXCLUDED.response,
              expires_at = EXCLUDED.expires_at
        `,
        [buildKey(record.userId, record.clientRequestId), record.payloadHash, { runId: record.runId }, record.expiresAt]
      );
    },
    async sweep(now) {
      await db.unsafe(
        `
          DELETE FROM idempotency_records
          WHERE expires_at IS NOT NULL
            AND expires_at <= $1
        `,
        [now]
      );
    }
  };
}
