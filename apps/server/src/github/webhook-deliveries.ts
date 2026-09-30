/**
 * Delivery-id dedupe and replay protection for webhooks (#35).
 *
 * GitHub gives every delivery a GUID in `X-GitHub-Delivery`; a redelivery
 * reuses it. https://docs.github.com/en/webhooks/webhook-events-and-payloads#delivery-headers
 * The office claims the id (an insert that fails when it exists) before
 * handling a verified delivery and releases it when handling fails, so:
 * - a replayed or duplicated delivery is acknowledged and dropped;
 * - a delivery the office failed to handle can be redelivered from GitHub.
 * Ids are kept for {@link DEDUPE_WINDOW_MS} (GitHub only redelivers deliveries
 * from the past 3 days); older events are flagged `stale` on the bus instead.
 */
import { eq, lt } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { githubWebhookDeliveries } from "../db/schema/index.ts";

export const DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60_000;
const PRUNE_EVERY_MS = 60 * 60_000;

/** GitHub sends a UUID; accept a conservative token shape and nothing else. */
export const DELIVERY_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export class DeliveryLog {
  readonly #db: Db;
  readonly #now: () => number;
  #prunedAt = 0;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  /** True when this id was not seen in the window (and is now claimed). */
  claim(id: string, event: string): boolean {
    this.#maybePrune();
    const now = new Date(this.#now());
    const inserted = this.#db
      .insert(githubWebhookDeliveries)
      .values({ id, event: event.slice(0, 64), createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning({ id: githubWebhookDeliveries.id })
      .all();
    return inserted.length > 0;
  }

  /** Forget a claim whose handling failed, so GitHub's redelivery is accepted. */
  release(id: string): void {
    this.#db.delete(githubWebhookDeliveries).where(eq(githubWebhookDeliveries.id, id)).run();
  }

  prune(): void {
    this.#prunedAt = this.#now();
    this.#db
      .delete(githubWebhookDeliveries)
      .where(lt(githubWebhookDeliveries.createdAt, new Date(this.#now() - DEDUPE_WINDOW_MS)))
      .run();
  }

  #maybePrune(): void {
    if (this.#now() - this.#prunedAt >= PRUNE_EVERY_MS) this.prune();
  }
}
