/**
 * Hand-rolled Prometheus metrics (docs/SPEC.md §11): counters, gauges and
 * histograms rendered in the text exposition format. Small on purpose;
 * subsystems import the shared {@link MetricsRegistry} and register there.
 */

export type Labels = Record<string, string>;

const escapeLabel = (v: string) =>
  v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');

const labelKey = (labels: Labels): string =>
  Object.keys(labels)
    .sort()
    .map((k) => `${k}="${escapeLabel(labels[k] as string)}"`)
    .join(",");

const fmt = (n: number): string => (Number.isFinite(n) ? String(n) : n > 0 ? "+Inf" : "-Inf");

abstract class Metric {
  constructor(
    readonly name: string,
    readonly help: string,
    readonly type: "counter" | "gauge" | "histogram",
  ) {
    if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) throw new Error(`invalid metric name: ${name}`);
  }
  abstract render(): string[];
  header(): string[] {
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} ${this.type}`];
  }
}

export class Counter extends Metric {
  readonly #values = new Map<string, number>();
  constructor(name: string, help: string) {
    super(name, help, "counter");
  }
  inc(labels: Labels = {}, by = 1): void {
    if (by < 0) throw new Error("counter cannot decrease");
    const k = labelKey(labels);
    this.#values.set(k, (this.#values.get(k) ?? 0) + by);
  }
  get(labels: Labels = {}): number {
    return this.#values.get(labelKey(labels)) ?? 0;
  }
  render(): string[] {
    return [...this.#values].map(([k, v]) => `${this.name}${k ? `{${k}}` : ""} ${fmt(v)}`);
  }
}

export class Gauge extends Metric {
  readonly #values = new Map<string, number>();
  constructor(name: string, help: string) {
    super(name, help, "gauge");
  }
  set(value: number, labels: Labels = {}): void {
    this.#values.set(labelKey(labels), value);
  }
  inc(labels: Labels = {}, by = 1): void {
    this.set(this.get(labels) + by, labels);
  }
  dec(labels: Labels = {}, by = 1): void {
    this.set(this.get(labels) - by, labels);
  }
  get(labels: Labels = {}): number {
    return this.#values.get(labelKey(labels)) ?? 0;
  }
  render(): string[] {
    return [...this.#values].map(([k, v]) => `${this.name}${k ? `{${k}}` : ""} ${fmt(v)}`);
  }
}

interface HistogramSeries {
  labels: Labels;
  counts: number[];
  sum: number;
  count: number;
}

export const DEFAULT_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export class Histogram extends Metric {
  readonly #series = new Map<string, HistogramSeries>();
  readonly buckets: readonly number[];
  constructor(name: string, help: string, buckets: readonly number[] = DEFAULT_DURATION_BUCKETS) {
    super(name, help, "histogram");
    this.buckets = [...buckets].sort((a, b) => a - b);
  }
  observe(value: number, labels: Labels = {}): void {
    const k = labelKey(labels);
    let s = this.#series.get(k);
    if (!s) {
      s = { labels, counts: this.buckets.map(() => 0), sum: 0, count: 0 };
      this.#series.set(k, s);
    }
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= (this.buckets[i] as number)) s.counts[i] = (s.counts[i] as number) + 1;
    }
    s.sum += value;
    s.count += 1;
  }
  render(): string[] {
    const out: string[] = [];
    for (const s of this.#series.values()) {
      const base = labelKey(s.labels);
      const withLe = (le: string) => `{${base ? `${base},` : ""}le="${le}"}`;
      this.buckets.forEach((b, i) =>
        out.push(`${this.name}_bucket${withLe(fmt(b))} ${s.counts[i]}`),
      );
      out.push(`${this.name}_bucket${withLe("+Inf")} ${s.count}`);
      const suffix = base ? `{${base}}` : "";
      out.push(`${this.name}_sum${suffix} ${fmt(s.sum)}`, `${this.name}_count${suffix} ${s.count}`);
    }
    return out;
  }
}

export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

export class MetricsRegistry {
  readonly #metrics = new Map<string, Metric>();

  #register<M extends Metric>(metric: M): M {
    if (this.#metrics.has(metric.name))
      throw new Error(`metric already registered: ${metric.name}`);
    this.#metrics.set(metric.name, metric);
    return metric;
  }
  counter(name: string, help: string): Counter {
    return this.#register(new Counter(name, help));
  }
  gauge(name: string, help: string): Gauge {
    return this.#register(new Gauge(name, help));
  }
  histogram(name: string, help: string, buckets?: readonly number[]): Histogram {
    return this.#register(new Histogram(name, help, buckets));
  }
  /** Prometheus text exposition, one block per metric, trailing newline. */
  expose(): string {
    const lines: string[] = [];
    for (const m of this.#metrics.values()) lines.push(...m.header(), ...m.render());
    return `${lines.join("\n")}\n`;
  }
}
