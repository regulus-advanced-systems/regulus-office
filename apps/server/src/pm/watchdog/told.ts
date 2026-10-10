/**
 * Who was told of which findings in the office UI (#253).
 *
 * A finding is told to each person who may see it, once, while they are
 * connected: at the end of the part that made it, or, for a person who was
 * away (or when the office itself had just started and nobody was there yet),
 * when their client next asks. So the record is per person: up to which
 * announced finding they were told. `announcedAt` only ever grows
 * (findings.ts), which makes "later than what I was told" exact.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { watchdogTold } from "../../db/schema/index.ts";

/** A person who was never told anything hears of the last week, not of all there ever was. */
export const TOLD_WINDOW_MS = 7 * 24 * 60 * 60_000;

export class ToldStore {
  constructor(private readonly db: Db) {}

  /** The latest `announcedAt` this person was told of; undefined: never told anything. */
  toldAt(userId: string): number | undefined {
    return this.db
      .select()
      .from(watchdogTold)
      .where(eq(watchdogTold.userId, userId))
      .get()
      ?.toldAt.getTime();
  }

  mark(userId: string, at: number): void {
    const toldAt = new Date(at);
    this.db
      .insert(watchdogTold)
      .values({ userId, toldAt })
      .onConflictDoUpdate({ target: watchdogTold.userId, set: { toldAt } })
      .run();
  }
}
