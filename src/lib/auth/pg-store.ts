import { randomUUID } from "node:crypto";

import type { Sql } from "postgres";

import { getDb } from "@/lib/db/client";

import { AuthError, normalizeEmail, type MagicLinkRecord, type PgAuthStore, type SessionRecord, type UserRecord } from "./types";

type MagicLinkRow = {
  id: string;
  token_hash: string;
  email: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  ip: string | null;
  user_agent: string | null;
  state: string;
  redemption_attempts: number;
};

type SessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  ip: string | null;
  user_agent: string | null;
};

type UserRow = {
  id: string;
  internal_user_id: string;
  display_name: string | null;
  created_at: string;
  deleted_at: string | null;
};

type IdentityRow = {
  id: string;
  user_id: string;
};

function toOptional(value: string | null) {
  return value ?? undefined;
}

function mapMagicLink(row: MagicLinkRow): MagicLinkRecord {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    email: row.email,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: toOptional(row.consumed_at),
    ip: toOptional(row.ip),
    userAgent: toOptional(row.user_agent),
    state: row.state,
    redemptionAttempts: row.redemption_attempts
  };
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: toOptional(row.revoked_at),
    ip: toOptional(row.ip),
    userAgent: toOptional(row.user_agent)
  };
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    internalUserId: row.internal_user_id,
    displayName: toOptional(row.display_name),
    createdAt: row.created_at,
    deletedAt: toOptional(row.deleted_at)
  };
}

export function createPgAuthStore(db: Sql = getDb()): PgAuthStore {
  return {
    db,
    async createMagicLink(record) {
      const rows = await db.unsafe<MagicLinkRow[]>(
        `
          INSERT INTO auth_magic_links (
            id, token_hash, email, created_at, expires_at, consumed_at, ip, user_agent, state, redemption_attempts
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
          )
          RETURNING id, token_hash, email, created_at, expires_at, consumed_at, ip, user_agent, state, redemption_attempts
        `,
        [
          record.id,
          record.tokenHash,
          normalizeEmail(record.email),
          record.createdAt,
          record.expiresAt,
          record.consumedAt ?? null,
          record.ip ?? null,
          record.userAgent ?? null,
          record.state,
          record.redemptionAttempts
        ]
      );

      return mapMagicLink(rows[0]);
    },
    async findMagicLinkByHash(tokenHash) {
      const rows = await db.unsafe<MagicLinkRow[]>(
        `
          SELECT id, token_hash, email, created_at, expires_at, consumed_at, ip, user_agent, state, redemption_attempts
          FROM auth_magic_links
          WHERE token_hash = $1
          LIMIT 1
        `,
        [tokenHash]
      );

      return rows[0] ? mapMagicLink(rows[0]) : null;
    },
    async consumeMagicLink(id, consumedAt) {
      const rows = await db.unsafe<MagicLinkRow[]>(
        `
          UPDATE auth_magic_links
          SET consumed_at = $2
          WHERE id = $1
            AND consumed_at IS NULL
          RETURNING id, token_hash, email, created_at, expires_at, consumed_at, ip, user_agent, state, redemption_attempts
        `,
        [id, consumedAt]
      );

      return rows[0] ? mapMagicLink(rows[0]) : null;
    },
    async countMagicLinksForEmailSince(email, since) {
      const rows = await db.unsafe<Array<{ count: number | string }>>(
        `
          SELECT COUNT(*)::int AS count
          FROM auth_magic_links
          WHERE email = $1
            AND created_at >= $2
        `,
        [normalizeEmail(email), since]
      );

      return Number(rows[0]?.count ?? 0);
    },
    async incrementRedemptionAttempts(id) {
      const rows = await db.unsafe<MagicLinkRow[]>(
        `
          UPDATE auth_magic_links
          SET redemption_attempts = redemption_attempts + 1
          WHERE id = $1
          RETURNING id, token_hash, email, created_at, expires_at, consumed_at, ip, user_agent, state, redemption_attempts
        `,
        [id]
      );

      return rows[0] ? mapMagicLink(rows[0]) : null;
    },
    async createSession(record) {
      const sessionId = record.id ?? randomUUID();
      let rows: SessionRow[];

      try {
        rows = await db.unsafe<SessionRow[]>(
          `
            INSERT INTO auth_sessions (
              id, user_id, token_hash, created_at, expires_at, revoked_at, ip, user_agent
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8
            )
            RETURNING id, user_id, token_hash, created_at, expires_at, revoked_at, ip, user_agent
          `,
          [
            sessionId,
            record.userId,
            record.tokenHash,
            record.createdAt,
            record.expiresAt,
            record.revokedAt ?? null,
            record.ip ?? null,
            record.userAgent ?? null
          ]
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new AuthError("session_conflict", "Session token hash already exists");
        }

        throw error;
      }

      return mapSession(rows[0]);
    },
    async findSessionByHash(tokenHash) {
      const rows = await db.unsafe<SessionRow[]>(
        `
          SELECT id, user_id, token_hash, created_at, expires_at, revoked_at, ip, user_agent
          FROM auth_sessions
          WHERE token_hash = $1
          LIMIT 1
        `,
        [tokenHash]
      );

      return rows[0] ? mapSession(rows[0]) : null;
    },
    async revokeSession(id, revokedAt) {
      const rows = await db.unsafe<SessionRow[]>(
        `
          UPDATE auth_sessions
          SET revoked_at = $2
          WHERE id = $1
          RETURNING id, user_id, token_hash, created_at, expires_at, revoked_at, ip, user_agent
        `,
        [id, revokedAt]
      );

      return rows[0] ? mapSession(rows[0]) : null;
    },
    async findOrCreateUserByEmail({ email, provider, providerSubject, now }) {
      const normalizedEmail = normalizeEmail(email);

      return db.begin(async (tx) => {
        const existingRows = await tx.unsafe<UserRow[]>(
          `
            SELECT u.id, u.internal_user_id, u.display_name, u.created_at, u.deleted_at
            FROM user_identities identities
            JOIN app_users u
              ON u.id = identities.user_id
            WHERE identities.provider = $1
              AND identities.provider_subject = $2
            LIMIT 1
          `,
          [provider, providerSubject]
        );

        if (existingRows[0]) {
          return mapUser(existingRows[0]);
        }

        const conflictingRows = await tx.unsafe<Array<{ id: string }>>(
          `
            SELECT id
            FROM user_identities
            WHERE lower(COALESCE(email, '')) = lower($1)
              AND provider_subject <> $2
            LIMIT 1
          `,
          [normalizedEmail, providerSubject]
        );

        if (conflictingRows[0]) {
          throw new AuthError("identity_conflict", "Durable identity conflict for email");
        }

        const userId = randomUUID();
        await tx.unsafe(
          `
            INSERT INTO app_users (id, internal_user_id, display_name, created_at, deleted_at)
            VALUES ($1, $2, $3, $4, $5)
          `,
          [userId, randomUUID(), null, now, null]
        );

        const identityRows = await tx.unsafe<IdentityRow[]>(
          `
            INSERT INTO user_identities (id, user_id, provider, provider_subject, email, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (provider, provider_subject) DO UPDATE
            SET email = COALESCE(user_identities.email, EXCLUDED.email)
            RETURNING id, user_id
          `,
          [randomUUID(), userId, provider, providerSubject, normalizedEmail, now]
        );

        const resolvedIdentity = identityRows[0];

        if (resolvedIdentity.user_id !== userId) {
          await tx.unsafe(
            `
              DELETE FROM app_users
              WHERE id = $1
            `,
            [userId]
          );
        }

        const userRows = await tx.unsafe<UserRow[]>(
          `
            SELECT id, internal_user_id, display_name, created_at, deleted_at
            FROM app_users
            WHERE id = $1
            LIMIT 1
          `,
          [resolvedIdentity.user_id]
        );

        if (!userRows[0]) {
          throw new Error(`identity_without_user:${resolvedIdentity.id}`);
        }

        return mapUser(userRows[0]);
      });
    },
    async findUserById(id) {
      const rows = await db.unsafe<UserRow[]>(
        `
          SELECT id, internal_user_id, display_name, created_at, deleted_at
          FROM app_users
          WHERE id = $1
          LIMIT 1
        `,
        [id]
      );

      return rows[0] ? mapUser(rows[0]) : null;
    }
  };
}
