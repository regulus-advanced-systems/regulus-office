/**
 * Board endpoints for the fake GitHub (#35 tests only): repo issues and pull
 * lists, PR reviews and check suites, with ETags (`If-None-Match` → 304) and
 * rate-limit headers that a test can drain or turn into 403/429 answers.
 * Plug into {@link startFakeGitHub} as `extra`. No real GitHub is involved.
 */
import { createHash } from "node:crypto";

export interface FakeBoardRepo {
  issues: Record<string, unknown>[];
  pulls: Record<string, unknown>[];
  reviews: Record<number, Record<string, unknown>[]>;
  suites: Record<string, Record<string, unknown>[]>;
}

export interface FakeRateLimit {
  remaining: number;
  /** Unix seconds. */
  reset: number;
  /** Answer the next request with this instead (then clear it). */
  next?: { status: 403 | 429; retryAfter?: number; message?: string; remaining?: number };
  /** Paths (substring) that answer 403 "Resource not accessible" (missing permission). */
  forbidden?: string[];
}

const iso = (ms: number) => new Date(ms).toISOString();

export function fakeIssue(number: number, over: Record<string, unknown> = {}) {
  return {
    number,
    title: `Issue ${number}`,
    state: "open",
    labels: [{ name: "bug" }],
    assignees: [{ login: "ada" }],
    user: { login: "olga", type: "User" },
    html_url: `https://github.com/octo/hello/issues/${number}`,
    body: "Something is broken",
    updated_at: iso(Date.parse("2026-09-01T10:00:00Z")),
    ...over,
  };
}

export function fakePull(number: number, over: Record<string, unknown> = {}) {
  return {
    number,
    title: `PR ${number}`,
    state: "open",
    labels: [],
    assignees: [],
    user: { login: "robot", type: "User" },
    html_url: `https://github.com/octo/hello/pull/${number}`,
    body: "Fixes things",
    draft: false,
    merged_at: null,
    requested_reviewers: [],
    requested_teams: [],
    head: { ref: `office/fix-${number}`, sha: `sha${number}aaaa` },
    base: { ref: "main" },
    updated_at: iso(Date.parse("2026-09-01T10:00:00Z")),
    ...over,
  };
}

export function fakeBoards(opts: { tokens: string[] }) {
  const repos = new Map<string, FakeBoardRepo>();
  const rate: FakeRateLimit = { remaining: 5000, reset: Math.floor(Date.now() / 1000) + 3600 };
  const log: { path: string; status: number }[] = [];

  const repo = (owner: string, name: string): FakeBoardRepo => {
    const key = `${owner}/${name}`.toLowerCase();
    let r = repos.get(key);
    if (!r) {
      r = { issues: [], pulls: [], reviews: {}, suites: {} };
      repos.set(key, r);
    }
    return r;
  };

  const answer = (req: Request, path: string, body: unknown): Response => {
    const headers = {
      "x-ratelimit-limit": "5000",
      "x-ratelimit-reset": String(rate.reset),
    };
    const text = JSON.stringify(body);
    const etag = `W/"${createHash("sha1").update(text).digest("hex")}"`;
    if (req.headers.get("if-none-match") === etag) {
      log.push({ path, status: 304 });
      return new Response(null, {
        status: 304,
        headers: { ...headers, etag, "x-ratelimit-remaining": String(rate.remaining) },
      });
    }
    rate.remaining = Math.max(0, rate.remaining - 1);
    log.push({ path, status: 200 });
    return new Response(text, {
      status: 200,
      headers: {
        ...headers,
        etag,
        "content-type": "application/json",
        "x-ratelimit-remaining": String(rate.remaining),
      },
    });
  };

  const byUpdated = (list: Record<string, unknown>[]) =>
    [...list].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));

  const handler = (req: Request, url: URL): Response | undefined => {
    const m = /^\/repos\/([^/]+)\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (!m) return undefined;
    const path = url.pathname + url.search;
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    if (!opts.tokens.includes(token)) {
      log.push({ path, status: 401 });
      return Response.json({ message: "Bad credentials" }, { status: 401 });
    }
    if (rate.next) {
      const next = rate.next;
      rate.next = undefined;
      log.push({ path, status: next.status });
      return Response.json(
        { message: next.message ?? "API rate limit exceeded" },
        {
          status: next.status,
          headers: {
            "x-ratelimit-remaining": String(next.remaining ?? rate.remaining),
            "x-ratelimit-reset": String(rate.reset),
            ...(next.retryAfter !== undefined ? { "retry-after": String(next.retryAfter) } : {}),
          },
        },
      );
    }
    if (rate.forbidden?.some((f) => path.includes(f))) {
      log.push({ path, status: 403 });
      return Response.json(
        { message: "Resource not accessible by personal access token" },
        { status: 403, headers: { "x-ratelimit-remaining": String(rate.remaining) } },
      );
    }
    const r = repo(decodeURIComponent(m[1] ?? ""), decodeURIComponent(m[2] ?? ""));
    const rest = m[3] ?? "";
    const state = url.searchParams.get("state") ?? "open";
    const perPage = Number(url.searchParams.get("per_page") ?? "30");
    const page = Number(url.searchParams.get("page") ?? "1");
    const window = <T>(list: T[]) => list.slice((page - 1) * perPage, page * perPage);
    const filter = (list: Record<string, unknown>[]) =>
      state === "all" ? list : list.filter((i) => i.state === state);
    if (rest === "issues") {
      // Like GitHub: the issues list includes pull requests, marked with `pull_request`.
      const pullsAsIssues = r.pulls.map((p) => ({ ...p, pull_request: { url: "x" } }));
      return answer(req, path, window(byUpdated(filter([...r.issues, ...pullsAsIssues]))));
    }
    if (rest === "pulls") return answer(req, path, window(byUpdated(filter(r.pulls))));
    const reviews = /^pulls\/(\d+)\/reviews$/.exec(rest);
    if (reviews) return answer(req, path, r.reviews[Number(reviews[1])] ?? []);
    const suites = /^commits\/([^/]+)\/check-suites$/.exec(rest);
    if (suites) {
      const list = r.suites[decodeURIComponent(suites[1] ?? "")] ?? [];
      return answer(req, path, { total_count: list.length, check_suites: list });
    }
    return undefined;
  };

  return { repo, rate, log, handler };
}
