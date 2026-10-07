/**
 * People on the fake GitHub (#267): the OAuth web flow (authorise, code
 * exchange, refresh) and what each person's own token can see: who they are,
 * their organisations, and their permission on a repo. Tests change a
 * permission, revoke a person's tokens or let them expire, as an org admin or
 * the person would on GitHub. Only imported by tests.
 *
 *   const people = fakeGitHubUsers({ clientId, clientSecret, users: [...] });
 *   const gh = startFakeGitHub({ users: people });
 */
import type { GitHubRepoPermission } from "@regulus/protocol";

export interface FakeGitHubUser {
  id: number;
  login: string;
  orgs?: { login: string; id?: number; role?: "admin" | "member" }[];
  /**
   * `owner/name` → permission; a repo that is not listed is invisible (404),
   * unless `*` gives a permission on every repo that is not listed.
   */
  repos?: Record<string, GitHubRepoPermission>;
}

const LEVELS: GitHubRepoPermission[] = ["none", "read", "triage", "write", "maintain", "admin"];

export function fakeGitHubUsers(opts: {
  clientId: string;
  clientSecret: string;
  users: FakeGitHubUser[];
  /** GitHub App style: tokens expire after this many seconds and come with a refresh token. */
  expiresInSeconds?: number;
}) {
  const lower = (repos: FakeGitHubUser["repos"]) =>
    Object.fromEntries(Object.entries(repos ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const users = new Map(
    opts.users.map((u) => [u.login, { ...structuredClone(u), repos: lower(u.repos) }]),
  );
  const codes = new Map<string, string>();
  /** Live access tokens → login. */
  const tokens = new Map<string, string>();
  const refreshTokens = new Map<string, string>();
  /** Every access or refresh token ever handed out, for leak checks. */
  const issued: string[] = [];
  const flags = { rateLimited: false, orgsForbidden: false };
  let seq = 0;

  const user = (login: string): FakeGitHubUser => {
    const u = users.get(login);
    if (!u) throw new Error(`no fake GitHub user ${login}`);
    return u;
  };
  const mint = (login: string) => {
    seq += 1;
    const accessToken = `ghu_fakeUserToken${seq}x${login}`;
    tokens.set(accessToken, login);
    issued.push(accessToken);
    const out: Record<string, unknown> = {
      access_token: accessToken,
      token_type: "bearer",
      scope: "",
    };
    if (opts.expiresInSeconds) {
      const refreshToken = `ghr_fakeRefreshToken${seq}x${login}`;
      refreshTokens.set(refreshToken, login);
      issued.push(refreshToken);
      out.expires_in = opts.expiresInSeconds;
      out.refresh_token = refreshToken;
      out.refresh_token_expires_in = 15_897_600;
    }
    return out;
  };
  const dropTokens = (login: string, alsoRefresh: boolean) => {
    for (const [t, l] of tokens) if (l === login) tokens.delete(t);
    if (!alsoRefresh) return;
    for (const [t, l] of refreshTokens) if (l === login) refreshTokens.delete(t);
  };

  return {
    issued,
    flags,
    /** The person approved the office on GitHub: the one-time code GitHub redirects back with. */
    authorize(login: string): string {
      user(login);
      seq += 1;
      const code = `fakecode${seq}${login}`;
      codes.set(code, login);
      return code;
    },
    setPermission(login: string, repo: string, permission: GitHubRepoPermission): void {
      const u = user(login);
      u.repos = { ...u.repos, [repo.toLowerCase()]: permission };
    },
    setOrgs(login: string, orgs: NonNullable<FakeGitHubUser["orgs"]>): void {
      user(login).orgs = orgs;
    },
    /** The person (or GitHub) revoked the office's authorisation: every token is dead. */
    revoke(login: string): void {
      dropTokens(login, true);
    },
    /** The access tokens ran out; a refresh token (if any) still works. */
    expire(login: string): void {
      dropTokens(login, false);
    },
    handle(req: Request, url: URL, body: unknown): Response | undefined {
      if (url.pathname === "/login/oauth/authorize") {
        // No consent page here: `login` says who "clicked Authorize".
        const login = url.searchParams.get("login") ?? "";
        const back = new URL(url.searchParams.get("redirect_uri") ?? "http://invalid.test/");
        back.searchParams.set("state", url.searchParams.get("state") ?? "");
        if (url.searchParams.get("client_id") !== opts.clientId || !users.has(login)) {
          back.searchParams.set("error", "access_denied");
        } else {
          seq += 1;
          const code = `fakecode${seq}${login}`;
          codes.set(code, login);
          back.searchParams.set("code", code);
        }
        return new Response(null, { status: 302, headers: { location: back.toString() } });
      }
      if (url.pathname === "/login/oauth/access_token" && req.method === "POST") {
        const b = (body ?? {}) as Record<string, unknown>;
        if (b.client_id !== opts.clientId || b.client_secret !== opts.clientSecret) {
          return Response.json({ error: "incorrect_client_credentials" });
        }
        if (b.grant_type === "refresh_token") {
          const login = refreshTokens.get(String(b.refresh_token));
          if (!login) return Response.json({ error: "bad_refresh_token" });
          refreshTokens.delete(String(b.refresh_token));
          return Response.json(mint(login));
        }
        const login = codes.get(String(b.code));
        if (!login) return Response.json({ error: "bad_verification_code" });
        codes.delete(String(b.code));
        return Response.json(mint(login));
      }
      const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      // Not a person's token: installation tokens and PATs are the other fakes' business.
      if (!issued.includes(bearer)) return undefined;
      const login = tokens.get(bearer);
      if (!login) return Response.json({ message: "Bad credentials" }, { status: 401 });
      if (flags.rateLimited) {
        return Response.json({ message: "API rate limit exceeded for user" }, { status: 403 });
      }
      const u = user(login);
      if (url.pathname === "/user") return Response.json({ id: u.id, login: u.login });
      if (url.pathname === "/user/memberships/orgs") {
        if (flags.orgsForbidden) {
          return Response.json({ message: "Resource not accessible" }, { status: 403 });
        }
        return Response.json(
          (u.orgs ?? []).map((o) => ({
            state: "active",
            role: o.role ?? "member",
            organization: { login: o.login, id: o.id ?? 1 },
          })),
        );
      }
      if (url.pathname === "/user/repos") {
        // What the account can see (#270: the repo picker); one page is plenty here.
        if ((url.searchParams.get("page") ?? "1") !== "1") return Response.json([]);
        return Response.json(
          Object.entries(u.repos ?? {})
            .filter(([name, p]) => name !== "*" && p !== "none")
            .map(([fullName]) => ({
              name: fullName.split("/")[1],
              full_name: fullName,
              owner: { login: fullName.split("/")[0] },
              private: true,
              default_branch: "main",
              pushed_at: "2026-09-01T10:00:00Z",
              description: null,
            })),
        );
      }
      const repo = /^\/repos\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (repo) {
        const fullName = `${repo[1]}/${repo[2]}`;
        // `*` is the person's permission on every repo not listed (an org owner in the e2e).
        const level = LEVELS.indexOf(u.repos?.[fullName.toLowerCase()] ?? u.repos?.["*"] ?? "none");
        if (level <= 0) return Response.json({ message: "Not Found" }, { status: 404 });
        return Response.json({
          full_name: fullName,
          permissions: {
            pull: level >= 1,
            triage: level >= 2,
            push: level >= 3,
            maintain: level >= 4,
            admin: level >= 5,
          },
        });
      }
      return undefined;
    },
  };
}

export type FakeGitHubUsers = ReturnType<typeof fakeGitHubUsers>;
