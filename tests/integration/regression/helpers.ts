import type { AssistantDeps } from "@/lib/assistant/deps";
import { createInMemoryEngineSessionStore } from "@/lib/assistant/engine/session-store";
import type { CitationBlock, EngineAdapter, EngineResponse } from "@/lib/assistant/engine/types";
import { createInMemoryHistoryStore, type HistoryStore } from "@/lib/assistant/history-store";
import { createInMemoryIdempotencyStore } from "@/lib/assistant/idempotency";
import { createInMemoryAuthStore } from "@/lib/auth/in-memory-store";
import type { UserRecord } from "@/lib/auth/types";
import type { MCPEffectiveRange, KoreanLawMcpClient } from "@/lib/open-law/mcp-client";
import { createInMemoryRateLimitStore } from "@/lib/rate-limit";
import { createInMemoryStorage } from "@/lib/search/in-memory-storage";
import { retrieve } from "@/lib/search/retrieve";

import { loadFixtureArticles } from "../../unit/search/fixture-data";

export const REGRESSION_ALLOWED_KINDS = [
  "answer",
  "clarify",
  "no_match",
  "verification_pending",
  "schema_error",
  "rate_limited",
  "auth_expired",
  "error"
] as const;

const DEFAULT_NOW_ISO = "2026-04-18T00:00:00.000Z";
const DEFAULT_TODAY = "2026-04-18";

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createStaticEngineAdapter(
  response: EngineResponse = {
    verified_facts: ["프레스 작업 전 방호장치를 점검해야 합니다."],
    conclusion: "점검 후 작업해야 합니다.",
    explanation: "관련 조문이 안전조치를 요구합니다.",
    caution: "설비별 점검표를 확인하세요."
  },
  schemaRetries = 0
): EngineAdapter {
  return {
    provider: "anthropic",
    async generate() {
      return {
        sessionId: "session-regression",
        schemaRetries,
        response
      };
    }
  };
}

export function createEchoEngineAdapter(seedCitations: Array<{ articleNo: string; body: string }> = []): EngineAdapter {
  return {
    provider: "anthropic",
    async generate(input) {
      const promptCitations =
        input.prompt.citations.length > 0
          ? input.prompt.citations
          : seedCitations.map(
              (citation): CitationBlock => ({
                id: `${citation.articleNo}-seed`,
                lawTitle: "seed-law",
                articleNo: citation.articleNo,
                snapshotHash: `seed:${citation.articleNo}`,
                body: citation.body
              })
            );
      const echoedBodies = promptCitations.map((citation) => citation.body);

      return {
        sessionId: "session-regression-echo",
        schemaRetries: 0,
        response: {
          verified_facts: echoedBodies,
          conclusion: echoedBodies.join(" | "),
          explanation: echoedBodies.join(" | "),
          caution: "quoted citation bodies were echoed for regression testing"
        }
      };
    }
  };
}

export function createDeterministicMcpClient(options?: {
  articleBody?: (articleNo: string) => string;
  lookupArticleDelayMs?: number;
  queryEffectiveDateDelayMs?: number;
  effectiveRange?: (articleNo: string) => MCPEffectiveRange;
}): KoreanLawMcpClient {
  return {
    async lookupLaw(title) {
      return {
        lawId: `law:${title}`,
        title
      };
    },
    async lookupArticle({ lawId, articleNo }) {
      if (options?.lookupArticleDelayMs) {
        await sleep(options.lookupArticleDelayMs);
      }

      return {
        lawId,
        articleNo,
        paragraph: null,
        item: null,
        body: options?.articleBody?.(articleNo) ?? `${articleNo} 본문`,
        snapshotHash: `snap:${articleNo}`,
        latestArticleVersionId: null,
        changeSummary: null
      };
    },
    async queryEffectiveDate({ articleNo }) {
      if (options?.queryEffectiveDateDelayMs) {
        await sleep(options.queryEffectiveDateDelayMs);
      }

      return (
        options?.effectiveRange?.(articleNo) ?? {
          effectiveFrom: "2024-01-01",
          effectiveTo: null,
          repealedAt: null
        }
      );
    }
  };
}

export async function createRegressionDeps(overrides?: Partial<AssistantDeps>): Promise<{
  user: UserRecord;
  deps: AssistantDeps;
  historyStore: HistoryStore;
}> {
  const authStore = createInMemoryAuthStore();
  const user = await authStore.findOrCreateUserByEmail({
    email: "user@example.com",
    provider: "magic_link",
    providerSubject: "magic:user@example.com",
    now: DEFAULT_NOW_ISO
  });
  const historyStore = createInMemoryHistoryStore();

  const deps: AssistantDeps = {
    authStore,
    storage: createInMemoryStorage(loadFixtureArticles()),
    retrieveFn: retrieve,
    engine: createStaticEngineAdapter(),
    mcp: createDeterministicMcpClient(),
    historyStore,
    idempotencyStore: createInMemoryIdempotencyStore(),
    engineSessionStore: createInMemoryEngineSessionStore(),
    rateLimitStore: createInMemoryRateLimitStore(),
    now: () => new Date(DEFAULT_NOW_ISO),
    today: () => DEFAULT_TODAY,
    ...overrides
  };

  return {
    user,
    deps,
    historyStore: deps.historyStore
  };
}
