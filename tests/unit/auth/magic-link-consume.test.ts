import { describe, expect, test } from "vitest";

import { createInMemoryAuthStore } from "@/lib/auth/in-memory-store";
import { consumeMagicLink, requestMagicLink } from "@/lib/auth/magic-link";
import { hashToken } from "@/lib/auth/tokens";

async function issueMagicLink(store = createInMemoryAuthStore()) {
  const requested = await requestMagicLink(store, {
    email: "user@example.com",
    ip: "127.0.0.1",
    userAgent: "vitest",
    now: "2026-04-17T00:00:00.000Z",
    appBaseUrl: "https://example.test",
    mailer: {
      send: async () => {}
    }
  });
  const token = new URL(requested.magicUrl).searchParams.get("token");

  if (!token) {
    throw new Error("token missing in test helper");
  }

  return {
    store,
    requested,
    token
  };
}

describe("consumeMagicLink", () => {
  test("consumes a valid magic link and creates a session", async () => {
    const { store, requested, token } = await issueMagicLink();

    const result = await consumeMagicLink(store, {
      token,
      state: requested.state,
      ip: "127.0.0.1",
      userAgent: "vitest",
      now: "2026-04-17T00:05:00.000Z"
    });

    const session = await store.findSessionByHash(hashToken(result.sessionToken));
    const record = await store.findMagicLinkByHash(hashToken(token));

    expect(result.userId).toBeTruthy();
    expect(result.sessionExpiresAt).toBe("2026-04-24T00:05:00.000Z");
    expect(session?.userId).toBe(result.userId);
    expect(record?.consumedAt).toBe("2026-04-17T00:05:00.000Z");
  });

  test("rejects expired tokens", async () => {
    const { store, requested, token } = await issueMagicLink();

    await expect(
      consumeMagicLink(store, {
        token,
        state: requested.state,
        ip: "127.0.0.1",
        userAgent: "vitest",
        now: "2026-04-17T00:16:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "token_expired"
    });
  });

  test("rejects already-used tokens", async () => {
    const { store, requested, token } = await issueMagicLink();

    await consumeMagicLink(store, {
      token,
      state: requested.state,
      ip: "127.0.0.1",
      userAgent: "vitest",
      now: "2026-04-17T00:05:00.000Z"
    });

    await expect(
      consumeMagicLink(store, {
        token,
        state: requested.state,
        ip: "127.0.0.1",
        userAgent: "vitest",
        now: "2026-04-17T00:06:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "token_already_used"
    });
  });

  test("rejects state mismatches and increments redemption attempts", async () => {
    const { store, token } = await issueMagicLink();

    await expect(
      consumeMagicLink(store, {
        token,
        state: "wrong-state",
        ip: "127.0.0.1",
        userAgent: "vitest",
        now: "2026-04-17T00:05:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "state_mismatch"
    });

    const record = await store.findMagicLinkByHash(hashToken(token));
    expect(record?.redemptionAttempts).toBe(1);
  });

  test("rejects unknown tokens", async () => {
    const store = createInMemoryAuthStore();

    await expect(
      consumeMagicLink(store, {
        token: "does-not-exist",
        state: "state",
        ip: "127.0.0.1",
        userAgent: "vitest",
        now: "2026-04-17T00:05:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "token_not_found"
    });
  });

  test("blocks redemption after three failed attempts", async () => {
    const { store, token } = await issueMagicLink();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        consumeMagicLink(store, {
          token,
          state: "wrong-state",
          ip: "127.0.0.1",
          userAgent: "vitest",
          now: `2026-04-17T00:0${attempt + 1}:00.000Z`
        })
      ).rejects.toMatchObject({
        code: "state_mismatch"
      });
    }

    await expect(
      consumeMagicLink(store, {
        token,
        state: "wrong-state",
        ip: "127.0.0.1",
        userAgent: "vitest",
        now: "2026-04-17T00:04:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "token_redemption_limit"
    });
  });
});
