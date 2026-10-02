/**
 * GitHub REST pull requests for the one-click PR (SPEC §6 `agent.pr`, D14).
 *
 * The token is the operation repo's project credential and travels only in the
 * `Authorization` header, never in a URL or a log line; error text taken from
 * GitHub responses is redacted before it leaves this module. `apiBase` is
 * `OFFICE_GITHUB_API_BASE` (`https://api.github.com`), a local fake in tests.
 */
import { redactGitOutput } from "./git.ts";

export const GITHUB_API_VERSION = "2022-11-28";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ERROR_CHARS = 300;

export interface PullRequestRef {
  number: number;
  url: string;
  draft: boolean;
}

export interface CreatePullInput {
  owner: string;
  repo: string;
  /** Branch in the same repo. */
  head: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
}

export type CreatePullResult =
  | { kind: "created"; pull: PullRequestRef }
  | { kind: "exists"; pull: PullRequestRef };

export class GitHubApiError extends Error {
  override name = "GitHubApiError";
  constructor(
    readonly status: number,
    /** Redacted, short. */
    readonly detail: string,
  ) {
    super(`GitHub API responded ${status}: ${detail}`);
  }
}

export interface CommentReviewInput {
  owner: string;
  repo: string;
  number: number;
  body: string;
}

export interface PullRequestClient {
  /** Create a PR, or return the open one for the same head branch. */
  createOrFind(token: string, input: CreatePullInput): Promise<CreatePullResult>;
  /** Post a `COMMENT` review (no approval, no inline comments); returns its URL (#50). */
  createCommentReview?(token: string, input: CommentReviewInput): Promise<{ url: string }>;
}

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

interface RawPull {
  number?: unknown;
  html_url?: unknown;
  draft?: unknown;
}

function toRef(raw: RawPull): PullRequestRef {
  if (typeof raw.number !== "number" || typeof raw.html_url !== "string") {
    throw new GitHubApiError(502, "unexpected pull request payload");
  }
  return { number: raw.number, url: raw.html_url, draft: raw.draft === true };
}

async function errorDetail(res: Response, token: string): Promise<string> {
  let text = "";
  try {
    const body = (await res.json()) as { message?: unknown; errors?: unknown };
    const errors = Array.isArray(body.errors)
      ? body.errors
          .map((e) => (e && typeof e === "object" && "message" in e ? String(e.message) : ""))
          .filter(Boolean)
      : [];
    text = [typeof body.message === "string" ? body.message : "", ...errors]
      .filter(Boolean)
      .join("; ");
  } catch {
    text = res.statusText;
  }
  const clean = redactGitOutput(text || res.statusText || "no detail", [token]);
  return clean.length > MAX_ERROR_CHARS ? `${clean.slice(0, MAX_ERROR_CHARS - 1)}…` : clean;
}

const seg = (s: string) => encodeURIComponent(s);

export function createPullRequestClient(deps: {
  apiBase: string;
  fetch?: FetchFn;
  userAgent?: string;
}): PullRequestClient {
  const base = deps.apiBase.replace(/\/+$/, "");
  const doFetch: FetchFn = deps.fetch ?? ((input, init) => fetch(input, init));

  const call = (token: string, method: string, path: string, body?: unknown) =>
    doFetch(`${base}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": GITHUB_API_VERSION,
        "user-agent": deps.userAgent ?? "regulus-office",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  const findOpen = async (token: string, input: CreatePullInput) => {
    const query = new URLSearchParams({
      head: `${input.owner}:${input.head}`,
      base: input.base,
      state: "open",
    });
    const res = await call(
      token,
      "GET",
      `/repos/${seg(input.owner)}/${seg(input.repo)}/pulls?${query}`,
    );
    if (!res.ok) throw new GitHubApiError(res.status, await errorDetail(res, token));
    const list = (await res.json()) as RawPull[];
    return Array.isArray(list) && list[0] ? toRef(list[0]) : null;
  };

  return {
    async createOrFind(token, input) {
      const res = await call(token, "POST", `/repos/${seg(input.owner)}/${seg(input.repo)}/pulls`, {
        title: input.title,
        head: input.head,
        base: input.base,
        body: input.body,
        draft: input.draft,
        maintainer_can_modify: true,
      });
      if (res.ok) return { kind: "created", pull: toRef((await res.json()) as RawPull) };
      const detail = await errorDetail(res, token);
      // 422 "A pull request already exists for owner:branch."
      if (res.status === 422 && /already exists/i.test(detail)) {
        const existing = await findOpen(token, input);
        if (existing) return { kind: "exists", pull: existing };
      }
      throw new GitHubApiError(res.status, detail);
    },

    async createCommentReview(token, input) {
      const path = `/repos/${seg(input.owner)}/${seg(input.repo)}/pulls/${input.number}/reviews`;
      const res = await call(token, "POST", path, { body: input.body, event: "COMMENT" });
      if (!res.ok) throw new GitHubApiError(res.status, await errorDetail(res, token));
      const raw = (await res.json()) as { html_url?: unknown };
      if (typeof raw.html_url !== "string") {
        throw new GitHubApiError(502, "unexpected review payload");
      }
      return { url: raw.html_url };
    },
  };
}
