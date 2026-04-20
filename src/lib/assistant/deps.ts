import { createInMemoryAuthStore } from "@/lib/auth/in-memory-store";
import { createConsoleMailer, type MagicLinkMailer } from "@/lib/auth/email";
import { createSmtpMailer } from "@/lib/auth/email-smtp";
import { createPgAuthStore } from "@/lib/auth/pg-store";
import type { AuthStore } from "@/lib/auth/types";
import { createEngineAdapter } from "@/lib/assistant/engine";
import type { EngineSessionStore } from "@/lib/assistant/engine/session-store";
import type { EngineAdapter } from "@/lib/assistant/engine/types";
import { createInMemoryIdempotencyStore, type IdempotencyStore } from "@/lib/assistant/idempotency";
import { createPgIdempotencyStore } from "@/lib/assistant/idempotency-pg";
import { createInMemoryHistoryStore, type HistoryStore } from "@/lib/assistant/history-store";
import { createPgHistoryStore } from "@/lib/assistant/history-store-pg";
import { createDbLawStorage } from "@/lib/db/storage";
import { getEnv } from "@/lib/env";
import { createLogger, type AppLogger } from "@/lib/logging";
import { createKoreanLawMcpClient } from "@/lib/open-law/mcp-client";
import type { KoreanLawMcpClient } from "@/lib/open-law/mcp-client";
import { generateRequestId } from "@/lib/request-id";
import { createInMemoryRateLimitStore, type RateLimitStore } from "@/lib/rate-limit";
import { createPgRateLimitStore } from "@/lib/rate-limit-pg";
import { createInMemoryStorage } from "@/lib/search/in-memory-storage";
import { retrieve } from "@/lib/search/retrieve";
import type { LawStorage } from "@/lib/search/storage";
import { createDevEngineAdapter, createDevMcpClient, loadDevLawArticles } from "@/lib/assistant/dev-seed";
import {
  createDefaultServiceUpdateSeed,
  createInMemoryServiceUpdateStore,
  createPgServiceUpdateStore,
  type ServiceUpdateStore
} from "@/lib/service-updates";

export interface AssistantDeps {
  authStore: AuthStore;
  storage: LawStorage;
  retrieveFn: typeof retrieve;
  engine: EngineAdapter;
  mcp: KoreanLawMcpClient;
  mailer?: MagicLinkMailer;
  historyStore: HistoryStore;
  idempotencyStore: IdempotencyStore;
  engineSessionStore?: EngineSessionStore;
  logger?: AppLogger;
  generateRequestId?: () => string;
  rateLimitStore?: RateLimitStore & {
    capacity?: number;
    refillPerSec?: number;
  };
  serviceUpdateStore?: ServiceUpdateStore;
  now?: () => Date;
  today?: () => string;
  cancellation?: {
    isCanceled(requestId?: string): boolean;
  };
  runtimeConfig?: {
    queryRewriteDeadlineMs: number;
    retrievalCandidateCap: number;
    retrievalDeadlineMs: number;
    engineDeadlineMs: number;
    mcpVerifyDeadlineMs: number;
    deadlineSafetyMarginMs: number;
  };
}

export class RuntimeConfigurationError extends Error {
  constructor(message = "production_runtime_not_configured") {
    super(message);
    this.name = "RuntimeConfigurationError";
  }
}

function createDefaultDeps(): AssistantDeps {
  const devArticles = loadDevLawArticles();

  return {
    authStore: createInMemoryAuthStore(),
    storage: createInMemoryStorage(devArticles),
    retrieveFn: retrieve,
    engine:
      devArticles.length > 0
        ? createDevEngineAdapter()
        : {
            provider: "anthropic",
            async generate() {
              return {
                sessionId: "default-engine-session",
                schemaRetries: 2,
                response: {
                  type: "schema_error",
                  message: "Default assistant deps are test stubs only.",
                  schema_retry_count: 2
                }
              };
            }
          },
    mcp:
      devArticles.length > 0
        ? createDevMcpClient(devArticles)
        : {
            async lookupLaw(title) {
              return { lawId: `stub:${title}`, title };
            },
            async lookupArticle({ lawId, articleNo }) {
              return {
                lawId,
                articleNo,
                paragraph: null,
                item: null,
                body: "",
                snapshotHash: "",
                latestArticleVersionId: null,
                changeSummary: null
              };
            },
            async queryEffectiveDate() {
              return {
                effectiveFrom: null,
                effectiveTo: null,
                repealedAt: null
              };
            }
          },
    mailer: createConsoleMailer(),
    historyStore: createInMemoryHistoryStore(),
    idempotencyStore: createInMemoryIdempotencyStore(),
    logger: createLogger(),
    generateRequestId,
    rateLimitStore: createInMemoryRateLimitStore(),
    serviceUpdateStore: createInMemoryServiceUpdateStore(createDefaultServiceUpdateSeed()),
    runtimeConfig: {
      queryRewriteDeadlineMs: 10_000,
      retrievalCandidateCap: 5,
      retrievalDeadlineMs: 3_000,
      engineDeadlineMs: 25_000,
      mcpVerifyDeadlineMs: 8_000,
      deadlineSafetyMarginMs: 2_000
    },
    now: () => new Date(),
    today: () => new Date().toISOString().slice(0, 10)
  };
}

function createProductionDeps(): AssistantDeps {
  try {
    const env = getEnv();
    const rateLimitCapacity = 20;
    const rateLimitRefillPerSec = 10 / 60;

    if (!env.SMTP_URL || !env.AUTH_FROM_EMAIL) {
      throw new RuntimeConfigurationError("smtp_runtime_not_configured");
    }

    return {
      authStore: createPgAuthStore(),
      storage: createDbLawStorage(),
      retrieveFn: retrieve,
      engine: createEngineAdapter(env),
      mcp: createKoreanLawMcpClient({
        baseUrl: env.KOREAN_LAW_MCP_URL,
        authToken: env.KOREAN_LAW_MCP_AUTH_TOKEN,
        timeoutMs: env.MCP_VERIFY_DEADLINE_MS
      }),
      mailer: createSmtpMailer({
        smtpUrl: env.SMTP_URL,
        fromEmail: env.AUTH_FROM_EMAIL,
        appBaseUrl: env.APP_BASE_URL
      }),
      historyStore: createPgHistoryStore(),
      idempotencyStore: createPgIdempotencyStore(),
      logger: createLogger(),
      generateRequestId,
      rateLimitStore: createPgRateLimitStore({
        capacity: rateLimitCapacity,
        refillPerSec: rateLimitRefillPerSec
      }),
      serviceUpdateStore: createPgServiceUpdateStore(),
      runtimeConfig: {
        queryRewriteDeadlineMs: env.QUERY_REWRITE_DEADLINE_MS,
        retrievalCandidateCap: env.RETRIEVAL_CANDIDATE_CAP,
        retrievalDeadlineMs: env.RETRIEVAL_DEADLINE_MS,
        engineDeadlineMs: env.ENGINE_DEADLINE_MS,
        mcpVerifyDeadlineMs: env.MCP_VERIFY_DEADLINE_MS,
        deadlineSafetyMarginMs: env.DEADLINE_SAFETY_MARGIN_MS
      },
      now: () => new Date(),
      today: () => new Date().toISOString().slice(0, 10)
    };
  } catch (error) {
    throw new RuntimeConfigurationError(
      error instanceof Error ? error.message : "production_runtime_not_configured"
    );
  }
}

let testingDeps: AssistantDeps | null = null;
let defaultDeps: AssistantDeps | null = null;

export function getAssistantDeps() {
  if (testingDeps) {
    return testingDeps;
  }

  if (process.env.NODE_ENV === "production") {
    if (!defaultDeps) {
      defaultDeps = createProductionDeps();
    }

    return defaultDeps;
  }

  if (!defaultDeps) {
    defaultDeps = createDefaultDeps();
  }

  return defaultDeps;
}

export function setAssistantDepsForTesting(deps: AssistantDeps) {
  testingDeps = deps;
}

export function resetAssistantDepsForTesting() {
  testingDeps = null;
  defaultDeps = null;
}
