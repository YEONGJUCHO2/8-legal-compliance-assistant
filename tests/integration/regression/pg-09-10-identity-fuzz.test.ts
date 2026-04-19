// @vitest-environment node

import { describe, expect, test } from "vitest";

import { getCurrentUser } from "@/lib/auth/session";
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

  test("characterizes session storage as permitting same token hash reuse across users; lookup resolves the first inserted owner", async () => {
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
    const sessionB = await store.createSession({
      userId: userB.id,
      tokenHash,
      createdAt: "2026-04-18T00:02:30.000Z",
      expiresAt: "2026-04-25T00:02:30.000Z",
      ip: "127.0.0.1",
      userAgent: "vitest"
    });

    const found = await store.findSessionByHash(tokenHash);
    const currentUser = await getCurrentUser({
      cookie: `app_session=${sessionToken}`,
      store,
      now: "2026-04-18T00:03:00.000Z"
    });

    expect(sessionA.userId).toBe(userA.id);
    expect(sessionB.userId).toBe(userB.id);
    expect(sessionA.tokenHash).toBe(sessionB.tokenHash);
    expect(found?.userId).toBe(userA.id);
    // Public session APIs allow duplicate token hashes, so lookup stays tied to insertion order rather than unique ownership.
    expect(currentUser).toMatchObject({
      id: userA.id
    });
  });
});
