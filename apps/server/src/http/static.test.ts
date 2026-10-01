import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStaticHandler, resolveWithin } from "./static.ts";

let dist: string;
beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), "office-dist-"));
  await Bun.write(join(dist, "index.html"), "<!doctype html><title>office</title>");
  await Bun.write(join(dist, "assets", "app-abc123.js"), "console.log(1)");
});
afterAll(() => rm(dist, { recursive: true, force: true }));

const call = (
  handler: ReturnType<typeof createStaticHandler>,
  path: string,
  init?: RequestInit,
) => {
  const req = new Request(`http://x${path}`, init);
  return handler(req, new URL(req.url));
};

describe("resolveWithin", () => {
  test("keeps paths inside the root and rejects escapes", () => {
    expect(resolveWithin("/srv/dist", "/a/b.js")).toBe("/srv/dist/a/b.js");
    expect(resolveWithin("/srv/dist", "/")).toBe("/srv/dist");
    expect(resolveWithin("/srv/dist", "/../etc/passwd")).toBeUndefined();
    expect(resolveWithin("/srv/dist", "/a/%2e%2e/%2e%2e/etc/passwd")).toBeUndefined();
    expect(resolveWithin("/srv/dist", "/%zz")).toBeUndefined();
    expect(resolveWithin("/srv/dist", "/a%00.js")).toBeUndefined();
  });
});

describe("createStaticHandler", () => {
  test("serves files, hashed assets immutable, index no-cache", async () => {
    const h = createStaticHandler({ distDir: dist });
    const asset = await call(h, "/assets/app-abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(asset.headers.get("content-type")).toContain("javascript");
    expect(await asset.text()).toBe("console.log(1)");

    const index = await call(h, "/");
    expect(index.status).toBe(200);
    expect(index.headers.get("cache-control")).toBe("no-cache");
    expect(await index.text()).toContain("office");
  });

  test("falls back to index.html for SPA routes but 404s missing assets", async () => {
    const h = createStaticHandler({ distDir: dist });
    const spa = await call(h, "/operations/3", { headers: { accept: "text/html" } });
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain("office");
    expect((await call(h, "/assets/missing.js")).status).toBe(404);
    expect((await call(h, "/api/x", { headers: { accept: "application/json" } })).status).toBe(404);
    // "/../x" is normalised away by the URL parser; an encoded slash survives it and must still 404.
    expect((await call(h, "/assets/..%2f..%2fetc%2fpasswd")).status).toBe(404);
  });

  test("HEAD returns headers only; other methods get 405", async () => {
    const h = createStaticHandler({ distDir: dist });
    const head = await call(h, "/assets/app-abc123.js", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("14");
    expect(await head.text()).toBe("");
    expect((await call(h, "/", { method: "POST" })).status).toBe(405);
  });

  test("returns a JSON 503 when the web build is missing", async () => {
    const h = createStaticHandler({ distDir: join(dist, "nope") });
    const res = await call(h, "/");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("web_build_missing");
    expect(body.message).toContain("@regulus/web build");
  });
});
