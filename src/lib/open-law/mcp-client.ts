import { z } from "zod";

import type { OpenLawFetchImpl } from "@/lib/open-law/types";

const mcpLawSchema = z
  .object({
    lawId: z.string().min(1),
    title: z.string().min(1)
  })
  .strict();

const mcpArticleSchema = z
  .object({
    lawId: z.string().min(1),
    articleNo: z.string().min(1),
    paragraph: z.string().nullable().optional(),
    item: z.string().nullable().optional(),
    body: z.string().min(1),
    snapshotHash: z.string().min(1),
    latestArticleVersionId: z.string().nullable().optional(),
    changeSummary: z.string().nullable().optional()
  })
  .strict();

const mcpEffectiveRangeSchema = z
  .object({
    effectiveFrom: z.string().nullable(),
    effectiveTo: z.string().nullable(),
    repealedAt: z.string().nullable()
  })
  .strict();

export type MCPLaw = z.infer<typeof mcpLawSchema>;
export type MCPArticle = z.infer<typeof mcpArticleSchema>;
export type MCPEffectiveRange = z.infer<typeof mcpEffectiveRangeSchema>;

export interface KoreanLawMcpClient {
  lookupLaw(title: string): Promise<MCPLaw>;
  lookupArticle(params: {
    lawId: string;
    articleNo: string;
    paragraph?: string;
    item?: string;
  }): Promise<MCPArticle>;
  queryEffectiveDate(params: {
    lawId: string;
    articleNo: string;
    referenceDate: string;
  }): Promise<MCPEffectiveRange>;
}

export class MCPResponseError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MCPResponseError";
    this.status = status;
  }
}

export class MCPNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MCPNotFoundError";
  }
}

async function fetchJson<T>({
  url,
  fetchImpl,
  timeoutMs,
  authToken,
  schema
}: {
  url: URL;
  fetchImpl: OpenLawFetchImpl;
  timeoutMs: number;
  authToken?: string;
  schema: z.ZodSchema<T>;
}) {
  let response: Response;

  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: authToken
        ? {
            Authorization: `Bearer ${authToken}`
          }
        : undefined,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new MCPResponseError(`MCP request failed for ${url.pathname}`, null, { cause: error });
  }

  if (response.status === 404) {
    throw new MCPNotFoundError(`MCP resource not found for ${url.pathname}`);
  }

  if (!response.ok) {
    throw new MCPResponseError(`MCP request failed with status ${response.status}`, response.status);
  }

  let json: unknown;

  try {
    json = await response.json();
  } catch (error) {
    throw new MCPResponseError(`MCP JSON decode failed for ${url.pathname}`, response.status, { cause: error });
  }

  try {
    return schema.parse(json);
  } catch (error) {
    throw new MCPResponseError(`MCP response mapping failed for ${url.pathname}`, response.status, { cause: error });
  }
}

export function createKoreanLawMcpClient({
  baseUrl,
  fetchImpl = fetch,
  authToken,
  timeoutMs = 3_000
}: {
  baseUrl: string;
  fetchImpl?: OpenLawFetchImpl;
  authToken?: string;
  timeoutMs?: number;
}): KoreanLawMcpClient {
  const resolvedBaseUrl = baseUrl.replace(/\/$/, "");

  return {
    lookupLaw(title) {
      const url = new URL(`${resolvedBaseUrl}/laws/lookup`);
      url.searchParams.set("title", title);

      return fetchJson({
        url,
        fetchImpl,
        timeoutMs,
        authToken,
        schema: mcpLawSchema
      });
    },
    lookupArticle({ lawId, articleNo, paragraph, item }) {
      const url = new URL(`${resolvedBaseUrl}/articles/lookup`);
      url.searchParams.set("lawId", lawId);
      url.searchParams.set("articleNo", articleNo);

      if (paragraph) {
        url.searchParams.set("paragraph", paragraph);
      }

      if (item) {
        url.searchParams.set("item", item);
      }

      return fetchJson({
        url,
        fetchImpl,
        timeoutMs,
        authToken,
        schema: mcpArticleSchema
      });
    },
    queryEffectiveDate({ lawId, articleNo, referenceDate }) {
      const url = new URL(`${resolvedBaseUrl}/articles/effective-range`);
      url.searchParams.set("lawId", lawId);
      url.searchParams.set("articleNo", articleNo);
      url.searchParams.set("referenceDate", referenceDate);

      return fetchJson({
        url,
        fetchImpl,
        timeoutMs,
        authToken,
        schema: mcpEffectiveRangeSchema
      });
    }
  };
}
