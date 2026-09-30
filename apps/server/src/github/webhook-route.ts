/**
 * `POST /api/github/webhook` (#35): GitHub → office deliveries.
 *
 * No session; every delivery must be signed. In order, before any JSON is
 * parsed:
 * 1. rate limit (a token bucket for all deliveries, and a smaller one that
 *    only bad or unsigned deliveries drain, so a flood of junk is refused
 *    before any HMAC is computed);
 * 2. `application/json` only, the GitHub headers present and well formed;
 * 3. the body read with a hard cap ({@link MAX_WEBHOOK_BYTES});
 * 4. `X-Hub-Signature-256` checked in constant time against the secret.
 * Then the JSON is parsed, the delivery id claimed (dedupe / replay), the
 * event applied, and GitHub gets a 2xx well inside its 10 s timeout.
 * https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks
 *
 * Nothing from the payload is logged except the event, action, delivery id
 * and repo name.
 */
import type { RouteHandler } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import { isGitHubEventName, type RawObject } from "./events.ts";
import { DELIVERY_ID_RE, type DeliveryLog } from "./webhook-deliveries.ts";
import { MAX_WEBHOOK_BYTES, readCappedBody, verifyWebhookSignature } from "./webhook-signature.ts";

/** Token bucket: `capacity` requests, refilled at `perSecond`. */
export class TokenBucket {
  #tokens: number;
  #at: number;

  constructor(
    readonly capacity: number,
    readonly perSecond: number,
    readonly now: () => number = Date.now,
  ) {
    this.#tokens = capacity;
    this.#at = now();
  }

  take(): boolean {
    const t = this.now();
    this.#tokens = Math.min(this.capacity, this.#tokens + ((t - this.#at) / 1000) * this.perSecond);
    this.#at = t;
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }

  /** True when at least one token is left (without taking it). */
  peek(): boolean {
    const t = this.now();
    return Math.min(this.capacity, this.#tokens + ((t - this.#at) / 1000) * this.perSecond) >= 1;
  }
}

export interface WebhookHandlerDeps {
  /** The app's webhook secret, or null (deliveries are refused). */
  secret(): string | null;
  deliveries: DeliveryLog;
  /** Apply a verified, first-seen delivery; throwing releases the claim. */
  apply(name: string, payload: RawObject, deliveryId: string): void;
  /** Any verified delivery (webhooks are live). */
  verified(): void;
  logger: Logger;
  now?: () => number;
  maxBytes?: number;
}

const EVENT_RE = /^[a-z_]{1,64}$/;

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export function createWebhookHandler(deps: WebhookHandlerDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  const all = new TokenBucket(200, 50, now);
  const bad = new TokenBucket(60, 1, now);
  const maxBytes = deps.maxBytes ?? MAX_WEBHOOK_BYTES;
  const log = deps.logger;

  const rejectBad = (status: number, error: string) => {
    bad.take();
    return reply(status, { error });
  };

  return async ({ request }) => {
    if (!bad.peek() || !all.take()) {
      return new Response(null, { status: 429, headers: { "retry-after": "60" } });
    }
    const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") return rejectBad(415, "json_only");
    const event = request.headers.get("x-github-event") ?? "";
    const deliveryId = request.headers.get("x-github-delivery") ?? "";
    const signature = request.headers.get("x-hub-signature-256");
    if (!signature) return rejectBad(401, "signature_required");
    if (!EVENT_RE.test(event) || !DELIVERY_ID_RE.test(deliveryId)) {
      return rejectBad(400, "bad_headers");
    }
    const secret = deps.secret();
    if (!secret) return rejectBad(503, "webhook_not_configured");
    const body = await readCappedBody(request, maxBytes);
    if (!body.ok) return rejectBad(413, "too_large");
    if (!verifyWebhookSignature(secret, body.bytes, signature)) {
      log.warn({ event, deliveryId }, "github webhook with a bad signature refused");
      return rejectBad(401, "bad_signature");
    }
    deps.verified();
    let payload: RawObject;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(body.bytes)) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      payload = parsed as RawObject;
    } catch {
      return reply(400, { error: "invalid_json" });
    }
    if (event === "ping") return reply(200, { ok: true });
    if (!deps.deliveries.claim(deliveryId, event)) {
      log.info({ event, deliveryId }, "duplicate github delivery ignored");
      return reply(200, { ok: true, duplicate: true });
    }
    if (!isGitHubEventName(event)) return reply(202, { ok: true, ignored: event });
    const repo = (payload.repository as { full_name?: unknown } | undefined)?.full_name;
    try {
      deps.apply(event, payload, deliveryId);
    } catch (err) {
      deps.deliveries.release(deliveryId);
      log.error({ event, deliveryId, err }, "github webhook handling failed");
      return reply(500, { error: "handler_failed" });
    }
    log.info(
      {
        event,
        action: typeof payload.action === "string" ? payload.action : undefined,
        deliveryId,
        repo: typeof repo === "string" ? repo.slice(0, 200) : undefined,
      },
      "github webhook",
    );
    return reply(202, { ok: true });
  };
}
