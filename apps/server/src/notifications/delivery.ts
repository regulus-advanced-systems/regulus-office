/**
 * Webhook delivery queue (#42): one serial queue per channel with a rate
 * limit (spacing plus a per-minute cap, under Slack's 1/s and Telegram's
 * 20/min per group), retries with exponential backoff for network errors,
 * 5xx and 429 (honouring the provider's Retry-After up to a cap), and a
 * bounded queue that drops new messages rather than piling them up.
 *
 * The target (with its decrypted secret) is resolved right before each
 * attempt and dropped afterwards; logs carry channel id, kind and code only.
 */
import type { Logger } from "../logging.ts";
import type { WebhookBody } from "./format.ts";
import { type ChannelTarget, type SenderPolicy, type SendResult, sendWebhook } from "./senders.ts";

export interface DispatcherOptions {
  policy: SenderPolicy;
  logger: Logger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Waits before retry 1, 2, 3, … */
  backoffMs?: readonly number[];
  /** Longest Retry-After honoured; longer ones give up. */
  maxRetryAfterMs?: number;
  perMinute?: number;
  minSpacingMs?: number;
  /** Messages waiting per channel before new ones are dropped. */
  queueLimit?: number;
  /** Every final outcome (for the channel's "last delivery" line). */
  onResult?: (channelId: string, result: SendResult) => void;
}

interface Lane {
  tail: Promise<unknown>;
  pending: number;
  sentAt: number[];
}

export const DEFAULT_BACKOFF_MS = [1_000, 5_000, 25_000] as const;

export class WebhookDispatcher {
  readonly #opts: Required<Omit<DispatcherOptions, "onResult">> &
    Pick<DispatcherOptions, "onResult">;
  readonly #lanes = new Map<string, Lane>();
  #closed = false;

  constructor(opts: DispatcherOptions) {
    this.#opts = {
      now: Date.now,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      backoffMs: DEFAULT_BACKOFF_MS,
      maxRetryAfterMs: 60_000,
      perMinute: 20,
      minSpacingMs: 1_100,
      queueLimit: 30,
      ...opts,
    };
  }

  /**
   * Queue one message. `resolve` returns the channel's current target (null
   * when it was deleted or disabled meanwhile). `retry: false` sends once
   * (the "Send test" button wants a quick answer).
   */
  enqueue(
    channelId: string,
    resolve: () => ChannelTarget | null,
    body: WebhookBody,
    options: { retry?: boolean } = {},
  ): Promise<SendResult> {
    if (this.#closed)
      return Promise.resolve({ ok: false, code: "shutting_down", retryable: false });
    const lane = this.#lane(channelId);
    if (lane.pending >= this.#opts.queueLimit) {
      this.#opts.logger.warn({ channelId }, "notification queue full; message dropped");
      return Promise.resolve({ ok: false, code: "queue_full", retryable: false });
    }
    lane.pending += 1;
    const run = lane.tail.then(() =>
      this.#deliver(channelId, lane, resolve, body, options.retry ?? true),
    );
    lane.tail = run.catch(() => undefined);
    return run.finally(() => {
      lane.pending -= 1;
    });
  }

  /** Wait for everything queued so far (tests, shutdown). */
  async drain(): Promise<void> {
    await Promise.all([...this.#lanes.values()].map((lane) => lane.tail));
  }

  close(): void {
    this.#closed = true;
  }

  #lane(channelId: string): Lane {
    let lane = this.#lanes.get(channelId);
    if (!lane) {
      lane = { tail: Promise.resolve(), pending: 0, sentAt: [] };
      this.#lanes.set(channelId, lane);
    }
    return lane;
  }

  /** Wait until this lane may send again. */
  async #pace(lane: Lane): Promise<void> {
    const { now, sleep, perMinute, minSpacingMs } = this.#opts;
    for (;;) {
      const t = now();
      lane.sentAt = lane.sentAt.filter((at) => t - at < 60_000);
      const last = lane.sentAt.at(-1);
      let wait = last === undefined ? 0 : last + minSpacingMs - t;
      if (lane.sentAt.length >= perMinute) {
        wait = Math.max(wait, (lane.sentAt[0] ?? t) + 60_000 - t);
      }
      if (wait <= 0) return;
      await sleep(wait);
    }
  }

  async #deliver(
    channelId: string,
    lane: Lane,
    resolve: () => ChannelTarget | null,
    body: WebhookBody,
    retry: boolean,
  ): Promise<SendResult> {
    const { backoffMs, maxRetryAfterMs, sleep, logger } = this.#opts;
    let result: SendResult = { ok: false, code: "channel_gone", retryable: false };
    for (let attempt = 0; ; attempt += 1) {
      if (this.#closed) return { ok: false, code: "shutting_down", retryable: false };
      await this.#pace(lane);
      let target: ChannelTarget | null;
      try {
        target = resolve();
      } catch {
        result = { ok: false, code: "undecryptable", retryable: false };
        break;
      }
      if (!target) {
        result = { ok: false, code: "channel_gone", retryable: false };
        break;
      }
      lane.sentAt.push(this.#opts.now());
      result = await sendWebhook(target, body, this.#opts.policy);
      if (result.ok || !result.retryable || !retry || attempt >= backoffMs.length) break;
      const wait = Math.max(backoffMs[attempt] ?? 0, result.retryAfterMs ?? 0);
      if (wait > maxRetryAfterMs) break;
      logger.info({ channelId, code: result.code, attempt: attempt + 1 }, "notification retry");
      await sleep(wait);
    }
    if (!result.ok) {
      logger.warn({ channelId, code: result.code }, "notification delivery failed");
    }
    this.#opts.onResult?.(channelId, result);
    return result;
  }
}
