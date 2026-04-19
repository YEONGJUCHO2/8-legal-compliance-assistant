// @vitest-environment node

import { describe, expect, test } from "vitest";

import { hashToken } from "@/lib/auth/tokens";
import { createInMemoryAuthStore } from "@/lib/auth/in-memory-store";

describe("pg-09-10-identity-fuzz", () => {
  test("rejects identity-link conflicts when a magic-link email is rebound to oidc", async () => {
    const store = createInMemoryAuthStore();

    await store.findOrCreateUserByEmail({
      email: "user@example.com",
      provider: "magic_link",
      providerSubject: "magic:user@example.com",
      now: "2026-04-18T00:00:00.000Z"
    });

    await expect(
      store.findOrCreateUserByEmail({
        email: "user@example.com",
        provider: "oidc",
        providerSubject: "oidc:user@example.com",
        now: "2026-04-18T00:05:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "identity_conflict"
    });
  });

  test("characterizes provider migration collisions as identity_conflict while preserving the original binding", async () => {
    const store = createInMemoryAuthStore();
    const original = await store.findOrCreateUserByEmail({
      email: "user@example.com",
      provider: "oidc",
      providerSubject: "oidc:sub-1",
      now: "2026-04-18T00:00:00.000Z"
    });

    await expect(
      store.findOrCreateUserByEmail({
        email: "user@example.com",
        provider: "oidc",
        providerSubject: "oidc:sub-2",
        now: "2026-04-18T00:10:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "identity_conflict"
    });

    await expect(
      store.findOrCreateUserByEmail({
        email: "user@example.com",
        provider: "oidc",
        providerSubject: "oidc:sub-1",
        now: "2026-04-18T00:15:00.000Z"
      })
    ).resolves.toMatchObject({
      id: original.id,
      internalUserId: original.internalUserId
    });
  });

  test("characterizes session storage as bound to originating user; same token hash cannot be reused across users", async () => {
    const store = createInMemoryAuthStore();
    const userA = await store.findOrCreateUserByEmail({
      email: "user-a@example.com",
      provider: "magic_link",
      providerSubject: "magic:user-a@example.com",
      now: "2026-04-18T00:00:00.000Z"
    });
    const userB = await store.findOrCreateUserByEmail({
      email: "user-b@example.com",
      provider: "magic_link",
      providerSubject: "magic:user-b@example.com",
      now: "2026-04-18T00:01:00.000Z"
    });
    const sessionToken = "session-token-a";
    const tokenHash = hashToken(sessionToken);

    const sessionA = await store.createSession({
      userId: userA.id,
      tokenHash,
      createdAt: "2026-04-18T00:02:00.000Z",
      expiresAt: "2026-04-25T00:02:00.000Z",
      ip: "127.0.0.1",
      userAgent: "vitest"
    });

    await expect(
      store.createSession({
        userId: userB.id,
        tokenHash,
        createdAt: "2026-04-18T00:02:30.000Z",
        expiresAt: "2026-04-25T00:02:30.000Z",
        ip: "127.0.0.1",
        userAgent: "vitest"
      })
    ).rejects.toMatchObject({
      code: "session_conflict"
    });

    const found = await store.findSessionByHash(tokenHash);

    expect(sessionA.userId).toBe(userA.id);
    expect(found?.userId).toBe(userA.id);
    expect(found?.tokenHash).toBe(tokenHash);
  });
});
