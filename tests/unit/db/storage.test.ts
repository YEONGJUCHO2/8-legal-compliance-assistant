import type { Sql } from "postgres";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { createMockSql } from "../helpers/mock-postgres";

let currentDb: Sql;

vi.mock("@/lib/db/client", () => ({
  getDb: () => currentDb
}));

describe("createDbLawStorage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("returns lexical candidates mapped from joined postgres rows", async () => {
    const mock = createMockSql([
      () => [
        {
          article_id: "article-1",
          article_version_id: "version-1",
          law_id: "law-ext-1",
          law_title: "산업안전보건법",
          article_no: "제10조",
          paragraph: null,
          item: null,
          kind: "article",
          title: "안전조치",
          body: "사업주는 안전조치를 하여야 한다.",
          effective_from: "2025-01-01",
          effective_to: null,
          repealed_at: null,
          snapshot_hash: "snap-1",
          source_hash: "source-1"
        }
      ]
    ]);
    currentDb = mock.sql;
    const { createDbLawStorage } = await import("@/lib/db/storage");
    const storage = createDbLawStorage();

    const candidates = await storage.findArticlesByLexical(["안전조치", "사업주"], {
      referenceDate: "2026-04-18",
      limit: 5
    });

    expect(candidates[0]).toMatchObject({
      articleId: "article-1",
      articleVersionId: "version-1",
      lawId: "law-ext-1",
      lawTitle: "산업안전보건법",
      articleNo: "제10조",
      snippet: "사업주는 안전조치를 하여야 한다."
    });
    expect(mock.calls[0].query).toContain("similarity(");
    expect(mock.calls[0].query).toContain("unaccent(lower");
    expect(mock.calls[0].query).toContain("ORDER BY lexical_similarity DESC");
  });

  test("looks up article numbers and snapshot cache rows", async () => {
    const mock = createMockSql([
      () => [
        {
          article_id: "article-2",
          article_version_id: "version-2",
          law_id: "LSA001",
          law_title: "산업안전보건법",
          article_no: "제4조",
          paragraph: "1",
          item: null,
          kind: "article",
          title: "정의",
          body: "정의 조항",
          effective_from: "2025-01-01",
          effective_to: null,
          repealed_at: null,
          snapshot_hash: "snap-2",
          source_hash: "source-2"
        }
      ],
      () => [
        {
          article_id: "article-3",
          article_version_id: "version-3",
          law_id: "LSA001",
          law_title: "산업안전보건법",
          article_no: "제5조",
          paragraph: null,
          item: null,
          kind: "article",
          title: "사업주의 의무",
          body: "사업주의 의무 조항",
          effective_from: "2025-01-01",
          effective_to: null,
          repealed_at: null,
          snapshot_hash: "snap-cache",
          source_hash: "source-cache"
        }
      ]
    ]);
    currentDb = mock.sql;
    const { createDbLawStorage } = await import("@/lib/db/storage");
    const storage = createDbLawStorage();

    const numbered = await storage.findArticlesByNumber("산안법", "제4조", {
      referenceDate: "2026-04-18"
    });
    const cached = await storage.findFromSnapshotCache(["snap-cache"], {
      referenceDate: "2026-04-18"
    });

    expect(numbered[0]).toMatchObject({
      articleNo: "제4조",
      paragraph: "1"
    });
    expect(cached[0]).toMatchObject({
      snapshotHash: "snap-cache",
      matchedFromSnapshot: true
    });
    expect(mock.calls[1].query).toContain("ANY($1::text[])");
  });

  test("hydrates article rows in input order", async () => {
    const mock = createMockSql([
      () => [
        {
          article_id: "article-2",
          article_version_id: "version-2",
          law_id: "law-ext-2",
          law_title: "중대재해 처벌 등에 관한 법률",
          article_no: "제2조",
          paragraph: null,
          item: null,
          kind: "article",
          title: "정의",
          body: "정의 본문",
          effective_from: "2025-01-01",
          effective_to: null,
          repealed_at: null,
          snapshot_hash: "snap-2",
          source_hash: "source-2"
        },
        {
          article_id: "article-1",
          article_version_id: "version-1",
          law_id: "law-ext-1",
          law_title: "산업안전보건법",
          article_no: "제10조",
          paragraph: null,
          item: null,
          kind: "article",
          title: "안전조치",
          body: "안전조치 본문",
          effective_from: "2025-01-01",
          effective_to: null,
          repealed_at: null,
          snapshot_hash: "snap-1",
          source_hash: "source-1"
        }
      ]
    ]);
    currentDb = mock.sql;
    const { createDbLawStorage } = await import("@/lib/db/storage");
    const storage = createDbLawStorage();

    const hydrated = await storage.hydrateArticles(["article-1", "article-2"]);

    expect(hydrated.map((article) => article.articleId)).toEqual(["article-1", "article-2"]);
    expect(mock.calls[0].query).toContain("ANY($1::uuid[])");
  });
});
