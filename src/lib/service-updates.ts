import type { Sql } from "postgres";

import { resolveBehaviorVersion } from "@/lib/behavior-version";
import { getDb } from "@/lib/db/client";

export type ServiceUpdate = {
  id: string;
  title: string;
  summary: string;
  behaviorVersion: string;
  effectiveDate: string;
  createdAt: string;
};

export interface ServiceUpdateStore {
  listRecent(limit: number): Promise<ServiceUpdate[]>;
  publish(update: ServiceUpdate): Promise<void>;
}

export interface PgServiceUpdateStore extends ServiceUpdateStore {
  db: Sql;
}

export function createInMemoryServiceUpdateStore(seed?: ServiceUpdate[]): ServiceUpdateStore & { reset(): void } {
  const updates = [...(seed ?? [])];

  return {
    async listRecent(limit) {
      return updates
        .slice()
        .sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate))
        .slice(0, limit);
    },
    async publish(update) {
      updates.push(structuredClone(update));
    },
    reset() {
      updates.length = 0;
    }
  };
}

export async function listRecentServiceUpdates(store: ServiceUpdateStore, limit = 5) {
  return store.listRecent(limit);
}

export async function publishServiceUpdate(
  store: ServiceUpdateStore,
  input: {
    title: string;
    summary: string;
    behaviorVersion: string;
    effectiveDate: string;
  }
) {
  const update: ServiceUpdate = {
    id: `${input.behaviorVersion}:${input.effectiveDate}`,
    title: input.title,
    summary: input.summary,
    behaviorVersion: input.behaviorVersion,
    effectiveDate: input.effectiveDate,
    createdAt: `${input.effectiveDate}T00:00:00.000Z`
  };
  await store.publish(update);
  return update;
}

type ServiceUpdateRow = {
  id: string;
  title: string;
  summary: string;
  behavior_version: string;
  effective_date: string;
  created_at: string;
};

function mapServiceUpdate(row: ServiceUpdateRow): ServiceUpdate {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    behaviorVersion: row.behavior_version,
    effectiveDate: row.effective_date,
    createdAt: row.created_at
  };
}

export function createPgServiceUpdateStore(db: Sql = getDb()): PgServiceUpdateStore {
  return {
    db,
    async listRecent(limit) {
      const rows = await db.unsafe<ServiceUpdateRow[]>(
        `
          SELECT id, title, summary, behavior_version, effective_date, created_at
          FROM service_updates
          ORDER BY effective_date DESC
          LIMIT $1
        `,
        [limit]
      );

      return rows.map((row) => mapServiceUpdate(row));
    },
    async publish(update) {
      await db.unsafe(
        `
          INSERT INTO service_updates (id, title, summary, behavior_version, effective_date, created_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE
          SET title = EXCLUDED.title,
              summary = EXCLUDED.summary,
              behavior_version = EXCLUDED.behavior_version,
              effective_date = EXCLUDED.effective_date,
              created_at = EXCLUDED.created_at
        `,
        [update.id, update.title, update.summary, update.behaviorVersion, update.effectiveDate, update.createdAt]
      );
    }
  };
}

export function createDefaultServiceUpdateSeed(): ServiceUpdate[] {
  return [
    {
      id: `${resolveBehaviorVersion()}:2026-04-18`,
      title: "관측 기능 추가",
      summary: "요청 ID, 레이트리밋, 서비스 업데이트, 메트릭 스냅샷이 추가되었습니다.",
      behaviorVersion: resolveBehaviorVersion(),
      effectiveDate: "2026-04-18",
      createdAt: "2026-04-18T00:00:00.000Z"
    }
  ];
}
