/**
 * Capped request body reading, shared by every route that reads a body
 * (#240, SPEC §11). A declared `Content-Length` over the cap is refused
 * before anything is read; a body without one (chunked) or one that lies
 * about its length is read as a stream and cancelled as soon as it passes
 * the cap, so the office never buffers more than `maxBytes` (+ one chunk).
 *
 * `MAX_REQUEST_BODY_BYTES` is Bun's own `maxRequestBodySize` for the office
 * server (http/server.ts), the outer bound no route can exceed.
 */
import { JUKEBOX_LIMITS } from "@regulus/protocol";
import type { z } from "zod";
import { AuthHttpError } from "../auth/errors.ts";

/** Default cap for a JSON body: every office request form fits in a few KB. */
export const JSON_BODY_MAX_BYTES = 64 * 1024;

/**
 * Largest body Bun accepts at all: the biggest legitimate upload (a jukebox
 * track, 20 MB, #47; wall pictures are 10 MB, #46) plus multipart framing.
 */
export const MAX_REQUEST_BODY_BYTES = JUKEBOX_LIMITS.uploadMaxBytes + 1024 * 1024;

export type CappedBytes =
  | { ok: true; bytes: Uint8Array<ArrayBuffer> }
  | { ok: false; reason: "too_large" };

/** The office's JSON error for an oversized body: 413 `{ error: "body_too_large" }`. */
export const bodyTooLarge = () => new AuthHttpError(413, "body_too_large");

/** True when the request declares a `Content-Length` over `maxBytes`. */
export function declaresTooLarge(request: Request, maxBytes: number): boolean {
  const declared = request.headers.get("content-length");
  if (declared === null) return false;
  const n = Number(declared);
  return Number.isFinite(n) && n > maxBytes;
}

/** The raw body, at most `maxBytes` of it; `too_large` past that (the stream is cancelled). */
export async function readCappedBytes(request: Request, maxBytes: number): Promise<CappedBytes> {
  if (declaresTooLarge(request, maxBytes)) return { ok: false, reason: "too_large" };
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export interface ReadJsonOptions {
  /** Cap in bytes; defaults to {@link JSON_BODY_MAX_BYTES}. */
  maxBytes?: number;
  /** An empty body reads as `{}` (default true); otherwise it is `invalid_json`. */
  emptyAsObject?: boolean;
}

/**
 * The body parsed as JSON, read through the cap. Throws {@link AuthHttpError}:
 * 413 `body_too_large`, 400 `invalid_json`.
 */
export async function readJsonValue(
  request: Request,
  options: ReadJsonOptions = {},
): Promise<unknown> {
  const body = await readCappedBytes(request, options.maxBytes ?? JSON_BODY_MAX_BYTES);
  if (!body.ok) throw bodyTooLarge();
  const text = new TextDecoder().decode(body.bytes);
  if (text.length === 0 && (options.emptyAsObject ?? true)) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AuthHttpError(400, "invalid_json");
  }
}

/**
 * The body read through the cap, parsed as JSON and validated by `schema`.
 * A validation failure is 400 `invalid_body` with field paths only: zod
 * messages could quote the input, and the input may hold a token or key.
 */
export async function readJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  options: ReadJsonOptions = {},
): Promise<z.output<S>> {
  const raw = await readJsonValue(request, options);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "body"))];
    throw new AuthHttpError(400, "invalid_body", { fields });
  }
  return parsed.data;
}

/** The body as multipart form data, read through the cap; null when too large. */
export async function readCappedForm(request: Request, maxBytes: number): Promise<FormData | null> {
  const body = await readCappedBytes(request, maxBytes);
  if (!body.ok) return null;
  const type = request.headers.get("content-type") ?? "";
  return new Response(body.bytes, { headers: { "content-type": type } }).formData();
}

/**
 * A copy of `request` whose body has been read through the cap, for handing
 * to code that reads the body itself (Better Auth). Null when too large.
 * Requests without a body are returned as they are.
 */
export async function withCappedBody(request: Request, maxBytes: number): Promise<Request | null> {
  if (!request.body) return request;
  const body = await readCappedBytes(request, maxBytes);
  if (!body.ok) return null;
  const headers = new Headers(request.headers);
  headers.delete("transfer-encoding");
  headers.set("content-length", String(body.bytes.byteLength));
  return new Request(request.url, {
    method: request.method,
    headers,
    body: body.bytes,
    signal: request.signal,
  });
}
