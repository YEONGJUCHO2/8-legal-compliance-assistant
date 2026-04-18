// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeEach, describe, expect, test } from "vitest";

import { runSyncLaws, type SyncStore } from "../../../scripts/sync-laws";

const fixturesDir = path.join(process.cwd(), "tests", "fixtures", "open-law");

type MemoryDocument = {
  id: string;
  mst: string | null;
  lawId: string | null;
  title: string;
  shortTitle: string | null;
  promulgationDate: string | null;
  enforcementDate: string | null;
  sourceUrl: string | null;
  sourceHash: string;
};

type MemoryArticle = {
  id: string;
  lawDocumentId: string;
  articleNo: string;
  paragraph: string | null;
  item: string | null;
  kind: "article" | "paragraph" | "item" | "appendix";
  title: string | null;
  body: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  repealedAt: string | null;
  contentHash: string;
  version: number;
};

function articleKey(article: Pick<MemoryArticle, "lawDocumentId" | "articleNo" | "paragraph" | "item" | "kind">) {
  return [
    article.lawDocumentId,
    article.articleNo,
    article.paragraph ?? "",
    article.item ?? "",
    article.kind
  ].join("|");
}

function createMemoryStore() {
  let documentCounter = 0;
  let articleCounter = 0;
  const documents = new Map<string, MemoryDocument>();
  const documentByExternalId = new Map<string, string>();
  const articles = new Map<string, MemoryArticle>();
  const versions: Array<Record<string, unknown>> = [];

  const store: SyncStore = {
    async getLawDocumentByExternalId(key) {
      const id = documentByExternalId.get(`${key.mst ?? ""}|${key.lawId ?? ""}`);
      return id ? documents.get(id) ?? null : null;
    },
    async saveLawDocument(input) {
      const externalKey = `${input.mst ?? ""}|${input.lawId ?? ""}`;
      const existingId = documentByExternalId.get(externalKey);

      if (existingId) {
        const updated = { ...documents.get(existingId)!, ...input };
        documents.set(existingId, updated);
        return updated;
      }

      const id = `doc-${++documentCounter}`;
      const created = { id, ...input };
      documentByExternalId.set(externalKey, id);
      documents.set(id, created);
      return created;
    },
    async getLawArticle(key) {
      return articles.get(articleKey(key as MemoryArticle)) ?? null;
    },
    async saveLawArticle(input) {
      const key = articleKey(input as MemoryArticle);
      const existing = articles.get(key);

      if (existing) {
        const updated = { ...existing, ...input };
        articles.set(key, updated);
        return updated;
      }

      const created = { id: `article-${++articleCounter}`, ...input };
      articles.set(key, created);
      return created;
    },
    async appendLawArticleVersion(input) {
      versions.push(input);
    }
  };

  return { store, documents, articles, versions };
}

describe("sync-laws targeted cache flow", () => {
  let searchXml: string;
  let detailXml: string;

  beforeEach(async () => {
    searchXml = await readFile(path.join(fixturesDir, "san-an-search.xml"), "utf8");
    detailXml = await readFile(path.join(fixturesDir, "san-an-detail.xml"), "utf8");
  });

  test("syncs one target through injected fetch and stays idempotent on rerun", async () => {
    const memory = createMemoryStore();
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      const payload = url.includes("lawSearch.do") ? searchXml : detailXml;

      return new Response(payload, {
        status: 200,
        headers: { "content-type": "application/xml" }
      });
    };

    const first = await runSyncLaws({
      titles: ["산안법"],
      referenceDate: "2025-01-01",
      oc: "test-oc",
      fetchImpl,
      store: memory.store
    });

    const second = await runSyncLaws({
      titles: ["산안법"],
      referenceDate: "2025-01-01",
      oc: "test-oc",
      fetchImpl,
      store: memory.store
    });

    expect(first.documentsSynced).toBe(1);
    expect(memory.documents.size).toBe(1);
    expect(memory.articles.size).toBe(6);
    expect(memory.versions).toHaveLength(6);
    expect(second.documentsSkippedBySourceHash).toBe(1);
    expect(memory.versions).toHaveLength(6);
  });

  test("appends a new version row when sanitized article content changes", async () => {
    const memory = createMemoryStore();
    let currentDetailXml = detailXml;
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      const payload = url.includes("lawSearch.do") ? searchXml : currentDetailXml;

      return new Response(payload, {
        status: 200,
        headers: { "content-type": "application/xml" }
      });
    };

    await runSyncLaws({
      titles: ["산업안전보건법"],
      referenceDate: "2025-01-01",
      oc: "test-oc",
      fetchImpl,
      store: memory.store
    });

    currentDetailXml = currentDetailXml.replace(
      "사업주는 필요한 안전조치를 하여야 한다.",
      "사업주는 강화된 안전조치를 하여야 한다."
    );

    const rerun = await runSyncLaws({
      titles: ["산업안전보건법"],
      referenceDate: "2025-01-01",
      oc: "test-oc",
      fetchImpl,
      store: memory.store
    });

    expect(rerun.versionRowsCreated).toBe(1);
    expect(memory.versions).toHaveLength(7);
    expect(
      [...memory.articles.values()].find((article) => article.articleNo === "제10조" && article.kind === "article")
        ?.body
    ).toContain("강화된 안전조치");
  });
});
