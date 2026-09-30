/**
 * Board polling (SPEC §4.2 "polling mode when no inbound URL", D14; #35).
 *
 * For every GitHub repo a live floor follows, one request at a time:
 * 1. first pass: open issues and open PRs (up to 3 pages each), then the
 *    recent page of step 2, all without events;
 * 2. then: the 50 most recently updated issues and PRs (`state=all`, so closes
 *    and merges show), as conditional requests with the last ETag;
 * 3. reviews of PRs that changed, and check suites of open PRs' heads, also
 *    conditional.
 * Unchanged answers are 304s, which do not count against the rate limit.
 * The token is the floor repo's (the office connection's installation token
 * or PAT, else the repo's own PAT, via RepoAccess); repos without one are
 * not polled, so public repos never cost unauthenticated quota.
 *
 * Every change seen after the first pass also goes on the event bus
 * (`source: "poll"`), so #155 workflows get a fallback trigger.
 */
import type { Logger } from "../logging.ts";
import type { BoardCache, CardChange, FollowedRepo } from "./board-cache.ts";
import {
  normalizeIssue,
  normalizePull,
  reviewsFromList,
  type SuiteState,
  suiteState,
} from "./board-normalize.ts";
import type { RawObject } from "./events.ts";
import { type Conditional, type PollClient, RateLimitedError } from "./poll-client.ts";
import { GitHubApiError } from "./pulls.ts";

const BOOTSTRAP_PAGES = 3;
const STEADY_PAGE = 50;
const MAX_REVIEW_FETCHES = 20;
const MAX_CHECK_FETCHES = 30;
const CHECKS_FORBIDDEN_PAUSE_MS = 60 * 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const MAX_ETAGS = 500;

export interface PolledChange {
  kind: "issues" | "pull_request";
  change: Exclude<CardChange, "none">;
  repo: FollowedRepo;
  object: RawObject;
}

export interface PollerDeps {
  cache: BoardCache;
  client: PollClient;
  /**
   * Run `fn` with the floor repo row's token (null: not polled). The token is
   * only used inside the callback (RepoAccess.withRepoCredential).
   */
  withToken<T>(repoId: string, fn: (token: string | null) => Promise<T>): Promise<T>;
  /** Floors whose board changed. */
  onBoardChanged(floorIds: string[]): void;
  /** A change after the first pass (for the event bus). */
  onChange(change: PolledChange): void;
  logger: Logger;
  now?: () => number;
}

interface RepoState {
  etags: Map<string, string>;
  bootstrapped: boolean;
  checksPausedUntil: number;
  failures: number;
  nextAt: number;
}

const enc = encodeURIComponent;

export class BoardPoller {
  readonly #deps: PollerDeps;
  readonly #now: () => number;
  readonly #repos = new Map<string, RepoState>();
  #lastPollAt: number | null = null;

  constructor(deps: PollerDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
  }

  get lastPollAt(): number | null {
    return this.#lastPollAt;
  }

  /** Forget ETags and redo the first pass everywhere (installation changed). */
  resync(): void {
    this.#repos.clear();
  }

  /**
   * Poll every followed repo that is due. Returns when done, or early (with
   * the time polling may resume) when GitHub's rate limit is hit.
   */
  async pollOnce(intervalMs: number): Promise<{ pausedUntil: number | null }> {
    const followed = this.#deps.cache.followedRepos();
    const keys = new Set(followed.map((r) => `${r.owner}/${r.name}`.toLowerCase()));
    for (const key of [...this.#repos.keys()]) if (!keys.has(key)) this.#repos.delete(key);
    for (const repo of followed) {
      const key = `${repo.owner}/${repo.name}`.toLowerCase();
      const state = this.#repos.get(key) ?? {
        etags: new Map(),
        bootstrapped: false,
        checksPausedUntil: 0,
        failures: 0,
        nextAt: 0,
      };
      this.#repos.set(key, state);
      if (state.nextAt > this.#now()) continue;
      try {
        const primary = repo.repoIds[0] as string;
        const touched = await this.#deps.withToken(primary, (token) =>
          token ? this.#pollRepo(repo, state, token) : Promise.resolve(false),
        );
        state.failures = 0;
        state.nextAt = this.#now() + intervalMs;
        if (touched) this.#deps.onBoardChanged(repo.floorIds);
      } catch (err) {
        if (err instanceof RateLimitedError) {
          this.#deps.logger.warn({ until: err.until }, "github rate limit reached; polling paused");
          return { pausedUntil: err.until };
        }
        state.failures += 1;
        state.nextAt = this.#now() + Math.min(intervalMs * 2 ** state.failures, MAX_BACKOFF_MS);
        if (state.failures === 1 || state.failures % 10 === 0) {
          const detail =
            err instanceof GitHubApiError ? `${err.status} ${err.detail}` : String(err);
          this.#deps.logger.warn(
            {
              repo: `${repo.owner}/${repo.name}`,
              failures: state.failures,
              detail: detail.slice(0, 300),
            },
            "github board poll failed",
          );
        }
      }
    }
    this.#lastPollAt = this.#now();
    return { pausedUntil: null };
  }

  async #get<T>(state: RepoState, path: string, token: string, conditional: boolean) {
    const res = await this.#deps.client.get<T>(
      path,
      token,
      conditional ? state.etags.get(path) : null,
    );
    if (conditional && res.etag) {
      if (state.etags.size > MAX_ETAGS) state.etags.clear();
      state.etags.set(path, res.etag);
    }
    return res;
  }

  async #pollRepo(repo: FollowedRepo, state: RepoState, token: string): Promise<boolean> {
    const base = `/repos/${enc(repo.owner)}/${enc(repo.name)}`;
    const { cache } = this.#deps;
    let touched = false;
    const changedPulls = new Set<number>();
    const emit = state.bootstrapped;

    // The first pass reads every open item and then the recent page too (closes
    // and merges), so later passes only report what really changed since.
    const lists = async (kind: "issues" | "pulls") => {
      const steady = `${base}/${kind}?state=all&sort=updated&direction=desc&per_page=${STEADY_PAGE}`;
      const groups = state.bootstrapped
        ? [[steady]]
        : [pages(`${base}/${kind}?state=open&per_page=100`), [steady]];
      const out: unknown[] = [];
      for (const group of groups) {
        for (const path of group) {
          const res = await this.#get<unknown[]>(state, path, token, path === steady);
          if (res.status === 304) break;
          const list = Array.isArray(res.body) ? res.body : [];
          out.push(...list);
          if (list.length < 100) break;
        }
      }
      return out;
    };

    for (const raw of await lists("issues")) {
      const fields = normalizeIssue(raw);
      if (!fields) continue;
      const change = cache.upsertIssue(repo.repoIds, fields);
      if (change === "none") continue;
      touched = true;
      if (emit) this.#deps.onChange({ kind: "issues", change, repo, object: raw as RawObject });
    }
    for (const raw of await lists("pulls")) {
      const fields = normalizePull(raw);
      if (!fields) continue;
      const change = cache.upsertPull(repo.repoIds, fields);
      if (change === "none") continue;
      touched = true;
      changedPulls.add(fields.number);
      if (emit) {
        this.#deps.onChange({ kind: "pull_request", change, repo, object: raw as RawObject });
      }
    }

    const primary = repo.repoIds[0] as string;
    const open = cache.openPulls(primary, MAX_CHECK_FETCHES);
    const reviewTargets = open
      .filter((p) => !state.bootstrapped || changedPulls.has(p.number))
      .slice(0, MAX_REVIEW_FETCHES);
    for (const pr of reviewTargets) {
      const path = `${base}/pulls/${pr.number}/reviews?per_page=100`;
      const res = await this.#get<unknown[]>(state, path, token, true);
      if (res.status === 200) {
        touched =
          cache.applyReviews(repo.repoIds, pr.number, reviewsFromList(res.body), true) || touched;
      }
    }

    if (state.checksPausedUntil <= this.#now()) {
      for (const pr of open) {
        if (!pr.headSha) continue;
        const path = `${base}/commits/${enc(pr.headSha)}/check-suites?per_page=100`;
        let res: Conditional<{ check_suites?: unknown[] }>;
        try {
          res = await this.#get<{ check_suites?: unknown[] }>(state, path, token, true);
        } catch (err) {
          // A PAT without "Checks: read": leave checks to webhooks for a while.
          if (err instanceof GitHubApiError && (err.status === 403 || err.status === 404)) {
            state.checksPausedUntil = this.#now() + CHECKS_FORBIDDEN_PAUSE_MS;
            break;
          }
          throw err;
        }
        if (res.status !== 200) continue;
        const suites: Record<string, SuiteState | null> = {};
        for (const suite of res.body.check_suites ?? []) {
          const id = (suite as RawObject).id;
          if (typeof id === "number") suites[String(id)] = suiteState(suite);
        }
        touched = cache.applyChecks(repo.repoIds, pr.headSha, suites, true) || touched;
      }
    }
    state.bootstrapped = true;
    return touched;
  }
}

function pages(first: string): string[] {
  return Array.from({ length: BOOTSTRAP_PAGES }, (_, i) => `${first}&page=${i + 1}`);
}
