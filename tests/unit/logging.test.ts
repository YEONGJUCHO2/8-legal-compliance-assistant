import { describe, expect, test } from "vitest";

import { createLogger, logAssistantRunEvent, withRequestContext } from "@/lib/logging";

describe("logging", () => {
  test("redacts sensitive fields and carries child context", () => {
    const logger = createLogger({ service: "test-service" });
    const child = withRequestContext(logger, {
      requestId: "reqid_123",
      userId: "user-1",
      runId: "run-1"
    });

    child.info({
      password: "secret",
      nested: {
        token: "secret-token",
        apiKey: "secret-key"
      }
    });
    logAssistantRunEvent(child, {
      request_id: "reqid_123",
      user_id: "user-1",
      run_id: "run-1",
      strength: "clear",
      engine_provider: "anthropic",
      created_at: "2026-04-18T00:00:00.000Z"
    });

    const entries = logger.drain();
    const first = entries[0] as {
      service: string;
      requestId: string;
      runId: string;
      password: string;
      nested: {
        token: string;
        apiKey: string;
      };
    };
    const second = entries[1] as {
      eventType: string;
    };
    expect(entries).toHaveLength(2);
    expect(first.service).toBe("test-service");
    expect(first.requestId).toBe("reqid_123");
    expect(first.runId).toBe("run-1");
    expect(first.password).toBe("[Redacted]");
    expect(first.nested.token).toBe("[Redacted]");
    expect(first.nested.apiKey).toBe("[Redacted]");
    expect(second.eventType).toBe("assistant_run");
  });
});
