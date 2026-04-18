type Labels = Record<string, string | number | boolean>;

function serializeLabels(labels: Labels = {}) {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(",");
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

export class Counter {
  private readonly values = new Map<string, number>();

  inc(labels: Labels = {}, amount = 1) {
    const key = serializeLabels(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + amount);
  }

  snapshot() {
    return Object.fromEntries(this.values.entries());
  }

  reset() {
    this.values.clear();
  }
}

export class Gauge {
  private readonly values = new Map<string, number>();

  set(labels: Labels = {}, value: number) {
    this.values.set(serializeLabels(labels), value);
  }

  snapshot() {
    return Object.fromEntries(this.values.entries());
  }

  reset() {
    this.values.clear();
  }
}

export class Histogram {
  private readonly values = new Map<string, number[]>();

  observe(labels: Labels = {}, value: number) {
    const key = serializeLabels(labels);
    const existing = this.values.get(key) ?? [];
    this.values.set(key, [...existing, value]);
  }

  snapshot() {
    return Object.fromEntries(
      [...this.values.entries()].map(([key, values]) => [
        key,
        {
          count: values.length,
          min: values.length ? Math.min(...values) : 0,
          max: values.length ? Math.max(...values) : 0,
          p95: percentile(values, 95),
          sum: values.reduce((total, value) => total + value, 0)
        }
      ])
    );
  }

  reset() {
    this.values.clear();
  }
}

export class MetricsRegistry {
  private readonly counters = new Map<string, Counter>();
  private readonly gauges = new Map<string, Gauge>();
  private readonly histograms = new Map<string, Histogram>();

  counter(name: string) {
    if (!this.counters.has(name)) {
      this.counters.set(name, new Counter());
    }

    return this.counters.get(name)!;
  }

  gauge(name: string) {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, new Gauge());
    }

    return this.gauges.get(name)!;
  }

  histogram(name: string) {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, new Histogram());
    }

    return this.histograms.get(name)!;
  }

  snapshot() {
    return {
      counters: Object.fromEntries([...this.counters.entries()].map(([name, metric]) => [name, metric.snapshot()])),
      gauges: Object.fromEntries([...this.gauges.entries()].map(([name, metric]) => [name, metric.snapshot()])),
      histograms: Object.fromEntries([...this.histograms.entries()].map(([name, metric]) => [name, metric.snapshot()]))
    };
  }

  reset() {
    for (const metric of this.counters.values()) {
      metric.reset();
    }

    for (const metric of this.gauges.values()) {
      metric.reset();
    }

    for (const metric of this.histograms.values()) {
      metric.reset();
    }
  }
}
