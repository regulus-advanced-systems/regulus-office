/** Size-limited JSON body reading for the hook routes (shared cap: http/body.ts). */
import { readCappedBytes } from "../../http/body.ts";

export type BodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 | 415; error: string };

/**
 * Reads at most `limit` bytes and parses them as JSON. Rejects on a declared
 * `content-length` over the limit before reading, and stops reading as soon
 * as a chunked body passes it.
 */
export async function readJsonBody(request: Request, limit: number): Promise<BodyResult> {
  const type = request.headers.get("content-type") ?? "";
  if (type && !/^application\/json\b/i.test(type)) {
    return { ok: false, status: 415, error: "unsupported_media_type" };
  }
  const body = await readCappedBytes(request, limit);
  if (!body.ok) return { ok: false, status: 413, error: "payload_too_large" };
  if (!request.body) return { ok: false, status: 400, error: "empty_body" };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body.bytes)) };
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}
