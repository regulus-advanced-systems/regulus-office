/**
 * Applying verified GitHub events to the board cache and the event bus (#35).
 * Webhook deliveries arrive here after signature and dedupe checks; polled
 * changes arrive as coarse synthetic events. Each updates `github_issues` /
 * `github_pulls`, asks for the affected operations' board summaries to be
 * republished, then emits a typed event for #155.
 *
 * https://docs.github.com/en/webhooks/webhook-events-and-payloads
 */
import type { BoardCache, FollowedRepo } from "./board-cache.ts";
import {
  asObject,
  normalizeIssue,
  normalizePull,
  payloadTime,
  reviewerState,
  suiteState,
} from "./board-normalize.ts";
import {
  type AnyGitHubEvent,
  accountOf,
  causedByApp,
  type GitHubEventBus,
  type GitHubEventName,
  type GitHubRepoName,
  type OfficeAppIdentity,
  type RawObject,
} from "./events.ts";
import type { PolledChange } from "./poller.ts";
import { DEDUPE_WINDOW_MS } from "./webhook-deliveries.ts";

export interface EventApplyDeps {
  cache: BoardCache;
  bus: GitHubEventBus;
  app(): OfficeAppIdentity | null;
  /** Republish these operations' board summaries. */
  publish(operationIds: string[]): void;
  /** The app was installed, removed, or its repo selection changed. */
  installationChanged(): void;
  now(): number;
}

function repoOf(payload: RawObject): GitHubRepoName | null {
  const repo = asObject(payload.repository);
  const owner = asObject(repo?.owner)?.login;
  if (typeof owner !== "string" || typeof repo?.name !== "string") return null;
  return { owner, name: repo.name, fullName: `${owner}/${repo.name}` };
}

/** Update the cache for one event; true when a board changed. */
function applyToCache(
  cache: BoardCache,
  name: GitHubEventName,
  payload: RawObject,
  followed: FollowedRepo,
): boolean {
  const ids = followed.repoIds;
  const action = typeof payload.action === "string" ? payload.action : "";
  switch (name) {
    case "issues": {
      const number = asObject(payload.issue)?.number;
      if ((action === "deleted" || action === "transferred") && typeof number === "number") {
        cache.deleteIssue(ids, number);
        return true;
      }
      const fields = normalizeIssue(payload.issue);
      return fields ? cache.upsertIssue(ids, fields) !== "none" : false;
    }
    case "pull_request": {
      const fields = normalizePull(payload.pull_request);
      return fields ? cache.upsertPull(ids, fields) !== "none" : false;
    }
    case "pull_request_review": {
      const review = asObject(payload.review);
      const login = asObject(review?.user)?.login;
      const number = asObject(payload.pull_request)?.number;
      const state = action === "dismissed" ? "dismissed" : reviewerState(review?.state);
      if (typeof login !== "string" || typeof number !== "number" || !state) return false;
      return cache.applyReviews(ids, number, { [login.slice(0, 64)]: state });
    }
    case "check_suite":
    case "check_run": {
      const suite =
        name === "check_suite"
          ? asObject(payload.check_suite)
          : asObject(asObject(payload.check_run)?.check_suite);
      if (!suite || typeof suite.id !== "number" || typeof suite.head_sha !== "string")
        return false;
      // A run exists for a check_run event, so its suite is live even without a run count.
      const state = suiteState(
        name === "check_run" ? { latest_check_runs_count: 1, ...suite } : suite,
      );
      return cache.applyChecks(ids, suite.head_sha, { [String(suite.id)]: state });
    }
    default:
      return false;
  }
}

export class EventApplier {
  readonly #deps: EventApplyDeps;

  constructor(deps: EventApplyDeps) {
    this.#deps = deps;
  }

  /** A verified, deduplicated webhook delivery. */
  webhook(name: GitHubEventName, payload: RawObject, deliveryId: string): AnyGitHubEvent {
    const { cache } = this.#deps;
    if (name === "installation" || name === "installation_repositories") {
      this.#deps.installationChanged();
    }
    const repo = repoOf(payload);
    const followed = repo ? cache.follow(repo.owner, repo.name) : null;
    if (followed && applyToCache(cache, name, payload, followed)) {
      this.#deps.publish(followed.operationIds);
    }
    const event = this.#event(name, payload, deliveryId, "webhook", repo, followed);
    this.#deps.bus.emit(event);
    return event;
  }

  /** A change the poller saw (the cache is already updated). */
  polled(change: PolledChange): void {
    // First seen after the first pass: opened, or closed (merged) since the last poll.
    const action =
      change.change === "new"
        ? change.object.state === "open"
          ? "opened"
          : "closed"
        : change.change;
    const repo: GitHubRepoName = {
      owner: change.repo.owner,
      name: change.repo.name,
      fullName: `${change.repo.owner}/${change.repo.name}`,
    };
    const key = change.kind === "issues" ? "issue" : "pull_request";
    const payload: RawObject = {
      action,
      [key]: change.object,
      repository: { name: repo.name, full_name: repo.fullName, owner: { login: repo.owner } },
    };
    const id = `poll:${repo.fullName}:${change.kind}:${String(change.object.number)}:${String(change.object.updated_at)}`;
    this.#deps.bus.emit(
      this.#event(change.kind, payload, id.slice(0, 200), "poll", repo, change.repo),
    );
  }

  #event(
    name: GitHubEventName,
    payload: RawObject,
    deliveryId: string,
    source: "webhook" | "poll",
    repo: GitHubRepoName | null,
    followed: FollowedRepo | null,
  ): AnyGitHubEvent {
    const now = this.#deps.now();
    const at = payloadTime(payload);
    const installation = asObject(payload.installation)?.id;
    return {
      name,
      action: typeof payload.action === "string" ? payload.action : null,
      deliveryId,
      source,
      receivedAt: now,
      repo,
      repoIds: followed?.repoIds ?? [],
      operationIds: followed?.operationIds ?? [],
      installationId: typeof installation === "number" ? installation : null,
      sender: accountOf(payload.sender),
      fromOfficeApp: causedByApp(payload, this.#deps.app()),
      stale: at !== null && at < now - DEDUPE_WINDOW_MS,
      payload,
    } as AnyGitHubEvent;
  }
}
