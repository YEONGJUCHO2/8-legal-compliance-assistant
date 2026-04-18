// @vitest-environment node

import { afterEach, describe, expect, test, vi } from "vitest";

import { POST } from "@/app/api/auth/request/route";
import { getAssistantDeps, resetAssistantDepsForTesting, setAssistantDepsForTesting } from "@/lib/assistant/deps";
import { createInMemoryAuthStore } from "@/lib/auth/in-memory-store";

const staticRouteContext = {
  params: Promise.resolve({})
};

afterEach(() => {
  resetAssistantDepsForTesting();
  vi.restoreAllMocks();
});

describe("/api/auth/request route", () => {
  test("returns 400 with invalid_email on invalid payload", async () => {
    const response = await POST(
      new Request("https://example.test/api/auth/request", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      }),
      staticRouteContext
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      kind: "error",
      message: "invalid_email"
    });
  });

  test("accepts a valid email payload", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});

    const response = await POST(
      new Request("https://example.test/api/auth/request", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email: "user@example.com"
        })
      }),
      staticRouteContext
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.expiresAt).toEqual(expect.any(String));
  });

  test("uses the injected deps mailer for auth request delivery", async () => {
    const send = vi.fn(async () => {});
    const deps = getAssistantDeps();

    setAssistantDepsForTesting({
      ...deps,
      authStore: createInMemoryAuthStore(),
      mailer: {
        send
      }
    });

    const response = await POST(
      new Request("https://example.test/api/auth/request", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email: "user@example.com"
        })
      }),
      staticRouteContext
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        expiresAt: expect.any(String),
        magicUrl: expect.stringContaining("/login?token=")
      })
    );
  });
});
