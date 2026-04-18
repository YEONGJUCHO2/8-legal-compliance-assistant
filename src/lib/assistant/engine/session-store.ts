import { randomUUID } from "node:crypto";

import type { Sql } from "postgres";

import { getDb } from "@/lib/db/client";
import type { EngineSessionRow } from "@/lib/db/rows";

import type { EngineProvider } from "./types";

type TimestampInput = Date | string;

export interface BindHandleInput {
  userId: string;
  provider: EngineProvider;
  sessionId?: string;
  expiresAt: string;
  now?: TimestampInput;
}

export interface CreateSessionInput {
  userId: string;
  provider: EngineProvider;
  expiresAt: string;
  handle?: string;
  now?: TimestampInput;
}

export interface EngineSessionStore {
  findBySessionId(sessionId: string): Promise<EngineSessionRow | undefined>;
  createSession(input: CreateSessionInput): Promise<EngineSessionRow>;
}

export class SessionNotFoundError extends Error {
  constructor() {
    super("session_not_found");
    this.name = "SessionNotFoundError";
  }
}

function toDate(value?: TimestampInput) {
  return value instanceof Date ? value : value ? new Date(value) : new Date();
}

function toIsoString(value?: TimestampInput) {
  return toDate(value).toISOString();
}

function isActive(row: EngineSessionRow, now: Date) {
  return row.revoked_at === null && new Date(row.expires_at).getTime() > now.getTime();
}

function buildSessionRow(input: CreateSessionInput): EngineSessionRow {
  return {
    id: randomUUID(),
    user_id: input.userId,
    provider: input.provider,
    handle: input.handle ?? `engine-${randomUUID()}`,
    created_at: toIsoString(input.now),
    expires_at: input.expiresAt,
    revoked_at: null
  };
}

export async function bindHandle(input: BindHandleInput, store: EngineSessionStore): Promise<EngineSessionRow> {
  const now = toDate(input.now);

  if (input.sessionId) {
    const row = await store.findBySessionId(input.sessionId);

    if (!row || row.user_id !== input.userId || row.provider !== input.provider || !isActive(row, now)) {
      throw new SessionNotFoundError();
    }

    return row;
  }

  return store.createSession({
    userId: input.userId,
    provider: input.provider,
    expiresAt: input.expiresAt,
    now
  });
}

export function createInMemoryEngineSessionStore(seed: EngineSessionRow[] = []): EngineSessionStore {
  const rows = new Map(seed.map((row) => [row.id, { ...row }]));

  return {
    async findBySessionId(sessionId) {
      const row = rows.get(sessionId);

      return row ? { ...row } : undefined;
    },
    async createSession(input) {
      const row = buildSessionRow(input);
      rows.set(row.id, row);

      return { ...row };
    }
  };
}

export function createDbEngineSessionStore(db: Sql = getDb()): EngineSessionStore {
  return {
    async findBySessionId(sessionId) {
      const rows = await db<EngineSessionRow[]>`
        SELECT id, user_id, provider, handle, created_at, expires_at, revoked_at
        FROM engine_sessions
        WHERE id = ${sessionId}
        LIMIT 1
      `;

      return rows[0];
    },
    async createSession(input) {
      const row = buildSessionRow(input);
      const rows = await db<EngineSessionRow[]>`
        INSERT INTO engine_sessions (id, user_id, provider, handle, created_at, expires_at, revoked_at)
        VALUES (${row.id}, ${row.user_id}, ${row.provider}, ${row.handle}, ${row.created_at}, ${row.expires_at}, ${row.revoked_at})
        RETURNING id, user_id, provider, handle, created_at, expires_at, revoked_at
      `;

      return rows[0];
    }
  };
}
