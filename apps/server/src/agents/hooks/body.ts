/** Size-limited JSON body reading for the hook routes. */

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
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) {
    return { ok: false, status: 413, error: "payload_too_large" };
  }
  if (!request.body) return { ok: false, status: 400, error: "empty_body" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return { ok: false, status: 413, error: "payload_too_large" };
    }
    chunks.push(value);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}
