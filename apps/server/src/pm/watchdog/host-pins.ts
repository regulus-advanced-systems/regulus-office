/**
 * A watched host's pinned public key in the database (#253): stored on first
 * contact, held to from then on, and replaced only by an admin's explicit
 * "accept new key" of a key the host was actually seen to show (hostkey.ts).
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { watchdogHosts } from "../../db/schema/index.ts";
import { pinOf } from "./hostkey.ts";

export class HostPins {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  #host(id: string) {
    return this.db.select().from(watchdogHosts).where(eq(watchdogHosts.id, id)).get();
  }

  /** First contact: the key the host showed becomes its pin. Never replaces a pin. */
  learn(hostId: string, pin: string): void {
    this.db
      .update(watchdogHosts)
      .set({ hostKey: pinOf(pin), hostKeySource: "learned" })
      .where(and(eq(watchdogHosts.id, hostId), eq(watchdogHosts.hostKey, "")))
      .run();
  }

  /**
   * A pinned host showed another key: kept beside the pin until an admin
   * accepts it. True when this is news (it was not the offered key already).
   */
  offer(hostId: string, offered: string): boolean {
    const row = this.#host(hostId);
    const key = pinOf(offered);
    if (!row || (row.offeredAt !== null && row.offeredHostKey === key)) return false;
    this.db
      .update(watchdogHosts)
      .set({ offeredHostKey: key, offeredAt: new Date(this.now()) })
      .where(eq(watchdogHosts.id, hostId))
      .run();
    return true;
  }

  /** The host shows its pin again: nothing is offered any more. */
  clearOffer(hostId: string): void {
    this.db
      .update(watchdogHosts)
      .set({ offeredHostKey: "", offeredAt: null })
      .where(eq(watchdogHosts.id, hostId))
      .run();
  }

  /**
   * An admin accepts what the host shows now: the offered key becomes the pin.
   * `nothing`: no key is offered. `unread`: the host showed another key but the
   * office could not read which, so there is nothing to accept and the pin stays.
   */
  accept(hostId: string): "accepted" | "nothing" | "unread" {
    const row = this.#host(hostId);
    if (!row || row.offeredAt === null) return "nothing";
    if (row.offeredHostKey === "") return "unread";
    this.db
      .update(watchdogHosts)
      .set({
        hostKey: row.offeredHostKey,
        hostKeySource: "accepted",
        offeredHostKey: "",
        offeredAt: null,
      })
      .where(eq(watchdogHosts.id, hostId))
      .run();
    return "accepted";
  }
}
