import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { getDb } from "../src/lib/db/client";
import { getEnv } from "../src/lib/env";
import { getLawDetail, searchLaws } from "../src/lib/open-law/client";
import { MVP_LAW_TITLES } from "../src/lib/open-law/mvp-corpus";
import { resolveAlias } from "../src/lib/open-law/normalize";
import { computeContentHash, computeSourceHash, sanitizeLawText } from "../src/lib/open-law/sanitize";
import { recordVersionRollover } from "../src/lib/open-law/temporal";
import type {
  LawArticleVersionInput,
  OpenLawFetchImpl,
  OpenLawLawDocument,
  SearchLawResult,
  StoredLawArticle,
  SyncStore,
  SyncSummary
} from "../src/lib/open-law/types";

function selectSearchHit(results: SearchLawResult[], requestedTitle: string) {
  const canonicalTitle = resolveAlias(requestedTitle);

  return (
    results.find((result) => resolveAlias(result.title) === canonicalTitle) ??
    results.find((result) => result.title.includes(canonicalTitle)) ??
    results[0] ??
    null
  );
}

function appendVersionInput(article: StoredLawArticle): LawArticleVersionInput {
  return {
    articleId: article.id,
    version: article.version,
    body: article.body,
    effectiveFrom: article.effectiveFrom,
    effectiveTo: article.effectiveTo,
    repealedAt: article.repealedAt,
    contentHash: article.contentHash,
    changeType: article.version === 1 ? "initial_sync" : "content_changed"
  };
}

async function upsertChunks({
  detailXml,
  law,
  chunks,
  store,
  dryRun,
  summary
}: {
  detailXml: string;
  law: OpenLawLawDocument;
  chunks: Array<{
    articleNo: string;
    paragraph: string | null;
    item: string | null;
    kind: "article" | "paragraph" | "item" | "appendix";
    title: string | null;
    body: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    repealedAt: string | null;
  }>;
  store: SyncStore;
  dryRun: boolean;
  summary: SyncSummary;
}) {
  const sourceHash = computeSourceHash(detailXml);
  const existingDocument = await store.getLawDocumentByExternalId({
    mst: law.mst,
    lawId: law.lawId
  });

  if (existingDocument?.sourceHash === sourceHash) {
    summary.documentsSkippedBySourceHash += 1;
    return;
  }

  summary.documentsSynced += 1;

  if (dryRun) {
    return;
  }

  const savedDocument = await store.saveLawDocument({
    mst: law.mst,
    lawId: law.lawId,
    title: law.title,
    shortTitle: law.shortTitle,
    promulgationDate: law.promulgationDate,
    enforcementDate: law.enforcementDate,
    sourceUrl: law.sourceUrl,
    sourceHash
  });

  for (const chunk of chunks) {
    const sanitizedBody = sanitizeLawText(chunk.body);
    if (!sanitizedBody) {
      continue;
    }

    const contentHash = computeContentHash(sanitizedBody);
    const existingArticle = await store.getLawArticle({
      lawDocumentId: savedDocument.id,
      articleNo: chunk.articleNo,
      paragraph: chunk.paragraph,
      item: chunk.item,
      kind: chunk.kind
    });

    if (!existingArticle) {
      const createdArticle = await store.saveLawArticle({
        lawDocumentId: savedDocument.id,
        articleNo: chunk.articleNo,
        paragraph: chunk.paragraph,
        item: chunk.item,
        kind: chunk.kind,
        title: chunk.title,
        body: sanitizedBody,
        effectiveFrom: chunk.effectiveFrom,
        effectiveTo: chunk.effectiveTo,
        repealedAt: chunk.repealedAt,
        contentHash,
        version: 1
      });

      summary.createdArticles += 1;
      summary.versionRowsCreated += 1;
      await store.appendLawArticleVersion(appendVersionInput(createdArticle));
      continue;
    }

    const rollover = recordVersionRollover(existingArticle, sanitizedBody, {
      effectiveFrom: chunk.effectiveFrom ?? existingArticle.effectiveFrom,
      effectiveTo: chunk.effectiveTo ?? existingArticle.effectiveTo,
      repealedAt: chunk.repealedAt ?? existingArticle.repealedAt
    });

    if (!rollover.changed) {
      continue;
    }

    const updatedArticle = await store.saveLawArticle({
      ...existingArticle,
      title: chunk.title ?? existingArticle.title,
      body: rollover.nextArticle.body,
      contentHash: rollover.nextArticle.contentHash,
      version: rollover.nextArticle.version,
      effectiveFrom: rollover.nextArticle.effectiveFrom ?? null,
      effectiveTo: rollover.nextArticle.effectiveTo ?? null,
      repealedAt: rollover.nextArticle.repealedAt ?? null
    });

    summary.updatedArticles += 1;
    summary.versionRowsCreated += 1;
    await store.appendLawArticleVersion({
      articleId: updatedArticle.id,
      version: updatedArticle.version,
      body: updatedArticle.body,
      effectiveFrom: updatedArticle.effectiveFrom,
      effectiveTo: updatedArticle.effectiveTo,
      repealedAt: updatedArticle.repealedAt,
      contentHash: updatedArticle.contentHash,
      changeType: rollover.newVersionRow?.changeType ?? "content_changed"
    });
  }
}

export async function runSyncLaws({
  titles = [],
  lawIds = [],
  all = false,
  dryRun = false,
  referenceDate = new Date().toISOString().slice(0, 10),
  oc,
  fetchImpl,
  store
}: {
  titles?: string[];
  lawIds?: string[];
  all?: boolean;
  dryRun?: boolean;
  referenceDate?: string;
  oc?: string;
  fetchImpl?: OpenLawFetchImpl;
  store: SyncStore;
}): Promise<SyncSummary> {
  const summary: SyncSummary = {
    targetsProcessed: 0,
    documentsSynced: 0,
    documentsSkippedBySourceHash: 0,
    createdArticles: 0,
    updatedArticles: 0,
    versionRowsCreated: 0,
    dryRun
  };

  const targetTitles = all ? [...MVP_LAW_TITLES] : titles;

  for (const title of targetTitles) {
    summary.targetsProcessed += 1;

    const searchXml = await searchLaws({
      query: resolveAlias(title),
      referenceDate,
      oc,
      fetchImpl
    });
    const searchResults = (await import("../src/lib/open-law/xml")).parseSearchResponse(searchXml);
    const searchHit = selectSearchHit(searchResults, title);

    if (!searchHit) {
      continue;
    }

    const detailXml = await getLawDetail({
      mst: searchHit.mst ?? undefined,
      lawId: searchHit.lawId ?? undefined,
      referenceDate,
      oc,
      fetchImpl
    });
    const detail = (await import("../src/lib/open-law/xml")).parseLawDetail(detailXml);

    await upsertChunks({
      detailXml,
      law: {
        ...detail.law,
        mst: searchHit.mst ?? detail.law.mst
      },
      chunks: [
        ...detail.articles.map((article) => ({
          articleNo: article.articleNo,
          paragraph: article.paragraph,
          item: article.item,
          kind: article.kind,
          title: article.title,
          body: article.body,
          effectiveFrom: article.effectiveFrom,
          effectiveTo: article.effectiveTo,
          repealedAt: article.repealedAt
        })),
        ...detail.appendices.map((appendix) => ({
          articleNo: appendix.label,
          paragraph: null,
          item: null,
          kind: "appendix" as const,
          title: appendix.title,
          body: appendix.body,
          effectiveFrom: appendix.effectiveFrom,
          effectiveTo: appendix.effectiveTo,
          repealedAt: null
        }))
      ],
      store,
      dryRun,
      summary
    });
  }

  for (const lawId of lawIds) {
    summary.targetsProcessed += 1;

    const detailXml = await getLawDetail({
      lawId,
      referenceDate,
      oc,
      fetchImpl
    });
    const detail = (await import("../src/lib/open-law/xml")).parseLawDetail(detailXml);

    await upsertChunks({
      detailXml,
      law: detail.law,
      chunks: [
        ...detail.articles.map((article) => ({
          articleNo: article.articleNo,
          paragraph: article.paragraph,
          item: article.item,
          kind: article.kind,
          title: article.title,
          body: article.body,
          effectiveFrom: article.effectiveFrom,
          effectiveTo: article.effectiveTo,
          repealedAt: article.repealedAt
        })),
        ...detail.appendices.map((appendix) => ({
          articleNo: appendix.label,
          paragraph: null,
          item: null,
          kind: "appendix" as const,
          title: appendix.title,
          body: appendix.body,
          effectiveFrom: appendix.effectiveFrom,
          effectiveTo: appendix.effectiveTo,
          repealedAt: null
        }))
      ],
      store,
      dryRun,
      summary
    });
  }

  return summary;
}

export { type SyncStore } from "../src/lib/open-law/types";

function createSqlSyncStore(): SyncStore {
  const sql = getDb();

  return {
    async getLawDocumentByExternalId({ mst, lawId }) {
      if (!mst && !lawId) {
        return null;
      }

      const rows = await sql<{
        id: string;
        mst: string | null;
        law_id: string | null;
        title: string;
        short_title: string | null;
        promulgation_date: string | null;
        enforcement_date: string | null;
        source_url: string | null;
        snapshot_hash: string;
      }[]>`
        SELECT id, mst, law_id, title, short_title, promulgation_date, enforcement_date, source_url, snapshot_hash
        FROM law_documents
        WHERE ${mst ? sql`mst = ${mst}` : sql`law_id = ${lawId ?? null}`}
        ORDER BY fetched_at DESC NULLS LAST
        LIMIT 1
      `;

      const row = rows[0];
      if (!row) {
        return null;
      }

      return {
        id: row.id,
        mst: row.mst,
        lawId: row.law_id,
        title: row.title,
        shortTitle: row.short_title,
        promulgationDate: row.promulgation_date,
        enforcementDate: row.enforcement_date,
        sourceUrl: row.source_url,
        sourceHash: row.snapshot_hash
      };
    },
    async saveLawDocument(input) {
      const existing = await this.getLawDocumentByExternalId({
        mst: input.mst,
        lawId: input.lawId
      });

      if (existing) {
        const rows = await sql<{
          id: string;
          mst: string | null;
          law_id: string | null;
          title: string;
          short_title: string | null;
          promulgation_date: string | null;
          enforcement_date: string | null;
          source_url: string | null;
          snapshot_hash: string;
        }[]>`
          UPDATE law_documents
          SET title = ${input.title},
              short_title = ${input.shortTitle},
              promulgation_date = ${input.promulgationDate},
              enforcement_date = ${input.enforcementDate},
              source_url = ${input.sourceUrl},
              fetched_at = now(),
              snapshot_hash = ${input.sourceHash},
              is_current = true
          WHERE id = ${existing.id}
          RETURNING id, mst, law_id, title, short_title, promulgation_date, enforcement_date, source_url, snapshot_hash
        `;

        const row = rows[0];
        return {
          id: row.id,
          mst: row.mst,
          lawId: row.law_id,
          title: row.title,
          shortTitle: row.short_title,
          promulgationDate: row.promulgation_date,
          enforcementDate: row.enforcement_date,
          sourceUrl: row.source_url,
          sourceHash: row.snapshot_hash
        };
      }

      const id = randomUUID();
      await sql`
        INSERT INTO law_documents (
          id, mst, law_id, title, short_title, promulgation_date, enforcement_date, source_url, fetched_at, snapshot_hash, is_current
        ) VALUES (
          ${id},
          ${input.mst},
          ${input.lawId},
          ${input.title},
          ${input.shortTitle},
          ${input.promulgationDate},
          ${input.enforcementDate},
          ${input.sourceUrl},
          now(),
          ${input.sourceHash},
          true
        )
      `;

      return { id, ...input };
    },
    async getLawArticle(key) {
      const rows = await sql<{
        id: string;
        law_id: string;
        article_no: string;
        paragraph: string | null;
        item: string | null;
        kind: "article" | "paragraph" | "item" | "appendix";
        title: string | null;
        body: string;
        effective_from: string | null;
        effective_to: string | null;
      }[]>`
        SELECT id, law_id, article_no, paragraph, item, kind, title, body, effective_from, effective_to
        FROM law_articles
        WHERE law_id = ${key.lawDocumentId}
          AND article_no = ${key.articleNo}
          AND paragraph IS NOT DISTINCT FROM ${key.paragraph}
          AND item IS NOT DISTINCT FROM ${key.item}
          AND kind = ${key.kind}
        LIMIT 1
      `;

      const row = rows[0];
      if (!row) {
        return null;
      }

      return {
        id: row.id,
        lawDocumentId: row.law_id,
        articleNo: row.article_no,
        paragraph: row.paragraph,
        item: row.item,
        kind: row.kind,
        title: row.title,
        body: row.body,
        effectiveFrom: row.effective_from,
        effectiveTo: row.effective_to,
        repealedAt: null,
        contentHash: computeContentHash(row.body),
        version: 1
      };
    },
    async saveLawArticle(input) {
      if (input.id) {
        await sql`
          UPDATE law_articles
          SET title = ${input.title},
              body = ${input.body},
              effective_from = ${input.effectiveFrom},
              effective_to = ${input.effectiveTo}
          WHERE id = ${input.id}
        `;

        return { ...input, id: input.id };
      }

      const id = randomUUID();
      await sql`
        INSERT INTO law_articles (
          id, law_id, article_no, paragraph, item, kind, title, body, effective_from, effective_to
        ) VALUES (
          ${id},
          ${input.lawDocumentId},
          ${input.articleNo},
          ${input.paragraph},
          ${input.item},
          ${input.kind},
          ${input.title},
          ${input.body},
          ${input.effectiveFrom},
          ${input.effectiveTo}
        )
      `;

      return { ...input, id };
    },
    async appendLawArticleVersion(input) {
      await sql`
        INSERT INTO law_article_versions (
          id, article_id, effective_from, effective_to, body, change_type
        ) VALUES (
          ${randomUUID()},
          ${input.articleId},
          ${input.effectiveFrom},
          ${input.effectiveTo},
          ${input.body},
          ${input.changeType}
        )
      `;
    }
  };
}

function parseCliArgs(args: string[]) {
  const titles: string[] = [];
  const lawIds: string[] = [];
  let all = false;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--all") {
      all = true;
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--law-id") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--law-id requires a value");
      }

      lawIds.push(value);
      index += 1;
      continue;
    }

    titles.push(arg);
  }

  return { titles, lawIds, all, dryRun };
}

async function main() {
  const { titles, lawIds, all, dryRun } = parseCliArgs(process.argv.slice(2));
  const env = getEnv();
  const store = createSqlSyncStore();
  const summary = await runSyncLaws({
    titles,
    lawIds,
    all,
    dryRun,
    oc: env.LAW_API_KEY,
    store
  });

  console.log(JSON.stringify(summary, null, 2));
}

const isMainModule =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
