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

  test("rejects cross-user session replay by keeping a token bound to its original owner", async () => {
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

    await store.createSession({
      userId: userA.id,
      tokenHash: hashToken(sessionToken),
      createdAt: "2026-04-18T00:02:00.000Z",
      expiresAt: "2026-04-25T00:02:00.000Z",
      ip: "127.0.0.1",
      userAgent: "vitest"
    });

    const replayAttempt = async (expectedUserId: string) => {
      const currentUser = await getCurrentUser({
        cookie: `app_session=${sessionToken}`,
        store,
        now: "2026-04-18T00:03:00.000Z"
      });

      if (!currentUser || currentUser.id !== expectedUserId) {
        throw new Error("session_replay_rejected");
      }

      return currentUser;
    };

    await expect(replayAttempt(userB.id)).rejects.toThrow("session_replay_rejected");
    await expect(replayAttempt(userA.id)).resolves.toMatchObject({
      id: userA.id
    });
  });
});
