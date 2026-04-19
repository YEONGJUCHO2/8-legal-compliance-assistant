import { randomUUID } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pino from "pino";
import { z } from "zod";

import { searchLaws, getLawDetail } from "../src/lib/open-law/client";
import { resolveAlias, normalizeTitle } from "../src/lib/open-law/normalize";
import { computeContentHash, sanitizeLawText } from "../src/lib/open-law/sanitize";
import type { OpenLawArticle, OpenLawFetchImpl, ParsedLawDetail } from "../src/lib/open-law/types";
import { parseLawDetail, parseSearchResponse } from "../src/lib/open-law/xml";

type OverrideRule = {
  path: string;
  params?: Record<string, string>;
  status?: number;
  body?: string;
  bodyFile?: string;
  headers?: Record<string, string>;
  delayMs?: number;
};

type OpenLawFetchInput = Parameters<OpenLawFetchImpl>[0];
type OpenLawFetchInit = Parameters<OpenLawFetchImpl>[1];

const logger = pino({
  name: "law-mcp-server"
});
const HOST = process.env.LAW_MCP_HOST ?? "127.0.0.1";
const PORT = Number(process.env.LAW_MCP_PORT ?? "4100");
const LAW_API_KEY = process.env.LAW_API_KEY;
const UPSTREAM_TIMEOUT_MS = Number(process.env.LAW_MCP_UPSTREAM_TIMEOUT_MS ?? "15000");
const UPSTREAM_CONCURRENCY = Number(process.env.LAW_MCP_UPSTREAM_CONCURRENCY ?? "5");
const UPSTREAM_QUEUE_LIMIT = Number(process.env.LAW_MCP_UPSTREAM_QUEUE_LIMIT ?? "50");
const CACHE_TTL_MS = Number(process.env.LAW_MCP_CACHE_TTL_MS ?? String(10 * 60 * 1000));
const CACHE_LIMIT = Number(process.env.LAW_MCP_CACHE_LIMIT ?? "1000");
const OVERRIDE_FILE = process.env.OPEN_LAW_FETCH_OVERRIDE_FILE;
const UPSTREAM_LOG_FILE = process.env.LAW_MCP_UPSTREAM_LOG_FILE;

const articleResponseSchema = z
  .object({
    lawId: z.string().min(1),
    articleNo: z.string().min(1),
    paragraph: z.string().nullable(),
    item: z.string().nullable(),
    body: z.string().min(1),
    snapshotHash: z.string().min(1),
    latestArticleVersionId: z.string().nullable(),
    changeSummary: z.string().nullable()
  })
  .strict();

const effectiveRangeResponseSchema = z
  .object({
    effectiveFrom: z.string().nullable(),
    effectiveTo: z.string().nullable(),
    repealedAt: z.string().nullable()
  })
  .strict();

const lawLookupResponseSchema = z
  .object({
    lawId: z.string().min(1),
    title: z.string().min(1)
  })
  .strict();

class RequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "RequestError";
    this.code = code;
    this.status = status;
  }
}

class TtlLruCache {
  private readonly entries = new Map<string, { expiresAt: number; value: unknown }>();

  get<T>(key: string) {
    const entry = this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  set(key: string, value: unknown) {
    this.entries.delete(key);
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS
    });

    while (this.entries.size > CACHE_LIMIT) {
      const oldestKey = this.entries.keys().next().value;

      if (!oldestKey) {
        break;
      }

      this.entries.delete(oldestKey);
    }
  }
}

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  async run<T>(task: () => Promise<T>) {
    if (this.active >= UPSTREAM_CONCURRENCY) {
      if (this.waiting.length >= UPSTREAM_QUEUE_LIMIT) {
        throw new RequestError("engine_busy", "upstream_queue_full", 503);
      }

      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
      });
    }

    this.active += 1;

    try {
      return await task();
    } finally {
      this.active -= 1;
      const next = this.waiting.shift();
      next?.();
    }
  }
}

const cache = new TtlLruCache();
const semaphore = new Semaphore();
let draining = false;
let inFlightRequests = 0;

function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function buildCacheKey(parts: string[]) {
  return parts.join(":");
}

function snapshotHash(body: string) {
  return computeContentHash(sanitizeLawText(body)).slice(0, 32);
}

function stableVersionId(lawId: string, articleNo: string, effectiveFrom: string | null, lawEnforcementDate: string | null) {
  const versionDate = effectiveFrom ?? lawEnforcementDate ?? "undated";
  return `${lawId}:${articleNo}:${versionDate}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function matchOverrideRule(url: URL, rule: OverrideRule) {
  if (url.pathname !== rule.path) {
    return false;
  }

  return Object.entries(rule.params ?? {}).every(([key, expectedValue]) => url.searchParams.get(key) === expectedValue);
}

function resolveFetchUrl(input: OpenLawFetchInput) {
  if (typeof input === "string") {
    return new URL(input);
  }

  if (input instanceof URL) {
    return input;
  }

  return new URL(input.url);
}

async function createOverrideFetch(): Promise<OpenLawFetchImpl> {
  return async (input: OpenLawFetchInput, init?: OpenLawFetchInit) => {
    const url = resolveFetchUrl(input);
    logger.info({ upstreamPath: url.pathname, upstreamQuery: url.search }, "law_mcp_upstream_fetch");
    const raw = await readFile(OVERRIDE_FILE!, "utf8");
    const parsed = JSON.parse(raw) as { rules?: OverrideRule[] };
    const rule = parsed.rules?.find((candidate) => matchOverrideRule(url, candidate));

    if (!rule) {
      return new Response("override_not_found", {
        status: 404
      });
    }

    if (rule.delayMs) {
      await sleep(rule.delayMs);
    }

    if (UPSTREAM_LOG_FILE) {
      await appendFile(UPSTREAM_LOG_FILE, `${url.toString()}\n`, "utf8");
    }

    const body =
      rule.bodyFile !== undefined
        ? await readFile(path.isAbsolute(rule.bodyFile) ? rule.bodyFile : path.resolve(path.dirname(OVERRIDE_FILE!), rule.bodyFile), "utf8")
        : (rule.body ?? "");

    return new Response(body, {
      status: rule.status ?? 200,
      headers: rule.headers ?? {
        "content-type": "application/xml; charset=utf-8"
      }
    });
  };
}

async function createOpenLawFetch() {
  if (OVERRIDE_FILE) {
    return createOverrideFetch();
  }

  return async (input: OpenLawFetchInput, init?: OpenLawFetchInit) => {
    const url = resolveFetchUrl(input);
    logger.info({ upstreamPath: url.pathname, upstreamQuery: url.search }, "law_mcp_upstream_fetch");
    return fetch(input, init);
  };
}

function parseUrl(request: IncomingMessage) {
  return new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
}

function parseReferenceDate(value: string | null, paramName: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RequestError("bad_request", `${paramName}_must_be_yyyy_mm_dd`, 400);
  }

  return value;
}

function parseRequired(value: string | null, paramName: string) {
  if (!value) {
    throw new RequestError("bad_request", `${paramName}_required`, 400);
  }

  return value;
}

function selectLawResult(results: ReturnType<typeof parseSearchResponse>, title: string) {
  const canonical = normalizeTitle(title);

  return (
    results.find((result) => normalizeTitle(result.title) === canonical && result.lawId) ??
    results.find((result) => normalizeTitle(result.title).includes(canonical) && result.lawId) ??
    results.find((result) => Boolean(result.lawId)) ??
    null
  );
}

function selectArticle(detail: ParsedLawDetail, params: {
  articleNo: string;
  paragraph?: string | null;
  item?: string | null;
}) {
  const candidates = detail.articles.filter((article) => article.articleNo === params.articleNo);

  if (params.item) {
    return (
      candidates.find((article) => article.kind === "item" && article.item === params.item && (!params.paragraph || article.paragraph === params.paragraph)) ??
      null
    );
  }

  if (params.paragraph) {
    return candidates.find((article) => article.kind === "paragraph" && article.paragraph === params.paragraph) ?? null;
  }

  return candidates.find((article) => article.kind === "article") ?? null;
}

async function loadLawLookup(title: string) {
  const canonicalTitle = resolveAlias(title);
  const cacheKey = buildCacheKey(["law", canonicalTitle]);
  const cached = cache.get<z.infer<typeof lawLookupResponseSchema>>(cacheKey);

  if (cached) {
    logger.info({ cacheKey, cache: "hit" }, "law_lookup_cache");
    return cached;
  }

  logger.info({ cacheKey, cache: "miss" }, "law_lookup_cache");
  const fetchImpl = await createOpenLawFetch();
  const xml = await semaphore.run(async () =>
    searchLaws({
      query: canonicalTitle,
      referenceDate: today(),
      oc: LAW_API_KEY,
      fetchImpl,
      timeoutMs: UPSTREAM_TIMEOUT_MS
    })
  );
  const result = selectLawResult(parseSearchResponse(xml), canonicalTitle);

  if (!result?.lawId) {
    throw new RequestError("not_found", "not_found", 404);
  }

  const payload = lawLookupResponseSchema.parse({
    lawId: result.lawId,
    title: result.title
  });
  cache.set(cacheKey, payload);
  return payload;
}

async function loadLawDetail(lawId: string, referenceDate: string) {
  const cacheKey = buildCacheKey(["detail", lawId, referenceDate]);
  const cached = cache.get<ParsedLawDetail>(cacheKey);

  if (cached) {
    logger.info({ cacheKey, cache: "hit" }, "law_detail_cache");
    return cached;
  }

  logger.info({ cacheKey, cache: "miss" }, "law_detail_cache");
  const fetchImpl = await createOpenLawFetch();
  const xml = await semaphore.run(async () =>
    getLawDetail({
      lawId,
      referenceDate,
      oc: LAW_API_KEY,
      fetchImpl,
      timeoutMs: UPSTREAM_TIMEOUT_MS
    })
  );
  const detail = parseLawDetail(xml);
  cache.set(cacheKey, detail);
  return detail;
}

async function handleLawLookup(url: URL) {
  const title = parseRequired(url.searchParams.get("title"), "title");
  return loadLawLookup(title);
}

async function handleArticleLookup(url: URL) {
  const lawId = parseRequired(url.searchParams.get("lawId"), "lawId");
  const articleNo = parseRequired(url.searchParams.get("articleNo"), "articleNo");
  const paragraph = url.searchParams.get("paragraph");
  const item = url.searchParams.get("item");
  const cacheKey = buildCacheKey(["article", lawId, articleNo, paragraph ?? "", item ?? ""]);
  const cached = cache.get<z.infer<typeof articleResponseSchema>>(cacheKey);

  if (cached) {
    logger.info({ cacheKey, cache: "hit" }, "article_lookup_cache");
    return cached;
  }

  logger.info({ cacheKey, cache: "miss" }, "article_lookup_cache");
  const detail = await loadLawDetail(lawId, today());
  const selected = selectArticle(detail, {
    articleNo,
    paragraph,
    item
  });

  if (!selected) {
    throw new RequestError("not_found", "not_found", 404);
  }

  const payload = articleResponseSchema.parse({
    lawId,
    articleNo: selected.articleNo,
    paragraph: selected.paragraph,
    item: selected.item,
    body: selected.body,
    snapshotHash: snapshotHash(selected.body),
    latestArticleVersionId: stableVersionId(lawId, selected.articleNo, selected.effectiveFrom ?? null, detail.law.enforcementDate),
    changeSummary: selected.changeSummary ?? null
  });
  cache.set(cacheKey, payload);
  return payload;
}

async function handleEffectiveRange(url: URL) {
  const lawId = parseRequired(url.searchParams.get("lawId"), "lawId");
  const articleNo = parseRequired(url.searchParams.get("articleNo"), "articleNo");
  const referenceDate = parseReferenceDate(url.searchParams.get("referenceDate"), "referenceDate");
  const cacheKey = buildCacheKey(["effective", lawId, articleNo, referenceDate]);
  const cached = cache.get<z.infer<typeof effectiveRangeResponseSchema>>(cacheKey);

  if (cached) {
    logger.info({ cacheKey, cache: "hit" }, "effective_range_cache");
    return cached;
  }

  logger.info({ cacheKey, cache: "miss" }, "effective_range_cache");
  const detail = await loadLawDetail(lawId, referenceDate);
  const selected = selectArticle(detail, {
    articleNo
  });

  if (!selected) {
    throw new RequestError("not_found", "not_found", 404);
  }

  const payload = effectiveRangeResponseSchema.parse({
    effectiveFrom: selected.effectiveFrom ?? detail.law.enforcementDate ?? null,
    effectiveTo: selected.effectiveTo ?? null,
    repealedAt: selected.repealedAt ?? null
  });
  cache.set(cacheKey, payload);
  return payload;
}

function mapError(error: unknown) {
  if (error instanceof RequestError) {
    return error;
  }

  if (error instanceof z.ZodError) {
    return new RequestError("upstream_schema_mismatch", error.message, 502);
  }

  if (error instanceof Error && error.name === "TimeoutError") {
    return new RequestError("upstream_timeout", "upstream_timeout", 504);
  }

  if (error instanceof Error && /request failed: 5\d\d/i.test(error.message)) {
    return new RequestError("upstream_failure", "upstream_failure", 502);
  }

  if (error instanceof Error && /request failed/i.test(error.message)) {
    return new RequestError("upstream_failure", error.message, 502);
  }

  return new RequestError("upstream_failure", error instanceof Error ? error.message : "upstream_failure", 502);
}

async function routeRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== "GET") {
    writeJson(response, 405, {
      error: "method_not_allowed"
    });
    return;
  }

  const requestId = randomUUID();
  const startedAt = Date.now();
  const url = parseUrl(request);

  inFlightRequests += 1;
  logger.info({ requestId, path: url.pathname, query: url.search }, "law_mcp_request_started");

  try {
    if (url.pathname === "/health") {
      writeJson(response, 200, {
        ok: true,
        upstream: "open.law.go.kr"
      });
      return;
    }

    if (draining) {
      throw new RequestError("server_draining", "server_draining", 503);
    }

    if (url.pathname === "/laws/lookup") {
      writeJson(response, 200, await handleLawLookup(url));
      return;
    }

    if (url.pathname === "/articles/lookup") {
      writeJson(response, 200, await handleArticleLookup(url));
      return;
    }

    if (url.pathname === "/articles/effective-range") {
      writeJson(response, 200, await handleEffectiveRange(url));
      return;
    }

    throw new RequestError("not_found", "not_found", 404);
  } catch (error) {
    const mapped = mapError(error);
    writeJson(response, mapped.status, {
      error: mapped.code === "not_found" ? "not_found" : mapped.code
    });
    logger.error({ requestId, path: url.pathname, code: mapped.code, error: mapped.message }, "law_mcp_request_failed");
  } finally {
    inFlightRequests -= 1;
    logger.info({ requestId, path: url.pathname, elapsedMs: Date.now() - startedAt }, "law_mcp_request_completed");
  }
}

export async function startLawMcpServer() {
  if (!LAW_API_KEY) {
    throw new Error("LAW_API_KEY is required");
  }

  const server = createServer((request, response) => {
    void routeRequest(request, response);
  });

  await new Promise<void>((resolve) => {
    server.listen(PORT, HOST, () => resolve());
  });

  logger.info({ host: HOST, port: PORT }, "law_mcp_server_listening");

  const shutdown = () => {
    if (draining) {
      return;
    }

    draining = true;
    server.close(() => {
      const poll = setInterval(() => {
        if (inFlightRequests === 0) {
          clearInterval(poll);
          logger.info("law_mcp_server_stopped");
          process.exit(0);
        }
      }, 50);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return server;
}

const isMainModule =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  void startLawMcpServer().catch((error) => {
    logger.error({ error }, "law_mcp_server_boot_failed");
    process.exitCode = 1;
  });
}
