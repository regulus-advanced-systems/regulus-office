/**
 * A fake GitHub REST API for the agents e2e (OFFICE_GITHUB_API_BASE points here). It records
 * every request and answers the two calls the one-click PR makes (apps/server/src/github/pulls.ts):
 * `POST /repos/{o}/{r}/pulls` creates PR #1, #2, … and `GET /repos/{o}/{r}/pulls` lists them.
 * With `orgToken`, it also plays the office GitHub connection's org PAT (#141): `GET /user` and
 * `GET /user/repos` answer for that token only, listing `repos`.
 * With `boards` (#36), it also serves those repos' issues and PRs to the board poller (#35)
 * and the board panel: lists, comments, reviews, check suites and assignable users, and a merge
 * from the PR board (#43: `PUT …/pulls/{n}/merge` closes the PR as merged).
 * It also plays GitHub for people (#270): rooms open with each person's own GitHub access, so
 * the e2e people link accounts of this fake through the office's real OAuth flow
 * (githubAccess.ts) and get the rooms those accounts can see. The people, their tokens and
 * their permissions are the server's own test fake (apps/server/src/github/fake-github-users.ts).
 * `/__e2e/*` lets a test change a person's permission, as an org admin would on GitHub, and
 * (for the office flow, whose fake runs beside the office for the whole run) load board data.
 * Listens on 127.0.0.1 only; nothing here talks to the real GitHub.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type FakeGitHubUser,
  fakeGitHubUsers,
} from "../../apps/server/src/github/fake-github-users.ts";
import { E2E_GITHUB_CLIENT } from "./githubClient.ts";

/** The office owner's account: admin on every repo, as the owner of the org would be. */
export const OWNER_GITHUB = "ada-owner";
/** The member's account: sees nothing until a test gives it a permission on a repo. */
export const MEMBER_GITHUB = "ben-member";
/** A second office admin's account (the agents flow): sees nothing until a test says so. */
export const ADMIN_GITHUB = "cy-admin";
const PEOPLE: FakeGitHubUser[] = [
  { id: 9001, login: OWNER_GITHUB, repos: { "*": "admin" } },
  { id: 9002, login: MEMBER_GITHUB, repos: {} },
  { id: 9003, login: ADMIN_GITHUB, repos: {} },
];

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface FakeGitHub {
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

const PULLS = /^\/repos\/([^/]+)\/([^/]+)\/pulls$/;

export interface FakeOrgConnection {
  /** The org fine-grained PAT the office connects with. */
  orgToken: string;
  repos: { owner: string; name: string; defaultBranch: string }[];
}

/** Board data per `owner/name` (#36): raw GitHub issue and PR objects. */
export interface FakeBoards {
  [repo: string]: { issues: Record<string, unknown>[]; pulls: Record<string, unknown>[] };
}

const BOARD = /^\/repos\/([^/]+)\/([^/]+)\/(.+)$/;

/** Board reads for the poller and the panel; undefined when `path` is not one of them. */
function boardAnswer(boards: FakeBoards, path: string, url: URL): unknown {
  const m = BOARD.exec(path);
  const repo = m ? boards[`${m[1]}/${m[2]}`.toLowerCase()] : undefined;
  if (!m || !repo) return undefined;
  const rest = m[3] ?? "";
  const first = (url.searchParams.get("page") ?? "1") === "1";
  const state = url.searchParams.get("state") ?? "open";
  const pick = (list: Record<string, unknown>[]) =>
    first ? list.filter((i) => state === "all" || i.state === state) : [];
  if (rest === "issues") return pick(repo.issues);
  if (rest === "pulls") return pick(repo.pulls);
  if (rest === "assignees") return [{ login: "org-bot" }];
  const one = /^pulls\/(\d+)$/.exec(rest);
  if (one) return repo.pulls.find((p) => p.number === Number(one[1]));
  if (/^issues\/\d+\/comments$/.test(rest)) return [];
  if (/^pulls\/\d+\/reviews$/.test(rest)) return [];
  if (/^commits\/[^/]+\/check-suites$/.test(rest)) return { total_count: 0, check_suites: [] };
  return undefined;
}

export async function startFakeGitHub(
  firstOrg?: FakeOrgConnection,
  options: { port?: number; boards?: FakeBoards } = {},
): Promise<FakeGitHub> {
  let org = firstOrg;
  const people = fakeGitHubUsers({
    clientId: E2E_GITHUB_CLIENT.id,
    clientSecret: E2E_GITHUB_CLIENT.secret,
    users: PEOPLE,
  });
  const requests: RecordedRequest[] = [];
  const pulls: { number: number; html_url: string; draft: boolean; head: string }[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://fake-github");
      const text = Buffer.concat(chunks).toString("utf8");
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (url.pathname === "/__e2e/up") return send(200, { ok: true });
      // Test controls: what an org admin, or the test's own setup, does on "GitHub".
      if (url.pathname === "/__e2e/permission" && req.method === "POST") {
        const b = body as {
          login: string;
          repo: string;
          permission: "none" | "read" | "write" | "admin";
        };
        people.setPermission(b.login, b.repo, b.permission);
        return send(200, { ok: true });
      }
      if (url.pathname === "/__e2e/boards" && req.method === "POST") {
        const b = body as { org?: FakeOrgConnection; boards?: FakeBoards };
        org = b.org;
        options.boards = b.boards;
        return send(200, { ok: true });
      }
      // Local development (`bun run dev:github`): GitHub's consent page, as a list of the fake
      // accounts to link as. The e2e names the account in the URL and never sees this page.
      if (url.pathname === "/login/oauth/authorize" && !url.searchParams.has("login")) {
        const links = PEOPLE.map((p) => {
          const as = new URL(url);
          as.searchParams.set("login", p.login);
          return `<li><a href="${as.pathname}${as.search.replaceAll("&", "&amp;")}">Link as ${p.login}</a></li>`;
        }).join("");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><title>Fake GitHub</title><h1>Fake GitHub (development)</h1><ul>${links}</ul>`,
        );
        return;
      }
      // A person: the OAuth pages, and whatever their own token may read.
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(name, value);
      }
      const asPerson = people.handle(
        new Request(`http://fake-github${req.url ?? "/"}`, { method: req.method, headers }),
        url,
        body,
      );
      if (asPerson) {
        res.writeHead(asPerson.status, Object.fromEntries(asPerson.headers));
        void asPerson.text().then((payload) => res.end(payload));
        return;
      }
      // Recorded: what the office does on GitHub as itself (not test controls, not people linking).
      requests.push({ method: req.method ?? "", path: url.pathname, headers: req.headers, body });
      const authorized = org && req.headers.authorization === `Bearer ${org.orgToken}`;
      if (url.pathname === "/user" || url.pathname === "/user/repos") {
        if (!authorized) return send(401, { message: "Bad credentials" });
        if (url.pathname === "/user") return send(200, { login: "org-bot" });
        const page = Number(url.searchParams.get("page") ?? "1");
        const listed = page > 1 ? [] : (org?.repos ?? []);
        return send(
          200,
          listed.map((r) => ({
            name: r.name,
            full_name: `${r.owner}/${r.name}`,
            owner: { login: r.owner },
            private: true,
            default_branch: r.defaultBranch,
            pushed_at: new Date().toISOString(),
            description: null,
          })),
        );
      }
      if (options.boards && req.method === "GET") {
        if (!authorized) return send(401, { message: "Bad credentials" });
        const answer = boardAnswer(options.boards, url.pathname, url);
        if (answer !== undefined) return send(200, answer);
      }
      const merge = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/merge$/.exec(url.pathname);
      if (options.boards && merge && req.method === "PUT") {
        if (!authorized) return send(401, { message: "Bad credentials" });
        const repo = options.boards[`${merge[1]}/${merge[2]}`.toLowerCase()];
        const pull = repo?.pulls.find((p) => p.number === Number(merge[3]));
        if (!pull || pull.state !== "open") return send(405, { message: "Not mergeable" });
        const at = new Date().toISOString();
        Object.assign(pull, { state: "closed", merged: true, merged_at: at, updated_at: at });
        return send(200, { merged: true, sha: "e2emerge", message: "Pull Request merged" });
      }
      const m = PULLS.exec(url.pathname);
      if (!m) return send(404, { message: "Not Found" });
      const [, owner, repo] = m;
      if (req.method === "GET") return send(200, pulls);
      if (req.method !== "POST") return send(405, { message: "Method Not Allowed" });
      const input = body as { head?: string; draft?: boolean };
      const number = pulls.length + 1;
      const pull = {
        number,
        html_url: `https://github.com/${owner}/${repo}/pull/${number}`,
        draft: input.draft === true,
        head: input.head ?? "",
      };
      pulls.push(pull);
      return send(201, pull);
    });
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
