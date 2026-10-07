/**
 * Keeping access snapshots current (SPEC D27; #267): a timer, the GitHub
 * webhooks that say someone's access may have changed, and requests from the
 * rest of the office (sign-in). Requests are coalesced per person and run in
 * the background, one person at a time, so a burst of webhooks asks GitHub
 * once.
 *
 * Which webhook refreshes whom:
 * - `member` (collaborator added, removed, edited): that person, that repo.
 * - `membership` (team member added, removed): that person, every repo.
 * - `organization` member_added / member_removed: that person, every repo;
 *   any other action (renamed, deleted): everyone.
 * - `team` (created, deleted, edited, repo added or removed): everyone, for
 *   the repo named when there is one, else every repo.
 * - `repository` (privatized, publicized, transferred, deleted, ...):
 *   everyone, for that repo, when the office follows it.
 */
import type { Logger } from "../../logging.ts";
import {
  ACCESS_EVENT_NAMES,
  type AnyGitHubEvent,
  type GitHubEventBus,
  type RawObject,
} from "../events.ts";
import type { GitHubAccessService } from "./service.ts";

export const DEFAULT_REFRESH_INTERVAL_MS = 15 * 60_000;
const DEBOUNCE_MS = 500;

/** Repo ids to check, or `all`. */
type Scope = Set<string> | "all";

export interface AccessRefresherDeps {
  service: Pick<
    GitHubAccessService,
    "refreshUser" | "refreshAll" | "linkedUserIds" | "userIdForGitHubUser"
  >;
  logger: Logger;
  intervalMs?: number;
  debounceMs?: number;
}

const githubId = (v: unknown): number | null => {
  const id = v && typeof v === "object" ? (v as RawObject).id : null;
  return typeof id === "number" ? id : null;
};

export class AccessRefresher {
  readonly #d: AccessRefresherDeps;
  readonly #pending = new Map<string, Scope>();
  #debounce: ReturnType<typeof setTimeout> | null = null;
  #interval: ReturnType<typeof setInterval> | null = null;
  #draining: Promise<void> | null = null;
  #stopped = false;

  constructor(deps: AccessRefresherDeps) {
    this.#d = deps;
  }

  /** Start the timer: everyone who is linked is checked again every interval. */
  start(): void {
    this.#stopped = false;
    if (this.#interval) return;
    this.#interval = setInterval(() => {
      this.#d.service
        .refreshAll()
        .catch((err) => this.#d.logger.error({ err }, "the github access refresh pass failed"));
    }, this.#d.intervalMs ?? DEFAULT_REFRESH_INTERVAL_MS);
    this.#interval.unref?.();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#interval) clearInterval(this.#interval);
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#interval = null;
    this.#debounce = null;
    this.#pending.clear();
  }

  /** Refresh one person soon (sign-in, a webhook about them). */
  request(userId: string, repoIds?: readonly string[]): void {
    if (this.#stopped) return;
    const had = this.#pending.get(userId);
    if (had === "all" || !repoIds) this.#pending.set(userId, "all");
    else this.#pending.set(userId, new Set([...(had ?? []), ...repoIds]));
    this.#debounce ??= setTimeout(() => {
      this.#debounce = null;
      void this.flush();
    }, this.#d.debounceMs ?? DEBOUNCE_MS);
    this.#debounce.unref?.();
  }

  /** Refresh everyone who is linked soon. */
  requestAll(repoIds?: readonly string[]): void {
    for (const userId of this.#d.service.linkedUserIds()) this.request(userId, repoIds);
  }

  /** Run what is pending now and wait for it (the debounce calls this; so do tests). */
  flush(): Promise<void> {
    this.#draining = (this.#draining ?? Promise.resolve()).then(async () => {
      while (this.#pending.size > 0) {
        const [userId, scope] = this.#pending.entries().next().value as [string, Scope];
        this.#pending.delete(userId);
        try {
          await this.#d.service.refreshUser(userId, scope === "all" ? {} : { repoIds: [...scope] });
        } catch (err) {
          this.#d.logger.error({ userId, err }, "refreshing github access failed");
        }
      }
    });
    return this.#draining;
  }

  /** Subscribe to the access webhooks on the GitHub event bus; returns the unsubscribe function. */
  follow(bus: Pick<GitHubEventBus, "on">): () => void {
    const offs = ACCESS_EVENT_NAMES.map((name) => bus.on(name, (event) => this.onEvent(event)));
    return () => {
      for (const off of offs) off();
    };
  }

  onEvent(event: AnyGitHubEvent): void {
    if (event.source !== "webhook") return;
    const repoIds = event.repoIds.length > 0 ? event.repoIds : undefined;
    const person = (account: unknown) => {
      const id = githubId(account);
      const userId = id === null ? null : this.#d.service.userIdForGitHubUser(id);
      return userId;
    };
    switch (event.name) {
      case "member": {
        const userId = person(event.payload.member);
        // A repo the office does not follow is in nobody's snapshot.
        if (userId && repoIds) this.request(userId, repoIds);
        return;
      }
      case "membership": {
        const userId = person(event.payload.member);
        if (userId) this.request(userId);
        return;
      }
      case "organization": {
        if (event.action === "member_invited") return;
        if (event.action === "member_added" || event.action === "member_removed") {
          const membership = event.payload.membership as RawObject | undefined;
          const userId = person(membership?.user);
          if (userId) this.request(userId);
          return;
        }
        this.requestAll();
        return;
      }
      case "team":
        this.requestAll(repoIds);
        return;
      case "repository":
        if (repoIds) this.requestAll(repoIds);
        return;
      default:
        return;
    }
  }
}
