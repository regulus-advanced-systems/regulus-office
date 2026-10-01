import { describe, expect, test } from "bun:test";
import { json, Router } from "./router.ts";

const ok = () => new Response("ok");

describe("Router", () => {
  test("matches literal paths per method and treats HEAD as GET", () => {
    const r = new Router().get("/healthz", ok).post("/api/things", ok);
    expect(r.match("GET", "/healthz")?.pattern).toBe("/healthz");
    expect(r.match("HEAD", "/healthz")?.pattern).toBe("/healthz");
    expect(r.match("POST", "/healthz")).toBeUndefined();
    expect(r.match("GET", "/healthz/")?.pattern).toBe("/healthz");
    expect(r.match("GET", "/nope")).toBeUndefined();
    expect(r.hasPath("/healthz")).toBe(true);
    expect(r.hasPath("/nope")).toBe(false);
  });

  test("captures and decodes params", () => {
    const r = new Router().get("/api/operations/:operationId/agents/:agentId", ok);
    const m = r.match("GET", "/api/operations/f%201/agents/a2");
    expect(m?.params).toEqual({ operationId: "f 1", agentId: "a2" });
    expect(r.match("GET", "/api/operations/f1")).toBeUndefined();
  });

  test("a trailing * swallows one or more remaining segments", () => {
    const r = new Router().get("/api/auth/*", ok).get("/api/auth/fixed", ok);
    expect(r.match("GET", "/api/auth/sign-in/email")?.params).toEqual({ "*": "sign-in/email" });
    expect(r.match("GET", "/api/auth/ok")?.pattern).toBe("/api/auth/*");
    expect(r.match("GET", "/api/auth")).toBeUndefined();
    expect(r.match("POST", "/api/auth/x")).toBeUndefined();
    expect(r.hasPath("/api/auth/anything/at/all")).toBe(true);
  });

  test("rejects patterns without a leading slash", () => {
    expect(() => new Router().get("healthz", ok)).toThrow();
  });
});

describe("json", () => {
  test("sets content type and status", async () => {
    const res = json({ a: 1 }, { status: 503 });
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ a: 1 });
  });
});
