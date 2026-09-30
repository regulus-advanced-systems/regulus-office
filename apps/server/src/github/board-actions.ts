/**
 * GitHub REST calls behind the board panel (#36): read a card's comments and
 * the repo's assignable users, and the write actions (comment, assign /
 * unassign, merge, close). Every call takes the office credential for the
 * repo (an installation token narrowed to it, or the org PAT) in `token`;
 * it only travels in the `Authorization` header (api.ts), and GitHub error
 * text is redacted there.
 *
 * https://docs.github.com/en/rest/issues/comments
 * https://docs.github.com/en/rest/issues/assignees
 * https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request
 * https://docs.github.com/en/rest/issues/issues#update-an-issue
 * https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request
 */
import { type BoardComment, type CardKind, type MergeMethod, VIA_OFFICE } from "@regulus/protocol";
import { createGitHubCaller, type FetchFn, type GitHubCaller } from "./api.ts";
import { asObject, parseTime } from "./board-normalize.ts";

export interface RepoName {
  owner: string;
  name: string;
}

const MAX_COMMENTS = 50;
const MAX_COMMENT_BODY = 16_000;
const MAX_ASSIGNEES = 100;

const e = encodeURIComponent;
const repoPath = (r: RepoName) => `/repos/${e(r.owner)}/${e(r.name)}`;

function toComment(raw: unknown): BoardComment | null {
  const o = asObject(raw);
  if (!o || typeof o.id !== "number") return null;
  const login = asObject(o.user)?.login;
  return {
    id: o.id,
    author: typeof login === "string" ? login.slice(0, 64) : "",
    bodyMd: typeof o.body === "string" ? o.body.slice(0, MAX_COMMENT_BODY) : "",
    createdAt: Math.max(0, parseTime(o.created_at) ?? 0),
    url: typeof o.html_url === "string" ? o.html_url.slice(0, 512) : "",
  };
}

export interface BoardGitHub {
  /** The latest comments, oldest first (at most 50). */
  comments(token: string, repo: RepoName, number: number): Promise<BoardComment[]>;
  assignees(token: string, repo: RepoName): Promise<string[]>;
  comment(token: string, repo: RepoName, number: number, body: string): Promise<BoardComment>;
  /** Returns the updated issue object (for the cache). */
  assign(
    token: string,
    repo: RepoName,
    number: number,
    change: { add: string[]; remove: string[] },
  ): Promise<unknown>;
  merge(
    token: string,
    repo: RepoName,
    number: number,
    method: MergeMethod,
  ): Promise<{ merged: boolean; sha: string | null }>;
  /** Close an issue or a PR; returns the updated object (for the cache). */
  close(token: string, repo: RepoName, kind: CardKind, number: number): Promise<unknown>;
  /** The current issue or PR object (to refresh the cache after a merge). */
  fetch(token: string, repo: RepoName, kind: CardKind, number: number): Promise<unknown>;
}

export function createBoardGitHub(deps: {
  apiBase: string;
  fetch?: FetchFn;
  caller?: GitHubCaller;
}): BoardGitHub {
  const api = deps.caller ?? createGitHubCaller({ apiBase: deps.apiBase, fetch: deps.fetch });
  return {
    async comments(token, repo, number) {
      // Newest page first would need the Link header; issues rarely pass 50 comments,
      // so read the first 100 and keep the latest 50.
      const list = await api.json<unknown[]>({
        path: `${repoPath(repo)}/issues/${number}/comments?per_page=100`,
        bearer: token,
      });
      const out = (Array.isArray(list) ? list : [])
        .map(toComment)
        .filter((c): c is BoardComment => c !== null);
      return out.slice(-MAX_COMMENTS);
    },

    async assignees(token, repo) {
      const list = await api.json<unknown[]>({
        path: `${repoPath(repo)}/assignees?per_page=${MAX_ASSIGNEES}`,
        bearer: token,
      });
      return (Array.isArray(list) ? list : [])
        .map((u) => asObject(u)?.login)
        .filter((l): l is string => typeof l === "string")
        .map((l) => l.slice(0, 64));
    },

    async comment(token, repo, number, body) {
      const raw = await api.json<unknown>({
        method: "POST",
        path: `${repoPath(repo)}/issues/${number}/comments`,
        bearer: token,
        body: { body },
      });
      const c = toComment(raw);
      if (!c) throw new Error("unexpected comment payload");
      return c;
    },

    async assign(token, repo, number, change) {
      let latest: unknown = null;
      const path = `${repoPath(repo)}/issues/${number}/assignees`;
      if (change.remove.length > 0) {
        latest = await api.json({
          method: "DELETE",
          path,
          bearer: token,
          body: { assignees: change.remove },
        });
      }
      if (change.add.length > 0) {
        latest = await api.json({
          method: "POST",
          path,
          bearer: token,
          body: { assignees: change.add },
        });
      }
      return latest;
    },

    async merge(token, repo, number, method) {
      const res = await api.json<{ merged?: unknown; sha?: unknown }>({
        method: "PUT",
        path: `${repoPath(repo)}/pulls/${number}/merge`,
        bearer: token,
        body: { merge_method: method },
      });
      return { merged: res?.merged === true, sha: typeof res?.sha === "string" ? res.sha : null };
    },

    close(token, repo, kind, number) {
      return api.json({
        method: "PATCH",
        path: `${repoPath(repo)}/${kind === "pr" ? "pulls" : "issues"}/${number}`,
        bearer: token,
        body: { state: "closed" },
      });
    },

    fetch(token, repo, kind, number) {
      return api.json({
        path: `${repoPath(repo)}/${kind === "pr" ? "pulls" : "issues"}/${number}`,
        bearer: token,
      });
    },
  };
}

/**
 * The comment body the office posts for a human: their text, then a footer
 * naming them and the office. The name is plain text, so markdown in a
 * display name cannot turn into a link or a mention.
 */
export function officeCommentBody(text: string, humanName: string): string {
  const name = humanName
    .replace(/[\r\n]+/g, " ")
    .replace(/([\\`*_{}[\]()#+\-.!<>|~@])/g, "\\$1")
    .slice(0, 160);
  return `${text.trim()}\n\n---\n_Posted by ${name} ${VIA_OFFICE}_`;
}
