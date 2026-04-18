import { describe, expect, test } from "vitest";

import { createInMemoryAuthStore } from "@/lib/auth/in-memory-store";
import { requireAuth } from "@/lib/auth/route-guard";
import { hashToken } from "@/lib/auth/tokens";

describe("requireAuth", () => {
  test("returns auth_expired when no auth cookie is present", async () => {
    const store = createInMemoryAuthStore();

    const result = await requireAuth(
      {
        headers: {}
      },
      store,
      "2026-04-17T00:00:00.000Z"
    );

    expect("response" in result).toBe(true);
    if ("response" in result) {
      expect(result.response).toEqual({
        status: 401,
        body: {
          kind: "auth_expired",
          recoveryUrl: "/login"
        }
      });
    }
  });

  test("returns the authenticated user when the cookie is valid", async () => {
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

    const result = await requireAuth(
      {
        headers: {
          cookie: `app_session=${token}`
        }
      },
      store,
      "2026-04-17T01:00:00.000Z"
    );

    expect("user" in result).toBe(true);
    if ("user" in result) {
      expect(result.user.id).toBe(user.id);
    }
  });
});
