import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connect } from "node:net";
import { z } from "zod";
import { AuthHttpError } from "../auth/errors.ts";
import { createLogger } from "../logging.ts";
import {
  JSON_BODY_MAX_BYTES,
  MAX_REQUEST_BODY_BYTES,
  readCappedBytes,
  readCappedForm,
  readJsonBody,
  readJsonValue,
  withCappedBody,
} from "./body.ts";
import { json } from "./router.ts";
import { createOfficeServer, type OfficeServer } from "./server.ts";

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://x/", { method: "POST", body, headers });

/** An endless body of `chunk`-byte pieces; `pulled()` says how many bytes it produced. */
function endless(chunk = 4096) {
  let produced = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      produced += chunk;
      controller.enqueue(new Uint8Array(chunk).fill(0x20));
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, produced: () => produced, cancelled: () => cancelled };
}

/** The status and body of an AuthHttpError thrown by `run`. */
async function failure(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (err) {
    if (!(err instanceof AuthHttpError)) throw err;
    const res = err.toResponse();
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
  throw new Error("expected an AuthHttpError");
}

describe("readCappedBytes", () => {
  test("reads a body within the cap, and an absent body as empty", async () => {
    const res = await readCappedBytes(post("hello"), 5);
    expect(res.ok && new TextDecoder().decode(res.bytes)).toBe("hello");
    const none = await readCappedBytes(new Request("http://x/"), 5);
    expect(none.ok && none.bytes.byteLength).toBe(0);
  });

  test("a chunked body is cancelled once it passes the cap", async () => {
    const body = endless(1024);
    expect(await readCappedBytes(post(body.stream), 10_000)).toEqual({
      ok: false,
      reason: "too_large",
    });
    // Never more than the cap plus the chunk that crossed it (plus one queued ahead).
    expect(body.produced()).toBeLessThanOrEqual(10_000 + 2 * 1024);
    expect(body.cancelled()).toBe(true);
  });

  test("a declared oversize is refused before reading", async () => {
    const body = endless();
    const req = post(body.stream, { "content-length": String(1_000_000) });
    expect(await readCappedBytes(req, 1000)).toEqual({ ok: false, reason: "too_large" });
    expect(req.bodyUsed).toBe(false);
  });
});

describe("readJsonBody", () => {
  const Schema = z.object({ name: z.string() });

  test("parses and validates a body within the cap", async () => {
    expect(await readJsonBody(post(JSON.stringify({ name: "Olga" })), Schema)).toEqual({
      name: "Olga",
    });
  });

  test("an empty body is {} by default, invalid_json when asked", async () => {
    expect(await readJsonValue(post(""))).toEqual({});
    const res = await failure(() => readJsonValue(post(""), { emptyAsObject: false }));
    expect(res).toEqual({ status: 400, body: { error: "invalid_json" } });
  });

  test("bad JSON is 400 invalid_json; a bad shape names fields, not values", async () => {
    expect((await failure(() => readJsonBody(post("{"), Schema))).body.error).toBe("invalid_json");
    const res = await failure(() => readJsonBody(post(JSON.stringify({ name: 7 })), Schema));
    expect(res).toEqual({ status: 400, body: { error: "invalid_body", fields: ["name"] } });
  });

  test("a chunked oversize body is 413 body_too_large without reading past the cap", async () => {
    const body = endless(1024);
    const res = await failure(() => readJsonBody(post(body.stream), Schema));
    expect(res).toEqual({ status: 413, body: { error: "body_too_large" } });
    expect(body.produced()).toBeLessThanOrEqual(JSON_BODY_MAX_BYTES + 2 * 1024);
  });

  test("a per-route cap applies", async () => {
    const big = JSON.stringify({ name: "x".repeat(200) });
    const res = await failure(() => readJsonBody(post(big), Schema, { maxBytes: 100 }));
    expect(res.status).toBe(413);
  });
});

describe("readCappedForm", () => {
  test("reads a form within the cap, null past it", async () => {
    const form = new FormData();
    form.set("title", "Spy Glass");
    form.set("file", new Blob([new Uint8Array(2000)]), "a.mp3");
    const ok = await readCappedForm(post(form), 10_000);
    expect(ok?.get("title")).toBe("Spy Glass");
    expect(await readCappedForm(post(form), 1000)).toBeNull();
  });
});

describe("withCappedBody", () => {
  test("hands on an equal request within the cap, null past it", async () => {
    const copy = await withCappedBody(post('{"a":1}', { "content-type": "application/json" }), 100);
    expect(copy?.method).toBe("POST");
    expect(copy?.headers.get("content-type")).toBe("application/json");
    expect(await copy?.json()).toEqual({ a: 1 });
    expect(await withCappedBody(post(endless().stream), 1000)).toBeNull();
    const get = new Request("http://x/");
    expect(await withCappedBody(get, 10)).toBe(get);
  });
});

describe("over the wire", () => {
  let server: OfficeServer;

  beforeAll(() => {
    server = createOfficeServer({
      config: { port: 0, host: "127.0.0.1", webDist: "/nonexistent" },
      logger: createLogger({ level: "silent" }),
      version: "test",
    });
    server.router.post("/echo", async ({ request }) => {
      try {
        return json(await readJsonValue(request));
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        throw err;
      }
    });
  });

  afterAll(async () => {
    await server.stop(true);
  });

  test("a chunked oversize JSON body is refused with 413 and the upload stops", async () => {
    // A 64 MB body if nobody stopped it; fetch sends a stream chunked, without Content-Length.
    let produced = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced >= 64 * 1024 * 1024) return controller.close();
        produced += 16 * 1024;
        controller.enqueue(new Uint8Array(16 * 1024).fill(0x20));
      },
    });
    const res = await fetch(new URL("/echo", server.url), {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "body_too_large" });
    // Socket buffers let some bytes through beyond the cap, never the whole body.
    expect(produced).toBeLessThan(16 * 1024 * 1024);
  });

  test("a valid body still round-trips", async () => {
    const res = await fetch(new URL("/echo", server.url), {
      method: "POST",
      body: JSON.stringify({ ok: true }),
    });
    expect(await res.json()).toEqual({ ok: true });
  });

  test("Bun refuses a declared length over the office-wide limit before the route", async () => {
    // fetch rewrites Content-Length, so speak HTTP over a plain socket.
    const head = [
      "POST /echo HTTP/1.1",
      `host: ${server.url.host}`,
      "content-type: application/json",
      `content-length: ${MAX_REQUEST_BODY_BYTES + 1}`,
      "",
      "",
    ].join("\r\n");
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = connect(server.port, "127.0.0.1", () => socket.write(`${head}{}`));
      let data = "";
      socket.on("data", (d) => {
        data += d.toString();
        if (data.includes("\r\n")) socket.destroy();
      });
      socket.on("close", () => resolve(data));
      socket.on("error", reject);
    });
    expect(reply).toStartWith("HTTP/1.1 413 ");
  });
});
