import { randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";

import { bindHandle, createInMemoryEngineSessionStore } from "@/lib/assistant/engine/session-store";

describe("cross-user session isolation", () => {
  test("rejects all cross-user session replays across random pairs", async () => {
    const rows = Array.from({ length: 50 }, (_, index) => ({
      id: `session-${index}-${randomUUID()}`,
      user_id: `owner-${index}-${randomUUID()}`,
      provider: "anthropic" as const,
      handle: `provider-${index}-${randomUUID()}`,
      created_at: "2025-01-01T00:00:00.000Z",
      expires_at: "2026-01-01T00:00:00.000Z",
      revoked_at: null
    }));
    const store = createInMemoryEngineSessionStore(rows);

    const attempts = rows.map((row, index) =>
      bindHandle(
        {
          userId: `intruder-${index}-${randomUUID()}`,
          provider: "anthropic",
          sessionId: row.id,
          expiresAt: "2026-01-01T00:00:00.000Z"
        },
        store
      )
    );

    const settled = await Promise.allSettled(attempts);

    expect(settled.every((result) => result.status === "rejected")).toBe(true);
  });
});
