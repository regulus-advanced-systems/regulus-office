/**
 * GitHub calls made with one person's own token (SPEC D27; #267): the OAuth
 * web flow (authorise, exchange the code, refresh), who the token belongs to,
 * its organisations, and its permission on one repo.
 *
 * The token travels only in the `Authorization` header and the client secret
 * only in the token request's body; error text is redacted before it leaves.
 * https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
 */
import type { GitHubRepoPermission } from "@regulus/protocol";
import { createGitHubCaller, type FetchFn, type GitHubCaller, redactGitHubText } from "../api.ts";
import { GitHubApiError } from "../pulls.ts";
import { listTokenRepos } from "../repo-list.ts";
import type { OrgMembership, UserTokens } from "./store.ts";

/** The OAuth client people authorise: the office GitHub App's client, or an OAuth App. */
export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

/**
 * Scopes asked of an OAuth App: organisation membership and private repos.
 * GitHub ignores scopes for a GitHub App's client; there the app's own
 * permissions and installations bound what the token can see.
 */
export const LINK_SCOPES = ["read:org", "repo"] as const;

const TOKEN_TIMEOUT_MS = 30_000;
const ORG_PAGE_SIZE = 100;
const MAX_ORG_PAGES = 10;

/**
 * `rejected`: GitHub does not accept the token, code or refresh token any
 * more (the snapshot must drop). `unavailable`: GitHub could not answer
 * (network, 5xx, rate limit); what is known stays as it is.
 */
export class AccessGitHubError extends Error {
  override name = "AccessGitHubError";
  constructor(
    readonly kind: "rejected" | "unavailable",
    readonly detail: string,
  ) {
    super(detail);
  }
}

export interface Viewer {
  id: number;
  login: string;
}

export interface AccessGitHubDeps {
  apiBase: string;
  /** github.com: the authorise page and the token endpoint. */
  webBase: string;
  fetch?: FetchFn;
  now?: () => number;
}

const RATE_LIMIT_RE = /rate limit|abuse detection/i;

function classify(err: unknown, secrets: readonly string[]): AccessGitHubError {
  if (err instanceof AccessGitHubError) return err;
  if (err instanceof GitHubApiError) {
    const detail = `${redactGitHubText(err.detail, secrets)} (${err.status})`;
    return new AccessGitHubError(err.status === 401 ? "rejected" : "unavailable", detail);
  }
  const reason = err instanceof Error ? err.message : String(err);
  return new AccessGitHubError("unavailable", redactGitHubText(reason, secrets).slice(0, 300));
}

/** GitHub's `permissions` object on a repo → the highest level it grants. */
export function permissionFromRepo(raw: unknown): GitHubRepoPermission {
  const p =
    raw && typeof raw === "object"
      ? ((raw as { permissions?: unknown }).permissions as Record<string, unknown> | undefined)
      : undefined;
  // GitHub answered 200, so the repo is at least readable.
  if (!p || typeof p !== "object") return "read";
  if (p.admin === true) return "admin";
  if (p.maintain === true) return "maintain";
  if (p.push === true) return "write";
  if (p.triage === true) return "triage";
  return "read";
}

export class AccessGitHub {
  readonly #api: GitHubCaller;
  readonly #webBase: string;
  readonly #fetch: FetchFn;
  readonly #now: () => number;

  constructor(deps: AccessGitHubDeps) {
    this.#api = createGitHubCaller({ apiBase: deps.apiBase, fetch: deps.fetch });
    this.#webBase = deps.webBase.replace(/\/+$/, "");
    this.#fetch = deps.fetch ?? ((input, init) => fetch(input, init));
    this.#now = deps.now ?? Date.now;
  }

  /** Where the browser goes to authorise the link. */
  authorizeUrl(client: OAuthClient, state: string, redirectUri: string): string {
    const q = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: redirectUri,
      state,
      scope: LINK_SCOPES.join(" "),
      allow_signup: "false",
    });
    return `${this.#webBase}/login/oauth/authorize?${q.toString()}`;
  }

  async #token(client: OAuthClient, grant: Record<string, string>): Promise<UserTokens> {
    const secrets = [client.clientSecret, ...Object.values(grant)];
    let res: Response;
    try {
      res = await this.#fetch(`${this.#webBase}/login/oauth/access_token`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "regulus-office",
        },
        body: JSON.stringify({
          client_id: client.clientId,
          client_secret: client.clientSecret,
          ...grant,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      });
    } catch (err) {
      throw classify(err, secrets);
    }
    let body: Record<string, unknown> = {};
    try {
      body = ((await res.json()) as Record<string, unknown> | null) ?? {};
    } catch {
      body = {};
    }
    if (res.status >= 500 || res.status === 429) {
      throw new AccessGitHubError("unavailable", `GitHub answered ${res.status}`);
    }
    // GitHub answers 200 with an `error` field when it refuses a code or refresh token.
    if (!res.ok || typeof body.access_token !== "string" || body.access_token.length === 0) {
      const code = typeof body.error === "string" ? body.error : `http_${res.status}`;
      throw new AccessGitHubError("rejected", redactGitHubText(code, secrets).slice(0, 100));
    }
    const now = this.#now();
    const inSeconds = (v: unknown) => (typeof v === "number" && v > 0 ? now + v * 1000 : null);
    return {
      accessToken: body.access_token,
      refreshToken:
        typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null,
      expiresAt: inSeconds(body.expires_in),
      refreshExpiresAt: inSeconds(body.refresh_token_expires_in),
    };
  }

  /** Exchange the callback's one-time code for the person's token. */
  exchangeCode(client: OAuthClient, code: string, redirectUri: string): Promise<UserTokens> {
    return this.#token(client, { code, redirect_uri: redirectUri });
  }

  /** A GitHub App user token expired: trade the refresh token for a new pair. */
  refresh(client: OAuthClient, refreshToken: string): Promise<UserTokens> {
    return this.#token(client, { grant_type: "refresh_token", refresh_token: refreshToken });
  }

  /** The account the token belongs to. A 401 here means the token is revoked or expired. */
  async viewer(token: string): Promise<Viewer> {
    try {
      const raw = await this.#api.json<{ id?: unknown; login?: unknown }>({
        path: "/user",
        bearer: token,
      });
      if (typeof raw.id !== "number" || typeof raw.login !== "string") {
        throw new AccessGitHubError("unavailable", "GitHub returned an unexpected user payload");
      }
      return { id: raw.id, login: raw.login.slice(0, 100) };
    } catch (err) {
      throw classify(err, [token]);
    }
  }

  /** The organisations the account is an active member of. */
  async orgs(token: string): Promise<OrgMembership[]> {
    const out: OrgMembership[] = [];
    try {
      for (let page = 1; page <= MAX_ORG_PAGES; page++) {
        const rows = await this.#api.json<unknown[]>({
          path: `/user/memberships/orgs?state=active&per_page=${ORG_PAGE_SIZE}&page=${page}`,
          bearer: token,
        });
        if (!Array.isArray(rows)) break;
        for (const row of rows) {
          const r = row as { organization?: { login?: unknown; id?: unknown }; role?: unknown };
          const login = r.organization?.login;
          if (typeof login !== "string" || login.length === 0) continue;
          out.push({
            login: login.slice(0, 100),
            id: typeof r.organization?.id === "number" ? r.organization.id : null,
            role: r.role === "admin" ? "admin" : "member",
          });
        }
        if (rows.length < ORG_PAGE_SIZE) break;
      }
    } catch (err) {
      throw classify(err, [token]);
    }
    return out;
  }

  /**
   * Every repo the account can see, as lower-case `owner/name` (#270: the
   * repo picker lists only these). `truncated` when the account sees more
   * than the list holds.
   */
  async visibleRepoNames(token: string): Promise<{ names: Set<string>; truncated: boolean }> {
    try {
      const list = await listTokenRepos(this.#api, token);
      return {
        names: new Set(list.repos.map((r) => r.fullName.toLowerCase())),
        truncated: list.truncated,
      };
    } catch (err) {
      throw classify(err, [token]);
    }
  }

  /**
   * The token's permission on one repo. GitHub hides a repo the account
   * cannot see behind a 404; that, and a refusal that is not a rate limit, is
   * `none`. Anything GitHub could not answer throws `unavailable`.
   */
  async repoPermission(token: string, owner: string, name: string): Promise<GitHubRepoPermission> {
    try {
      const raw = await this.#api.json<unknown>({
        path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
        bearer: token,
      });
      return permissionFromRepo(raw);
    } catch (err) {
      if (err instanceof GitHubApiError) {
        if (err.status === 404 || err.status === 451) return "none";
        if (err.status === 403 && !RATE_LIMIT_RE.test(err.detail)) return "none";
      }
      throw classify(err, [token]);
    }
  }
}
