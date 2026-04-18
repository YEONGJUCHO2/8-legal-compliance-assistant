// @vitest-environment node

import { afterEach, describe, expect, test, vi } from "vitest";

import { POST } from "@/app/api/auth/request/route";
import { resetAssistantDepsForTesting } from "@/lib/assistant/deps";

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
});
