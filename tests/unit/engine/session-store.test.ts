import { describe, expect, test } from "vitest";

import {
  SessionNotFoundError,
  bindHandle,
  createInMemoryEngineSessionStore
} from "@/lib/assistant/engine/session-store";

describe("bindHandle", () => {
  test("mints a new handle when sessionId is missing", async () => {
    const store = createInMemoryEngineSessionStore();

    const row = await bindHandle(
      {
        userId: "user-1",
        provider: "anthropic",
        expiresAt: "2026-01-01T00:00:00.000Z"
      },
      store
    );

    expect(row.user_id).toBe("user-1");
    expect(row.provider).toBe("anthropic");
    expect(row.id).toBeTruthy();
    expect(row.handle).toBeTruthy();
  });

  test("rejects another user's session handle", async () => {
    const store = createInMemoryEngineSessionStore([
      {
        id: "session-1",
        user_id: "owner-user",
        provider: "anthropic",
        handle: "provider-handle-1",
        created_at: "2025-01-01T00:00:00.000Z",
        expires_at: "2026-01-01T00:00:00.000Z",
        revoked_at: null
      }
    ]);

    await expect(
      bindHandle(
        {
          userId: "different-user",
          provider: "anthropic",
          sessionId: "session-1",
          expiresAt: "2026-01-01T00:00:00.000Z"
        },
        store
      )
    ).rejects.toThrow(SessionNotFoundError);
  });

  test("rejects expired handles", async () => {
    const store = createInMemoryEngineSessionStore([
      {
        id: "session-expired",
        user_id: "user-1",
        provider: "anthropic",
        handle: "provider-handle-expired",
        created_at: "2025-01-01T00:00:00.000Z",
        expires_at: "2025-01-02T00:00:00.000Z",
        revoked_at: null
      }
    ]);

    await expect(
      bindHandle(
        {
          userId: "user-1",
          provider: "anthropic",
          sessionId: "session-expired",
          expiresAt: "2026-01-01T00:00:00.000Z",
          now: "2025-02-01T00:00:00.000Z"
        },
        store
      )
    ).rejects.toThrow(/session_not_found/);
  });

  test("allows minting a fresh handle after an expired session exists", async () => {
    const store = createInMemoryEngineSessionStore([
      {
        id: "session-expired",
        user_id: "user-1",
        provider: "anthropic",
        handle: "provider-handle-expired",
        created_at: "2025-01-01T00:00:00.000Z",
        expires_at: "2025-01-02T00:00:00.000Z",
        revoked_at: null
      }
    ]);

    const row = await bindHandle(
      {
        userId: "user-1",
        provider: "anthropic",
        expiresAt: "2026-01-01T00:00:00.000Z",
        now: "2025-02-01T00:00:00.000Z"
      },
      store
    );

    expect(row.id).not.toBe("session-expired");
    expect(row.user_id).toBe("user-1");
  });
});
