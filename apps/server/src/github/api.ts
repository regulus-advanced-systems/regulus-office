/**
 * A small GitHub REST caller for the office connection (#141): JSON over
 * `fetch` against `OFFICE_GITHUB_API_BASE`, the bearer credential only in the
 * `Authorization` header, no redirects, a timeout, and error text redacted
 * (the credential and anything that looks like one) before it leaves here.
 */
import { redactGitOutput } from "./git.ts";
import { GITHUB_API_VERSION, GitHubApiError } from "./pulls.ts";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ERROR_CHARS = 300;

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

/** GitHub token shapes (PATs, installation, OAuth): redacted from any error text. */
const TOKEN_RE = /\b(gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,})/g;

export function redactGitHubText(text: string, secrets: readonly (string | null)[] = []): string {
  return redactGitOutput(text, secrets).replace(TOKEN_RE, "[redacted]");
}

export interface GitHubRequest {
  method?: string;
  path: string;
  /** A PAT, installation token or app JWT; omitted for the manifest conversion. */
  bearer?: string;
  body?: unknown;
}

export interface GitHubCaller {
  /** The parsed JSON body of a 2xx answer; a non-2xx throws {@link GitHubApiError}. */
  json<T>(req: GitHubRequest): Promise<T>;
}

async function errorDetail(res: Response, bearer: string | undefined): Promise<string> {
  let text = "";
  try {
    const body = (await res.json()) as { message?: unknown };
    text = typeof body.message === "string" ? body.message : "";
  } catch {
    text = "";
  }
  const clean = redactGitHubText(text || res.statusText || "no detail", [bearer ?? null]);
  return clean.length > MAX_ERROR_CHARS ? `${clean.slice(0, MAX_ERROR_CHARS - 1)}…` : clean;
}

export function createGitHubCaller(deps: {
  apiBase: string;
  fetch?: FetchFn;
  userAgent?: string;
}): GitHubCaller {
  const base = deps.apiBase.replace(/\/+$/, "");
  const doFetch: FetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
  return {
    async json<T>(req: GitHubRequest): Promise<T> {
      let res: Response;
      try {
        res = await doFetch(`${base}${req.path}`, {
          method: req.method ?? "GET",
          headers: {
            accept: "application/vnd.github+json",
            ...(req.bearer ? { authorization: `Bearer ${req.bearer}` } : {}),
            "x-github-api-version": GITHUB_API_VERSION,
            "user-agent": deps.userAgent ?? "regulus-office",
            ...(req.body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: req.body === undefined ? undefined : JSON.stringify(req.body),
          redirect: "error",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new GitHubApiError(
          0,
          redactGitHubText(`cannot reach GitHub: ${reason}`, [req.bearer ?? null]),
        );
      }
      if (!res.ok) throw new GitHubApiError(res.status, await errorDetail(res, req.bearer));
      return (await res.json()) as T;
    },
  };
}
