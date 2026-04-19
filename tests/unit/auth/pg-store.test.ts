import { describe, expect, test } from "vitest";

import { AuthError } from "@/lib/auth/types";
import { createPgAuthStore } from "@/lib/auth/pg-store";

import { createMockSql } from "../helpers/mock-postgres";

describe("createPgAuthStore", () => {
  test("persists and consumes magic links through postgres rows", async () => {
    const mock = createMockSql([
      () => [
        {
          id: "magic-1",
          token_hash: "token-hash",
          email: "user@example.com",
          created_at: "2026-04-18T00:00:00.000Z",
          expires_at: "2026-04-18T00:15:00.000Z",
          consumed_at: null,
          ip: "127.0.0.1",
          user_agent: "Vitest",
          state: "state-1",
          redemption_attempts: 0
        }
      ],
      () => [
        {
          id: "magic-1",
          token_hash: "token-hash",
          email: "user@example.com",
          created_at: "2026-04-18T00:00:00.000Z",
          expires_at: "2026-04-18T00:15:00.000Z",
          consumed_at: null,
          ip: "127.0.0.1",
          user_agent: "Vitest",
          state: "state-1",
          redemption_attempts: 0
        }
      ],
      () => [{ count: 1 }],
      () => [
        {
          id: "magic-1",
          token_hash: "token-hash",
          email: "user@example.com",
          created_at: "2026-04-18T00:00:00.000Z",
          expires_at: "2026-04-18T00:15:00.000Z",
          consumed_at: null,
          ip: "127.0.0.1",
          user_agent: "Vitest",
          state: "state-1",
          redemption_attempts: 1
        }
      ],
      () => [
        {
          id: "magic-1",
          token_hash: "token-hash",
          email: "user@example.com",
          created_at: "2026-04-18T00:00:00.000Z",
          expires_at: "2026-04-18T00:15:00.000Z",
          consumed_at: "2026-04-18T00:03:00.000Z",
          ip: "127.0.0.1",
          user_agent: "Vitest",
          state: "state-1",
          redemption_attempts: 1
        }
      ]
    ]);
    const store = createPgAuthStore(mock.sql);

    const created = await store.createMagicLink({
      id: "magic-1",
      tokenHash: "token-hash",
      email: "user@example.com",
      createdAt: "2026-04-18T00:00:00.000Z",
      expiresAt: "2026-04-18T00:15:00.000Z",
      ip: "127.0.0.1",
      userAgent: "Vitest",
      state: "state-1",
      redemptionAttempts: 0
    });
    const found = await store.findMagicLinkByHash("token-hash");
    const count = await store.countMagicLinksForEmailSince("user@example.com", "2026-04-17T23:00:00.000Z");
    const incremented = await store.incrementRedemptionAttempts("magic-1");
    const consumed = await store.consumeMagicLink("magic-1", "2026-04-18T00:03:00.000Z");

    expect(created).toMatchObject({
      id: "magic-1",
      tokenHash: "token-hash",
      state: "state-1",
      redemptionAttempts: 0
    });
    expect(found?.email).toBe("user@example.com");
    expect(count).toBe(1);
    expect(incremented?.redemptionAttempts).toBe(1);
    expect(consumed?.consumedAt).toBe("2026-04-18T00:03:00.000Z");
    expect(mock.calls[0].query).toContain("INSERT INTO auth_magic_links");
    expect(mock.calls[4].query).toContain("consumed_at IS NULL");
  });

  test("creates, finds, and revokes sessions", async () => {
    const mock = createMockSql([
      () => [
        {
          id: "session-1",
          user_id: "user-1",
          token_hash: "session-hash",
          created_at: "2026-04-18T00:00:00.000Z",
          expires_at: "2026-04-25T00:00:00.000Z",
          revoked_at: null,
          ip: "127.0.0.1",
          user_agent: "Vitest"
        }
      ],
      () => [
        {
          id: "session-1",
          user_id: "user-1",
          token_hash: "session-hash",
          created_at: "2026-04-18T00:00:00.000Z",
          expires_at: "2026-04-25T00:00:00.000Z",
          revoked_at: null,
          ip: "127.0.0.1",
          user_agent: "Vitest"
        }
      ],
      () => [
        {
          id: "session-1",
          user_id: "user-1",
          token_hash: "session-hash",
          created_at: "2026-04-18T00:00:00.000Z",
          expires_at: "2026-04-25T00:00:00.000Z",
          revoked_at: "2026-04-19T00:00:00.000Z",
          ip: "127.0.0.1",
          user_agent: "Vitest"
        }
      ]
    ]);
    const store = createPgAuthStore(mock.sql);

    const created = await store.createSession({
      id: "session-1",
      userId: "user-1",
      tokenHash: "session-hash",
      createdAt: "2026-04-18T00:00:00.000Z",
      expiresAt: "2026-04-25T00:00:00.000Z",
      ip: "127.0.0.1",
      userAgent: "Vitest"
    });
    const found = await store.findSessionByHash("session-hash");
    const revoked = await store.revokeSession("session-1", "2026-04-19T00:00:00.000Z");

    expect(created.id).toBe("session-1");
    expect(found?.userId).toBe("user-1");
    expect(revoked?.revokedAt).toBe("2026-04-19T00:00:00.000Z");
    expect(mock.calls[2].query).toContain("UPDATE auth_sessions");
  });

  test("maps duplicate token hashes to session_conflict", async () => {
    const mock = createMockSql([
      () => {
        const error = new Error("duplicate key value violates unique constraint") as Error & { code?: string };
        error.code = "23505";
        throw error;
      }
    ]);
    const store = createPgAuthStore(mock.sql);

    await expect(
      store.createSession({
        id: "session-duplicate",
        userId: "user-1",
        tokenHash: "session-hash",
        createdAt: "2026-04-18T00:00:00.000Z",
        expiresAt: "2026-04-25T00:00:00.000Z",
        ip: "127.0.0.1",
        userAgent: "Vitest"
      })
    ).rejects.toEqual(new AuthError("session_conflict", "Session token hash already exists"));
  });

  test("finds or creates durable identities and users", async () => {
    const mock = createMockSql([
      () => [],
      () => [],
      () => [],
      () => [
        {
          id: "identity-1",
          user_id: "user-1",
          provider: "magic_link",
          provider_subject: "magic:user@example.com",
          email: "user@example.com",
          created_at: "2026-04-18T00:00:00.000Z"
        }
      ],
      () => [],
      () => [
        {
          id: "user-1",
          internal_user_id: "internal-1",
          display_name: null,
          created_at: "2026-04-18T00:00:00.000Z",
          deleted_at: null
        }
      ],
      () => [
        {
          id: "user-1",
          internal_user_id: "internal-1",
          display_name: null,
          created_at: "2026-04-18T00:00:00.000Z",
          deleted_at: null
        }
      ],
      () => [
        {
          id: "user-1",
          internal_user_id: "internal-1",
          display_name: null,
          created_at: "2026-04-18T00:00:00.000Z",
          deleted_at: null
        }
      ]
    ]);
    const store = createPgAuthStore(mock.sql);

    const created = await store.findOrCreateUserByEmail({
      email: "User@example.com",
      provider: "magic_link",
      providerSubject: "magic:user@example.com",
      now: "2026-04-18T00:00:00.000Z"
    });
    const existing = await store.findOrCreateUserByEmail({
      email: "user@example.com",
      provider: "magic_link",
      providerSubject: "magic:user@example.com",
      now: "2026-04-18T00:00:00.000Z"
    });
    const found = await store.findUserById("user-1");

    expect(created.id).toBe("user-1");
    expect(existing.id).toBe("user-1");
    expect(found?.internalUserId).toBe("internal-1");
    expect(mock.calls[3].query).toContain("ON CONFLICT (provider, provider_subject)");
  });
});
