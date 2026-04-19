// @vitest-environment node

import { afterEach, describe, expect, test } from "vitest";

import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import {
  resetAssistantDepsForTesting,
  setAssistantDepsForTesting,
  type AssistantDeps
} from "@/lib/assistant/deps";
import { createInMemoryAuthStore } from "@/lib/auth/in-memory-store";
import { hashToken } from "@/lib/auth/tokens";
import { createInMemoryIdempotencyStore } from "@/lib/assistant/idempotency";
import { createInMemoryHistoryStore } from "@/lib/assistant/history-store";
import { createInMemoryEngineSessionStore } from "@/lib/assistant/engine/session-store";
import { createInMemoryRateLimitStore } from "@/lib/rate-limit";
import { createInMemoryStorage } from "@/lib/search/in-memory-storage";
import { retrieve } from "@/lib/search/retrieve";

import { loadFixtureArticles } from "../unit/search/fixture-data";

const staticRouteContext = {
  params: Promise.resolve({})
};

afterEach(() => {
  resetAssistantDepsForTesting();
});

async function createDepsWithSession(sessionToken: string) {
  const authStore = createInMemoryAuthStore();
  const user = await authStore.findOrCreateUserByEmail({
    email: "user@example.com",
    provider: "magic_link",
    providerSubject: "magic:user@example.com",
    now: "2026-04-18T00:00:00.000Z"
  });
  const session = await authStore.createSession({
    userId: user.id,
    tokenHash: hashToken(sessionToken),
    createdAt: "2026-04-18T00:00:00.000Z",
    expiresAt: "2026-04-25T00:00:00.000Z"
  });

  const deps: AssistantDeps = {
    authStore,
    storage: createInMemoryStorage(loadFixtureArticles()),
    retrieveFn: retrieve,
    engine: {
      provider: "anthropic",
      async generate() {
        return {
          sessionId: "noop",
          schemaRetries: 0,
          response: {
            verified_facts: [],
            conclusion: "",
            explanation: "",
            caution: ""
          }
        };
      }
    },
    mcp: {
      async lookupLaw(title) {
        return { lawId: `law:${title}`, title };
      },
      async lookupArticle() {
        return {
          lawId: "law",
          articleNo: "1",
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
          effectiveFrom: "2024-01-01",
          effectiveTo: null,
          repealedAt: null
        };
      }
    },
    historyStore: createInMemoryHistoryStore(),
    idempotencyStore: createInMemoryIdempotencyStore(),
    engineSessionStore: createInMemoryEngineSessionStore(),
    rateLimitStore: createInMemoryRateLimitStore(),
    now: () => new Date("2026-04-19T00:00:00.000Z"),
    today: () => "2026-04-19"
  };

  setAssistantDepsForTesting(deps);
  return { deps, session, user };
}

describe("POST /api/auth/logout", () => {
  test("revokes the current session and returns a cleared cookie", async () => {
    const sessionToken = "logout-session-token";
    const { deps, session } = await createDepsWithSession(sessionToken);
    const request = new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: {
        cookie: `app_session=${sessionToken}`
      }
    });

    const response = await logoutPOST(request, staticRouteContext);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/app_session=/);
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);

    const stored = await deps.authStore.findSessionByHash(hashToken(sessionToken));
    expect(stored?.id).toBe(session.id);
    expect(stored?.revokedAt).toBe("2026-04-19T00:00:00.000Z");
  });

  test("returns 200 and a cleared cookie when no session cookie is present", async () => {
    await createDepsWithSession("unused-token");
    const request = new Request("http://localhost/api/auth/logout", {
      method: "POST"
    });

    const response = await logoutPOST(request, staticRouteContext);

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/app_session=/);
  });

  test("does not revoke a session that belongs to a different token", async () => {
    const sessionToken = "my-session";
    const { deps, session } = await createDepsWithSession(sessionToken);
    const request = new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: {
        cookie: "app_session=someone-else-token"
      }
    });

    const response = await logoutPOST(request, staticRouteContext);
    expect(response.status).toBe(200);

    const stored = await deps.authStore.findSessionByHash(hashToken(sessionToken));
    expect(stored?.id).toBe(session.id);
    expect(stored?.revokedAt ?? null).toBeNull();
  });
});
