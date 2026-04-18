import { describe, expect, test } from "vitest";

import { createInMemoryAuthStore } from "@/lib/auth/in-memory-store";

describe("identity safety", () => {
  test("reuses the existing user for the same email and provider subject", async () => {
    const store = createInMemoryAuthStore();

    const first = await store.findOrCreateUserByEmail({
      email: "user@example.com",
      provider: "magic_link",
      providerSubject: "magic:user@example.com",
      now: "2026-04-17T00:00:00.000Z"
    });
    const second = await store.findOrCreateUserByEmail({
      email: "user@example.com",
      provider: "magic_link",
      providerSubject: "magic:user@example.com",
      now: "2026-04-17T00:05:00.000Z"
    });

    expect(second.id).toBe(first.id);
    expect(second.internalUserId).toBe(first.internalUserId);
  });

  test("raises identity_conflict when the same email maps to a different durable identity", async () => {
    const store = createInMemoryAuthStore();

    await store.findOrCreateUserByEmail({
      email: "user@example.com",
      provider: "magic_link",
      providerSubject: "magic:user@example.com",
      now: "2026-04-17T00:00:00.000Z"
    });

    await expect(
      store.findOrCreateUserByEmail({
        email: "user@example.com",
        provider: "oidc",
        providerSubject: "oidc:sub-123",
        now: "2026-04-17T00:05:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "identity_conflict"
    });
  });
});
