import { describe, expect, test, vi } from "vitest";

import { createConsoleMailer } from "@/lib/auth/email";
import { createInMemoryAuthStore } from "@/lib/auth/in-memory-store";
import { requestMagicLink } from "@/lib/auth/magic-link";
import { hashToken } from "@/lib/auth/tokens";
import { createInMemoryRateLimitStore } from "@/lib/rate-limit";

describe("requestMagicLink", () => {
  test("issues a magic link and stores only the token hash", async () => {
    const store = createInMemoryAuthStore();
    const mailer = {
      send: vi.fn(async () => {})
    };

    const result = await requestMagicLink(store, {
      email: "User@Example.com",
      ip: "127.0.0.1",
      userAgent: "vitest",
      now: "2026-04-17T00:00:00.000Z",
      appBaseUrl: "https://example.test",
      mailer
    });

    const url = new URL(result.magicUrl);
    const rawToken = url.searchParams.get("token");

    expect(url.searchParams.get("state")).toBe(result.state);
    expect(rawToken).toBeTruthy();
    expect(result.expiresAt).toBe("2026-04-17T00:15:00.000Z");
    expect(mailer.send).toHaveBeenCalledTimes(1);

    const stored = await store.findMagicLinkByHash(hashToken(rawToken!));
    expect(stored).toBeTruthy();
    expect(stored?.tokenHash).toBe(hashToken(rawToken!));
    expect(stored?.email).toBe("user@example.com");
    expect(stored?.state).toBe(result.state);
  });

  test("rejects requests over 5 per email per hour", async () => {
    const store = createInMemoryAuthStore();

    for (let index = 0; index < 5; index += 1) {
      await requestMagicLink(store, {
        email: "user@example.com",
        ip: "127.0.0.1",
        userAgent: "vitest",
        now: `2026-04-17T00:${index}0:00.000Z`,
        appBaseUrl: "https://example.test",
        mailer: {
          send: async () => {}
        }
      });
    }

    await expect(
      requestMagicLink(store, {
        email: "user@example.com",
        ip: "127.0.0.1",
        userAgent: "vitest",
        now: "2026-04-17T00:55:00.000Z",
        appBaseUrl: "https://example.test"
      })
    ).rejects.toMatchObject({
      code: "too_many_requests"
    });
  });

  test("supports the console mailer stub without SMTP", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const mailer = createConsoleMailer();

    await mailer.send({
      to: "user@example.com",
      expiresAt: "2026-04-17T00:15:00.000Z",
      magicUrl: "https://example.test/login?token=secret-token&state=secret-state"
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(String(infoSpy.mock.calls[0]?.[0])).toContain("preview=");
    expect(String(infoSpy.mock.calls[0]?.[0])).not.toContain("secret-token");
    expect(String(infoSpy.mock.calls[0]?.[0])).not.toContain("secret-state");
    infoSpy.mockRestore();
  });

  test("applies the abuse backstop across many email targets from the same IP", async () => {
    const store = createInMemoryAuthStore();
    const rateLimitStore = createInMemoryRateLimitStore();

    for (let index = 0; index < 10; index += 1) {
      await requestMagicLink(store, {
        email: `user-${index}@example.com`,
        ip: "127.0.0.1",
        userAgent: "vitest",
        now: "2026-04-17T00:00:00.000Z",
        appBaseUrl: "https://example.test",
        rateLimitStore,
        mailer: {
          send: async () => {}
        }
      });
    }

    await expect(
      requestMagicLink(store, {
        email: "user-11@example.com",
        ip: "127.0.0.1",
        userAgent: "vitest",
        now: "2026-04-17T00:00:00.000Z",
        appBaseUrl: "https://example.test",
        rateLimitStore,
        mailer: {
          send: async () => {}
        }
      })
    ).rejects.toMatchObject({
      code: "too_many_requests"
    });
  });
});
