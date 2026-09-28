import { describe, expect, test } from "bun:test";
import { Counter, Histogram, MetricsRegistry } from "./metrics.ts";

describe("MetricsRegistry", () => {
  test("renders counters, gauges and histograms in exposition format", () => {
    const reg = new MetricsRegistry();
    const c = reg.counter("http_requests_total", "reqs");
    c.inc({ method: "GET", route: "/healthz", status: "200" });
    c.inc({ status: "200", route: "/healthz", method: "GET" }, 2);
    reg.gauge("up", "is up").set(1);
    const h = reg.histogram("dur", "latency", [0.1, 1]);
    h.observe(0.05, { route: "x" });
    h.observe(5, { route: "x" });

    const text = reg.expose();
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain("# HELP http_requests_total reqs\n# TYPE http_requests_total counter\n");
    expect(text).toContain('http_requests_total{method="GET",route="/healthz",status="200"} 3');
    expect(text).toContain("# TYPE up gauge\nup 1");
    expect(text).toContain('dur_bucket{route="x",le="0.1"} 1');
    expect(text).toContain('dur_bucket{route="x",le="1"} 1');
    expect(text).toContain('dur_bucket{route="x",le="+Inf"} 2');
    expect(text).toContain('dur_sum{route="x"} 5.05');
    expect(text).toContain('dur_count{route="x"} 2');
  });

  test("escapes label values", () => {
    const c = new Counter("c", "h");
    c.inc({ p: 'a"b\\c\nd' });
    expect(c.render()[0]).toBe('c{p="a\\"b\\\\c\\nd"} 1');
  });

  test("rejects duplicate or invalid names and negative counter increments", () => {
    const reg = new MetricsRegistry();
    reg.counter("a", "h");
    expect(() => reg.gauge("a", "h")).toThrow(/already registered/);
    expect(() => reg.counter("1bad", "h")).toThrow(/invalid metric name/);
    expect(() => new Counter("c", "h").inc({}, -1)).toThrow();
  });

  test("histogram sorts buckets", () => {
    expect(new Histogram("h", "h", [5, 1, 2]).buckets).toEqual([1, 2, 5]);
  });
});
