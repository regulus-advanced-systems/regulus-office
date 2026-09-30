/**
 * The office's internal GitHub event bus (#35), the hook #155 (workflows)
 * subscribes to. Only verified webhook deliveries (signature checked,
 * delivery id deduplicated) and changes the poller observed are emitted.
 *
 *   const off = sync.events.on("pull_request", (e) => {
 *     if (e.fromOfficeApp || e.stale) return; // loop protection, replays
 *     if (e.action === "opened") ...
 *   });
 *
 * Handlers run after the board cache has been updated; they are called
 * without being awaited (a webhook must be answered within 10 s), and a
 * throwing or rejecting handler is logged and does not affect the others.
 */
import type { Logger } from "../logging.ts";

export interface GitHubAccount {
  login: string;
  id: number | null;
  /** `User`, `Bot` or `Organization`. */
  type: string;
}

export interface GitHubRepoName {
  owner: string;
  name: string;
  fullName: string;
}

/** The fields the office reads; the rest of GitHub's payload is kept as is. */
export interface RawObject {
  [key: string]: unknown;
}

export interface IssuesPayload extends RawObject {
  action?: string;
  issue?: RawObject;
}
export interface PullRequestPayload extends RawObject {
  action?: string;
  number?: number;
  pull_request?: RawObject;
}
export interface PullRequestReviewPayload extends RawObject {
  action?: string;
  review?: RawObject;
  pull_request?: RawObject;
}
export interface CheckSuitePayload extends RawObject {
  action?: string;
  check_suite?: RawObject;
}
export interface CheckRunPayload extends RawObject {
  action?: string;
  check_run?: RawObject;
}
export interface PushPayload extends RawObject {
  ref?: string;
  before?: string;
  after?: string;
}
export interface IssueCommentPayload extends RawObject {
  action?: string;
  issue?: RawObject;
  comment?: RawObject;
}
export interface InstallationPayload extends RawObject {
  action?: string;
  installation?: RawObject;
}

/** Event name (the `X-GitHub-Event` header) → payload type. */
export interface GitHubEventPayloads {
  issues: IssuesPayload;
  pull_request: PullRequestPayload;
  pull_request_review: PullRequestReviewPayload;
  check_suite: CheckSuitePayload;
  check_run: CheckRunPayload;
  push: PushPayload;
  issue_comment: IssueCommentPayload;
  installation: InstallationPayload;
  installation_repositories: InstallationPayload;
}

export type GitHubEventName = keyof GitHubEventPayloads;

export const GITHUB_EVENT_NAMES: readonly GitHubEventName[] = [
  "issues",
  "pull_request",
  "pull_request_review",
  "check_suite",
  "check_run",
  "push",
  "issue_comment",
  "installation",
  "installation_repositories",
];

export function isGitHubEventName(name: string): name is GitHubEventName {
  return (GITHUB_EVENT_NAMES as readonly string[]).includes(name);
}

export interface GitHubEvent<N extends GitHubEventName = GitHubEventName> {
  name: N;
  action: string | null;
  /** `X-GitHub-Delivery`, or `poll:<repo>:<kind>:<number>:<updatedAt>` for polled changes. */
  deliveryId: string;
  /**
   * `webhook`: a verified delivery with GitHub's full payload. `poll`: a
   * change the poller saw; the action is coarse (`opened`, `closed`,
   * `reopened`, `synchronize`, `updated`) and the payload holds the REST object.
   */
  source: "webhook" | "poll";
  receivedAt: number;
  repo: GitHubRepoName | null;
  /** Floor repo rows (and their floors) that follow this GitHub repo. */
  repoIds: string[];
  floorIds: string[];
  installationId: number | null;
  sender: GitHubAccount | null;
  /**
   * Loop protection for #155: true when the office's own GitHub App caused
   * the event (the sender is `<app-slug>[bot]`, or the object was
   * `performed_via_github_app` / created by the app). Workflows must ignore these.
   */
  fromOfficeApp: boolean;
  /**
   * True when the object the event is about was last updated before the
   * dedupe window: an old delivery replayed after its id was pruned.
   */
  stale: boolean;
  payload: GitHubEventPayloads[N];
}

export type AnyGitHubEvent = { [N in GitHubEventName]: GitHubEvent<N> }[GitHubEventName];

type Handler<N extends GitHubEventName> = (event: GitHubEvent<N>) => void | Promise<void>;
type AnyHandler = (event: AnyGitHubEvent) => void | Promise<void>;

export class GitHubEventBus {
  readonly #handlers = new Map<string, Set<(event: AnyGitHubEvent) => unknown>>();
  readonly #logger: Logger | undefined;

  constructor(logger?: Logger) {
    this.#logger = logger;
  }

  /** Subscribe to one event name, or `*` for all. Returns an unsubscribe function. */
  on<N extends GitHubEventName>(name: N, handler: Handler<N>): () => void;
  on(name: "*", handler: AnyHandler): () => void;
  on(name: string, handler: (event: never) => unknown): () => void {
    const set = this.#handlers.get(name) ?? new Set();
    const fn = handler as (event: AnyGitHubEvent) => unknown;
    set.add(fn);
    this.#handlers.set(name, set);
    return () => {
      set.delete(fn);
    };
  }

  emit(event: AnyGitHubEvent): void {
    const handlers = [
      ...(this.#handlers.get(event.name) ?? []),
      ...(this.#handlers.get("*") ?? []),
    ];
    for (const handler of handlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) result.catch((err) => this.#failed(event, err));
      } catch (err) {
        this.#failed(event, err);
      }
    }
  }

  get listenerCount(): number {
    let n = 0;
    for (const set of this.#handlers.values()) n += set.size;
    return n;
  }

  #failed(event: AnyGitHubEvent, err: unknown): void {
    this.#logger?.error(
      { event: event.name, deliveryId: event.deliveryId, err },
      "github event handler failed",
    );
  }
}

/** The office App's identity, for loop protection. */
export interface OfficeAppIdentity {
  appId: number;
  slug: string | null;
}

const obj = (v: unknown): RawObject | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as RawObject) : null;

export function accountOf(v: unknown): GitHubAccount | null {
  const o = obj(v);
  if (!o || typeof o.login !== "string") return null;
  return {
    login: o.login,
    id: typeof o.id === "number" ? o.id : null,
    type: typeof o.type === "string" ? o.type : "User",
  };
}

/** True when the office's own App caused this payload (see {@link GitHubEvent.fromOfficeApp}). */
export function causedByApp(payload: RawObject, app: OfficeAppIdentity | null): boolean {
  if (!app) return false;
  const sender = accountOf(payload.sender);
  if (sender?.type === "Bot" && app.slug && sender.login.toLowerCase() === `${app.slug}[bot]`) {
    return true;
  }
  const viaApp = (v: unknown) => obj(obj(v)?.performed_via_github_app)?.id === app.appId;
  const ownApp = (v: unknown) => obj(obj(v)?.app)?.id === app.appId;
  return (
    viaApp(payload.issue) ||
    viaApp(payload.comment) ||
    viaApp(payload.pull_request) ||
    ownApp(payload.check_suite) ||
    ownApp(payload.check_run)
  );
}
