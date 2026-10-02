/**
 * Webhook delivery checks that run before a payload is parsed (#35):
 *
 * - the raw body is read with a hard size cap (a declared `Content-Length`
 *   over the cap is refused without reading; a stream that grows past it is
 *   cancelled), so an unsigned sender cannot make the office buffer or parse
 *   a large body;
 * - `X-Hub-Signature-256` is the HMAC-SHA256 of those exact bytes with the
 *   app's webhook secret, compared in constant time.
 *
 * https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 * https://docs.github.com/en/webhooks/webhook-events-and-payloads#payload-cap (25 MB cap)
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Office cap for one delivery. Board events are a few KB; big pushes stay well under this. */
export const MAX_WEBHOOK_BYTES = 4 * 1024 * 1024;

const SIGNATURE_RE = /^sha256=([0-9a-f]{64})$/;

/** The shared capped reader (http/body.ts), under the name the webhook route uses. */
export { type CappedBytes as CappedBody, readCappedBytes as readCappedBody } from "../http/body.ts";

/** `sha256=<hex>` for `body` under `secret` (what GitHub sends; also used by tests). */
export function signWebhookBody(secret: string, body: Uint8Array | string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * True when `header` is a well-formed `sha256=` signature of `body` under
 * `secret`. The digests are compared with `timingSafeEqual` on equal-length
 * buffers; the header format is checked first so the lengths always match.
 */
export function verifyWebhookSignature(
  secret: string,
  body: Uint8Array,
  header: string | null,
): boolean {
  if (!secret || !header) return false;
  const match = SIGNATURE_RE.exec(header.trim().toLowerCase());
  if (!match?.[1]) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(match[1], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
