import { describe, expect, test } from "vitest";

import { createInMemoryAuthStore } from "@/lib/auth/in-memory-store";
import { getCurrentUser } from "@/lib/auth/session";
import { hashToken } from "@/lib/auth/tokens";

describe("getCurrentUser", () => {
  test("returns the current user for a valid session cookie", async () => {
    const store = createInMemoryAuthStore();
    const user = await store.findOrCreateUserByEmail({
      email: "user@example.com",
      provider: "magic_link",
      providerSubject: "magic:user@example.com",
      now: "2026-04-17T00:00:00.000Z"
    });
    const token = "session-token";

    await store.createSession({
      userId: user.id,
      tokenHash: hashToken(token),
      createdAt: "2026-04-17T00:00:00.000Z",
      expiresAt: "2026-04-24T00:00:00.000Z",
      ip: "127.0.0.1",
      userAgent: "vitest"
    });

    await expect(
      getCurrentUser({
        cookie: `app_session=${token}`,
        store,
        now: "2026-04-17T01:00:00.000Z"
      })
    ).resolves.toMatchObject({
      id: user.id
    });
  });

  test("returns null for expired or revoked sessions", async () => {
    const store = createInMemoryAuthStore();
    const user = await store.findOrCreateUserByEmail({
      email: "user@example.com",
      provider: "magic_link",
      providerSubject: "magic:user@example.com",
      now: "2026-04-17T00:00:00.000Z"
    });
    const expiredToken = "expired-token";
    const revokedToken = "revoked-token";
    await store.createSession({
      userId: user.id,
      tokenHash: hashToken(expiredToken),
      createdAt: "2026-04-17T00:00:00.000Z",
      expiresAt: "2026-04-17T00:01:00.000Z",
      ip: "127.0.0.1",
      userAgent: "vitest"
    });

    const revoked = await store.createSession({
      userId: user.id,
      tokenHash: hashToken(revokedToken),
      createdAt: "2026-04-17T00:00:00.000Z",
      expiresAt: "2026-04-24T00:00:00.000Z",
      ip: "127.0.0.1",
      userAgent: "vitest"
    });
    await store.revokeSession(revoked.id, "2026-04-17T00:30:00.000Z");

    await expect(
      getCurrentUser({
        cookie: `app_session=${expiredToken}`,
        store,
        now: "2026-04-17T01:00:00.000Z"
      })
    ).resolves.toBeNull();
    await expect(
      getCurrentUser({
        cookie: `app_session=${revokedToken}`,
        store,
        now: "2026-04-17T01:00:00.000Z"
      })
    ).resolves.toBeNull();
  });
});
