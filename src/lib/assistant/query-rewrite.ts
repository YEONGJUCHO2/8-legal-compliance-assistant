import { buildQueryRewritePrompt } from "@/lib/assistant/engine/prompt";
import type { EngineAdapter } from "@/lib/assistant/engine/types";
import type { AppLogger } from "@/lib/logging";
import { QueryRewriteSchema, type QueryRewriteOutput } from "@/lib/assistant/schemas";
import { normalizeQuery, parseArticleNumberHints, tokenizeQuery } from "@/lib/search/normalize-query";
import type { ArticleNumberHint } from "@/lib/search/types";

const DEFAULT_QUERY_REWRITE_DEADLINE_MS = 10_000;
const DEFAULT_QUERY_TOKEN_CAP = 8;

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function dedupeArticleHints(hints: ArticleNumberHint[]) {
  const byKey = new Map<string, ArticleNumberHint>();

  for (const hint of hints) {
    const key =
      hint.kind === "appendix"
        ? `appendix:${hint.label}`
        : `article:${hint.articleNo}:${hint.paragraph ?? ""}:${hint.item ?? ""}`;

    if (!byKey.has(key)) {
      byKey.set(key, hint);
    }
  }

  return [...byKey.values()];
}

function isTimeoutError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  if ("code" in error && error.code === "engine_timeout") {
    return true;
  }

  if ("name" in error && error.name === "AbortError") {
    return true;
  }

  return "message" in error && typeof error.message === "string" && /timeout/i.test(error.message);
}

export function mergeQueryRewriteHints({
  question,
  rewrite,
  tokenCap = DEFAULT_QUERY_TOKEN_CAP
}: {
  question: string;
  rewrite: QueryRewriteOutput | null;
  tokenCap?: number;
}) {
  const normalized = normalizeQuery(question);
  const rewriteTokens = (rewrite?.legal_terms ?? []).flatMap((term) => tokenizeQuery(term));
  const mergedArticleHints = dedupeArticleHints([
    ...((rewrite?.article_hints ?? []).flatMap((hint) => parseArticleNumberHints(hint))),
    ...normalized.articleNumberHints
  ]);

  return {
    tokens: dedupeStrings([...rewriteTokens, ...normalized.tokens]).slice(0, tokenCap),
    lawHints: dedupeStrings([...(rewrite?.law_hints ?? []), ...normalized.lawHints]),
    articleNumberHints: mergedArticleHints,
    intentSummary: rewrite?.intent_summary ?? null,
    rewriteTerms: rewrite?.legal_terms ?? []
  };
}

export async function rewriteQuery({
  engine,
  userId,
  question,
  referenceDate,
  logger,
  sessionId,
  deadlineMs = DEFAULT_QUERY_REWRITE_DEADLINE_MS
}: {
  engine: EngineAdapter;
  userId: string;
  question: string;
  referenceDate: string;
  logger: AppLogger;
  sessionId?: string;
  deadlineMs?: number;
}): Promise<QueryRewriteOutput | null> {
  try {
    const result = await engine.generate({
      userId,
      sessionId,
      prompt: buildQueryRewritePrompt({
        question,
        referenceDate
      }),
      schemaRef: "query_rewrite",
      deadlineMs
    });

    if ("type" in result.response && result.response.type === "schema_error") {
      logger.warn(
        {
          schemaRetries: result.schemaRetries
        },
        "query_rewrite.schema_error"
      );
      return null;
    }

    const parsed = QueryRewriteSchema.parse(result.response);

    logger.info(
      {
        legalTerms: parsed.legal_terms,
        lawHints: parsed.law_hints,
        articleHints: parsed.article_hints
      },
      "query_rewrite.success"
    );

    return parsed;
  } catch (error) {
    if (isTimeoutError(error)) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : "engine_timeout"
        },
        "query_rewrite.timeout"
      );
      return null;
    }

    logger.warn(
      {
        error: error instanceof Error ? error.message : "query_rewrite_failed"
      },
      "query_rewrite.schema_error"
    );
    return null;
  }
}
