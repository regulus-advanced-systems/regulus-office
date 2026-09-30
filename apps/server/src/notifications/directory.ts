/**
 * Database lookups for notifications (#42): per-user preferences, floor
 * names, PR links, who the office managers are, which of a human's robots
 * wait for them (tab badge), and one-time marks (a merged PR notifies once).
 */
import {
  DEFAULT_NOTIFICATION_PREFS,
  NotificationPrefs,
  type NotificationPrefs as Prefs,
} from "@regulus/protocol";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import {
  agents,
  floorRepos,
  floors,
  notificationMarks,
  notificationPrefs,
  userProfiles,
} from "../db/schema/index.ts";
import { ATTENTION_STATUSES } from "./events.ts";

export class NotificationDirectory {
  readonly #db: Db;
  readonly #githubWebBase: string;
  readonly #prefs = new Map<string, Prefs>();

  constructor(db: Db, githubWebBase = "https://github.com") {
    this.#db = db;
    this.#githubWebBase = githubWebBase.replace(/\/+$/, "");
  }

  prefs(userId: string): Prefs {
    const cached = this.#prefs.get(userId);
    if (cached) return cached;
    const row = this.#db
      .select({ json: notificationPrefs.prefsJson })
      .from(notificationPrefs)
      .where(eq(notificationPrefs.userId, userId))
      .get();
    let prefs = DEFAULT_NOTIFICATION_PREFS;
    if (row) {
      try {
        const parsed = NotificationPrefs.safeParse(JSON.parse(row.json));
        if (parsed.success) prefs = parsed.data;
      } catch {
        // Unreadable row: defaults.
      }
    }
    this.#prefs.set(userId, prefs);
    return prefs;
  }

  setPrefs(userId: string, prefs: Prefs): void {
    const prefsJson = JSON.stringify(prefs);
    this.#db
      .insert(notificationPrefs)
      .values({ userId, prefsJson })
      .onConflictDoUpdate({ target: notificationPrefs.userId, set: { prefsJson } })
      .run();
    this.#prefs.set(userId, prefs);
  }

  floorName(floorId: string): string {
    const row = this.#db
      .select({ name: floors.name })
      .from(floors)
      .where(eq(floors.id, floorId))
      .get();
    return row?.name ?? "";
  }

  /** `https://github.com/<owner>/<repo>/pull/<n>`, or "" when unknown. */
  prUrl(repoId: string, prNumber: number): string {
    if (!(prNumber > 0)) return "";
    const repo = this.#db
      .select({ owner: floorRepos.owner, name: floorRepos.name })
      .from(floorRepos)
      .where(eq(floorRepos.id, repoId))
      .get();
    if (!repo) return "";
    return `${this.#githubWebBase}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/pull/${prNumber}`;
  }

  /** Office owners and admins. */
  managers(): string[] {
    return this.#db
      .select({ userId: userProfiles.userId })
      .from(userProfiles)
      .where(inArray(userProfiles.role, ["owner", "admin"]))
      .all()
      .map((r) => r.userId);
  }

  /** The human's robots waiting for them now (their tab badge). */
  attention(userId: string): string[] {
    return this.#db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.ownerUserId, userId), inArray(agents.status, [...ATTENTION_STATUSES])))
      .all()
      .map((r) => r.id);
  }

  hasMark(key: string): boolean {
    return (
      this.#db
        .select({ key: notificationMarks.key })
        .from(notificationMarks)
        .where(eq(notificationMarks.key, key))
        .get() !== undefined
    );
  }

  /** Set a mark; false when it was already set. */
  mark(key: string): boolean {
    const inserted = this.#db
      .insert(notificationMarks)
      .values({ key })
      .onConflictDoNothing()
      .returning({ key: notificationMarks.key })
      .all();
    return inserted.length > 0;
  }
}
