// @vitest-environment node

import { afterEach, describe, expect, test, vi } from "vitest";

import { GET } from "@/app/api/metrics/route";
import { getMetricsRegistry } from "@/lib/metrics/assistant-metrics";

const staticRouteContext = {
  params: Promise.resolve({})
};

describe("metrics route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    getMetricsRegistry().reset();
  });

  test("rejects requests without the internal token", async () => {
    vi.stubEnv("METRICS_ACCESS_TOKEN", "metrics-secret");

    const response = await GET(new Request("https://example.test/api/metrics"), staticRouteContext);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.message).toBe("forbidden");
  });

  test("returns the snapshot when the internal token matches", async () => {
    vi.stubEnv("METRICS_ACCESS_TOKEN", "metrics-secret");
    getMetricsRegistry().counter("test_counter").inc({ route: "metrics" });

    const response = await GET(
      new Request("https://example.test/api/metrics", {
        headers: {
          "x-internal-metrics-token": "metrics-secret"
        }
      }),
      staticRouteContext
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.snapshot.counters.test_counter["route=metrics"]).toBe(1);
  });
});
