import { describe, expect, test } from "vitest";

import {
  createInMemoryServiceUpdateStore,
  createPgServiceUpdateStore,
  listRecentServiceUpdates,
  publishServiceUpdate
} from "@/lib/service-updates";

import { createMockSql } from "./helpers/mock-postgres";

describe("service-updates", () => {
  test("publishes and lists recent behavior-version summaries", async () => {
    const store = createInMemoryServiceUpdateStore();

    await publishServiceUpdate(store, {
      title: "관측 기능 추가",
      summary: "요청 ID와 metrics가 추가되었습니다.",
      behaviorVersion: "bv-2026-04-18-obsv",
      effectiveDate: "2026-04-18"
    });

    const updates = await listRecentServiceUpdates(store, 5);
    expect(updates).toHaveLength(1);
    expect(updates[0].behaviorVersion).toBe("bv-2026-04-18-obsv");
  });

  test("publishes idempotently and lists recent postgres-backed updates", async () => {
    const mock = createMockSql([
      () => [],
      () => [
        {
          id: "bv-2026-04-18-obsv:2026-04-18",
          title: "관측 기능 추가",
          summary: "요청 ID와 metrics가 추가되었습니다.",
          behavior_version: "bv-2026-04-18-obsv",
          effective_date: "2026-04-18",
          created_at: "2026-04-18T00:00:00.000Z"
        }
      ]
    ]);
    const store = createPgServiceUpdateStore(mock.sql);

    await store.publish({
      id: "bv-2026-04-18-obsv:2026-04-18",
      title: "관측 기능 추가",
      summary: "요청 ID와 metrics가 추가되었습니다.",
      behaviorVersion: "bv-2026-04-18-obsv",
      effectiveDate: "2026-04-18",
      createdAt: "2026-04-18T00:00:00.000Z"
    });
    const updates = await store.listRecent(5);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      id: "bv-2026-04-18-obsv:2026-04-18",
      behaviorVersion: "bv-2026-04-18-obsv"
    });
    expect(mock.calls[0].query).toContain("ON CONFLICT (id) DO UPDATE");
    expect(mock.calls[1].query).toContain("ORDER BY effective_date DESC");
  });
});
