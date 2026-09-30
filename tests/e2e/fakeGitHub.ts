/**
 * A fake GitHub REST API for the agents e2e (OFFICE_GITHUB_API_BASE points here). It records
 * every request and answers the two calls the one-click PR makes (apps/server/src/github/pulls.ts):
 * `POST /repos/{o}/{r}/pulls` creates PR #1, #2, … and `GET /repos/{o}/{r}/pulls` lists them.
 * With `orgToken`, it also plays the office GitHub connection's org PAT (#141): `GET /user` and
 * `GET /user/repos` answer for that token only, listing `repos`.
 * With `boards` (#36), it also serves those repos' issues and PRs to the board poller (#35)
 * and the board panel: lists, comments, reviews, check suites and assignable users.
 * Listens on 127.0.0.1 only; nothing here talks to the real GitHub.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

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
  if (/^issues\/\d+\/comments$/.test(rest)) return [];
  if (/^pulls\/\d+\/reviews$/.test(rest)) return [];
  if (/^commits\/[^/]+\/check-suites$/.test(rest)) return { total_count: 0, check_suites: [] };
  return undefined;
}

export async function startFakeGitHub(
  org?: FakeOrgConnection,
  options: { port?: number; boards?: FakeBoards } = {},
): Promise<FakeGitHub> {
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
      requests.push({ method: req.method ?? "", path: url.pathname, headers: req.headers, body });
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      const authorized = org && req.headers.authorization === `Bearer ${org.orgToken}`;
      if (url.pathname === "/user" || url.pathname === "/user/repos") {
        if (!authorized) return send(401, { message: "Bad credentials" });
        if (url.pathname === "/user") return send(200, { login: "org-bot" });
        const page = Number(url.searchParams.get("page") ?? "1");
        const listed = page > 1 ? [] : org.repos;
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
