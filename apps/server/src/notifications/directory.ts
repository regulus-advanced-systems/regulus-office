/**
 * Database lookups for notifications (#42): per-user preferences, operation
 * names, PR links, who the office managers are, which of a human's henchmen
 * wait for them (tab badge), and one-time marks (a merged PR notifies once).
 */
import {
  DEFAULT_NOTIFICATION_PREFS,
  NotificationPrefs,
  type NotificationPrefs as Prefs,
} from "@regulus/protocol";
import { and, eq, inArray } from "drizzle-orm";
import { getProfileByUserId } from "../auth/roles.ts";
import type { Db } from "../db/index.ts";
import {
  agents,
  notificationMarks,
  notificationPrefs,
  operationRepos,
  operations,
  userProfiles,
} from "../db/schema/index.ts";
import { operationAccessFor } from "../operations/access.ts";
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

  /**
   * May this person see the room right now (D27; #270)? Asked for every
   * recipient of every notification: a notice names the room, the henchman
   * and its task, so it goes to nobody whose own GitHub access does not cover
   * the room's repo, the henchman's owner and office admins included.
   */
  canSee(userId: string, operationId: string): boolean {
    const profile = getProfileByUserId(this.#db, userId);
    if (!profile) return false;
    return operationAccessFor(this.#db, { id: userId, role: profile.role }, operationId) !== null;
  }

  operationName(operationId: string): string {
    const row = this.#db
      .select({ name: operations.name })
      .from(operations)
      .where(eq(operations.id, operationId))
      .get();
    return row?.name ?? "";
  }

  /** `https://github.com/<owner>/<repo>/pull/<n>`, or "" when unknown. */
  prUrl(repoId: string, prNumber: number): string {
    if (!(prNumber > 0)) return "";
    const repo = this.#db
      .select({ owner: operationRepos.owner, name: operationRepos.name })
      .from(operationRepos)
      .where(eq(operationRepos.id, repoId))
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

  /** The human's henchmen waiting for them now (their tab badge), in rooms they can still see. */
  attention(userId: string): string[] {
    const rows = this.#db
      .select({ id: agents.id, operationId: agents.operationId })
      .from(agents)
      .where(and(eq(agents.ownerUserId, userId), inArray(agents.status, [...ATTENTION_STATUSES])))
      .all();
    const seen = new Map<string, boolean>();
    return rows
      .filter((r) => {
        if (!seen.has(r.operationId)) seen.set(r.operationId, this.canSee(userId, r.operationId));
        return seen.get(r.operationId);
      })
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
