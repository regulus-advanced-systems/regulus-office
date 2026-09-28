import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../logging.ts";
import { createOfficeServer, type OfficeServer } from "./server.ts";

const lines: Record<string, unknown>[] = [];
const logger = createLogger({
  level: "debug",
  destination: {
    write(chunk: string) {
      for (const l of chunk.split("\n")) if (l) lines.push(JSON.parse(l));
    },
  },
});

let server: OfficeServer;
let missingDist: string;

beforeAll(async () => {
  missingDist = join(await mkdtemp(join(tmpdir(), "office-nodist-")), "dist");
  server = createOfficeServer({
    config: { port: 0, host: "127.0.0.1", webDist: missingDist },
    logger,
    version: "1.2.3-test",
  });
});

afterAll(async () => {
  await server.stop(true);
  await rm(join(missingDist, ".."), { recursive: true, force: true });
});

const get = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init);

describe("office http server", () => {
  test("listens on an ephemeral port", () => {
    expect(server.port).toBeGreaterThan(0);
    expect(server.url.hostname).toBe("127.0.0.1");
  });

  test("GET /healthz reports ok with version and uptime", async () => {
    const res = await get("/healthz");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: "ok", version: "1.2.3-test", checks: {} });
    expect(typeof body.uptimeSeconds).toBe("number");
  });

  test("/healthz turns 503 when a registered check fails", async () => {
    const off = server.health.register("db", () => false);
    try {
      const res = await get("/healthz");
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ status: "degraded", checks: { db: "fail" } });
    } finally {
      off();
    }
    expect((await get("/healthz")).status).toBe(200);
  });

  test("GET /metrics exposes Prometheus text including request counters", async () => {
    await get("/healthz");
    const res = await get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("# TYPE http_requests_total counter");
    expect(text).toMatch(/http_requests_total\{method="GET",route="\/healthz",status="200"\} \d+/);
    expect(text).toContain("# TYPE http_request_duration_seconds histogram");
    expect(text).toContain(
      'http_request_duration_seconds_bucket{method="GET",route="/healthz",le="+Inf"}',
    );
    expect(text).toContain("http_requests_in_flight 1");
    expect(text).toContain('office_build_info{version="1.2.3-test"} 1');
    expect(text).toContain("process_start_time_seconds");
  });

  test("unknown paths fall through to static and get a JSON 503 without a web build", async () => {
    const res = await get("/");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "web_build_missing" });
    expect((await get("/some/spa/route")).status).toBe(503);
  });

  test("wrong method on a known route is 405", async () => {
    expect((await get("/healthz", { method: "POST" })).status).toBe(405);
  });

  test("handler exceptions become 500 and are logged", async () => {
    server.router.get("/boom", () => {
      throw new Error("kaboom");
    });
    const res = await get("/boom");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(lines.some((l) => l.msg === "unhandled request error" && l.path === "/boom")).toBe(true);
  });

  test("requests are logged; probes at debug, others at info", async () => {
    await get("/healthz");
    await get("/anything");
    const probe = lines.filter((l) => l.msg === "request" && l.path === "/healthz").at(-1);
    const page = lines.filter((l) => l.msg === "request" && l.path === "/anything").at(-1);
    expect(probe?.level).toBe(20);
    expect(page?.level).toBe(30);
    expect(page).toMatchObject({ method: "GET", status: 503 });
  });

  describe("request logs never contain invite tokens or query strings (#90)", () => {
    const TOKEN = "inv_TopS3cretT0ken";
    const lineCount = () => lines.length;
    const newLines = (from: number) => lines.slice(from);

    beforeAll(() => {
      server.router.get("/api/invites/:token", () => new Response("ok"));
      server.router.post("/api/join/:token", () => new Response("ok"));
      server.router.post("/api/explode/join/:token", () => {
        throw new Error("kaboom");
      });
    });

    test.each([
      ["GET", `/join/${TOKEN}`, `/join/[redacted]`],
      ["GET", `/api/invites/${TOKEN}`, "/api/invites/:token"],
      ["POST", `/api/join/${TOKEN}`, "/api/join/:token"],
      ["DELETE", `/api/join/${TOKEN}`, `/api/join/[redacted]`],
    ])("%s %s logs %s", async (method, path, logged) => {
      const from = lineCount();
      await get(path, { method });
      const fresh = newLines(from);
      const entry = fresh.find((l) => l.msg === "request");
      expect(entry).toMatchObject({ method, path: logged });
      expect(JSON.stringify(fresh)).not.toContain(TOKEN);
    });

    test("the unhandled-error log uses the route pattern too", async () => {
      const from = lineCount();
      expect((await get(`/api/explode/join/${TOKEN}`, { method: "POST" })).status).toBe(500);
      const fresh = newLines(from);
      const error = fresh.find((l) => l.msg === "unhandled request error");
      expect(error?.path).toBe("/api/explode/join/:token");
      expect(JSON.stringify(fresh)).not.toContain(TOKEN);
    });

    test("query strings are never logged", async () => {
      const from = lineCount();
      await get("/api/auth/callback/github?code=oauthcode123&state=st4te");
      await get("/healthz?code=oauthcode123");
      const text = JSON.stringify(newLines(from));
      expect(text).not.toContain("oauthcode123");
      expect(text).not.toContain("st4te");
      expect(text).toContain('"path":"/api/auth/callback/github"');
      expect(text).toContain('"path":"/healthz"');
    });
  });
});
