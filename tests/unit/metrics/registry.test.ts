import { describe, expect, test } from "vitest";

import { MetricsRegistry } from "@/lib/metrics/registry";

describe("metrics registry", () => {
  test("tracks counters, gauges, and histograms in a serializable snapshot", () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter("clarify_rate");
    const gauge = registry.gauge("verification_concurrency_saturation");
    const histogram = registry.histogram("engine_latency_ms");

    counter.inc({ route: "ask" }, 2);
    gauge.set({ route: "ask" }, 4);
    histogram.observe({ route: "ask" }, 120);
    histogram.observe({ route: "ask" }, 240);

    const snapshot = registry.snapshot();

    expect(snapshot.counters.clarify_rate["route=ask"]).toBe(2);
    expect(snapshot.gauges.verification_concurrency_saturation["route=ask"]).toBe(4);
    expect(snapshot.histograms.engine_latency_ms["route=ask"].count).toBe(2);
    expect(snapshot.histograms.engine_latency_ms["route=ask"].p95).toBe(240);
  });
});
