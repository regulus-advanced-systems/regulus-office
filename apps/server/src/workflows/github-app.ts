/**
 * GitHub calls of workflow runs (#155), always as the office's GitHub App:
 * a one-hour installation token narrowed to the one repo
 * (`GitHubConnection.tokenFor`). A PAT connection is refused, so nothing is
 * ever posted with a person's token. Every write is audited by the caller.
 *
 * REST: https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request,
 * /rest/issues/comments, /rest/issues/labels, /rest/checks/runs,
 * /rest/collaborators/collaborators#get-repository-permissions-for-a-user.
 */
import type { GitHubCaller } from "../github/api.ts";
import type { GitHubConnection } from "../github/connection.ts";
import { type PullFacts, pullFacts } from "./context.ts";

export class WorkflowRefusal extends Error {
  override name = "WorkflowRefusal";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface RepoName {
  owner: string;
  name: string;
}

type Raw = Record<string, unknown>;
const path = (r: RepoName) => `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`;
const url = (v: unknown) => (typeof v === "string" ? v.slice(0, 500) : "");

export type RepoPermission = "admin" | "maintain" | "write" | "triage" | "read" | "none";
const WRITERS = new Set<RepoPermission>(["admin", "maintain", "write"]);
export const canWrite = (p: RepoPermission) => WRITERS.has(p);

export interface ReviewInput {
  commitId: string;
  body: string;
  event: "COMMENT" | "REQUEST_CHANGES" | "APPROVE";
  comments: { path: string; line: number; body: string }[];
}

export interface CheckRunInput {
  name: string;
  headSha: string;
  status: "in_progress" | "completed";
  conclusion?: "neutral" | "success" | "failure" | "cancelled" | "skipped";
  title: string;
  summary: string;
  detailsUrl?: string;
}

/** The App's view of one repo for one run. */
export class AppRepoClient {
  constructor(
    private readonly api: GitHubCaller,
    private readonly token: string,
    readonly repo: RepoName,
  ) {}

  #get<T>(p: string): Promise<T> {
    return this.api.json<T>({ path: `${path(this.repo)}${p}`, bearer: this.token });
  }

  #send<T>(method: string, p: string, body: unknown): Promise<T> {
    return this.api.json<T>({ method, path: `${path(this.repo)}${p}`, bearer: this.token, body });
  }

  async pull(number: number): Promise<PullFacts> {
    const raw = await this.#get<Raw>(`/pulls/${number}`);
    const facts = pullFacts(raw, `${this.repo.owner}/${this.repo.name}`);
    if (!facts) throw new Error("GitHub returned an unexpected pull request");
    return facts;
  }

  /** Changed file names of a PR (GitHub lists at most 3000). */
  async pullFiles(number: number): Promise<string[]> {
    const out: string[] = [];
    for (let page = 1; page <= 30; page += 1) {
      const list = await this.#get<Raw[]>(`/pulls/${number}/files?per_page=100&page=${page}`);
      if (!Array.isArray(list)) break;
      for (const f of list) if (typeof f.filename === "string") out.push(f.filename.slice(0, 500));
      if (list.length < 100) break;
    }
    return out;
  }

  /** The commenter's permission on the repo (commands need write). */
  async permission(login: string): Promise<RepoPermission> {
    try {
      const raw = await this.#get<Raw>(`/collaborators/${encodeURIComponent(login)}/permission`);
      const p = String(raw.role_name ?? raw.permission ?? "none");
      return (
        ["admin", "maintain", "write", "triage", "read"].includes(p) ? p : "none"
      ) as RepoPermission;
    } catch {
      return "none";
    }
  }

  async branchHead(branch: string): Promise<string> {
    const raw = await this.#get<Raw>(`/branches/${encodeURIComponent(branch)}`);
    const sha = (raw.commit as Raw | undefined)?.sha;
    if (typeof sha !== "string") throw new Error("GitHub returned an unexpected branch");
    return sha;
  }

  async defaultBranch(): Promise<string> {
    const raw = await this.#get<Raw>("");
    return typeof raw.default_branch === "string" ? raw.default_branch : "main";
  }

  async createReview(number: number, input: ReviewInput): Promise<string> {
    const raw = await this.#send<Raw>("POST", `/pulls/${number}/reviews`, {
      commit_id: input.commitId,
      body: input.body,
      event: input.event,
      comments: input.comments.map((c) => ({
        path: c.path,
        line: c.line,
        side: "RIGHT",
        body: c.body,
      })),
    });
    return url(raw.html_url);
  }

  async comment(number: number, body: string): Promise<string> {
    const raw = await this.#send<Raw>("POST", `/issues/${number}/comments`, { body });
    return url(raw.html_url);
  }

  async commitComment(sha: string, body: string): Promise<string> {
    const raw = await this.#send<Raw>("POST", `/commits/${encodeURIComponent(sha)}/comments`, {
      body,
    });
    return url(raw.html_url);
  }

  async addLabels(number: number, labels: string[]): Promise<void> {
    await this.#send<unknown>("POST", `/issues/${number}/labels`, { labels });
  }

  async createCheckRun(input: CheckRunInput): Promise<{ id: number; url: string }> {
    const raw = await this.#send<Raw>("POST", "/check-runs", {
      name: input.name,
      head_sha: input.headSha,
      status: input.status,
      ...(input.conclusion ? { conclusion: input.conclusion } : {}),
      ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
      output: { title: input.title, summary: input.summary },
    });
    return { id: typeof raw.id === "number" ? raw.id : 0, url: url(raw.html_url) };
  }

  async completeCheckRun(
    id: number,
    input: Pick<CheckRunInput, "conclusion" | "title" | "summary">,
  ): Promise<void> {
    await this.#send<unknown>("PATCH", `/check-runs/${id}`, {
      status: "completed",
      conclusion: input.conclusion ?? "neutral",
      output: { title: input.title, summary: input.summary },
    });
  }
}

/** The App client for a repo, or a refusal: no App connected, or the App cannot see the repo. */
export async function appClientFor(
  connection: Pick<GitHubConnection, "app" | "tokenFor" | "api">,
  repo: RepoName,
): Promise<{ client: AppRepoClient; token: string }> {
  if (!connection.app()) {
    throw new WorkflowRefusal(
      "github_app_required",
      "workflows post only as the office's GitHub App; connect one in Settings → GitHub",
    );
  }
  const token = await connection.tokenFor(repo.owner, repo.name);
  if (!token) {
    throw new WorkflowRefusal(
      "repo_not_installed",
      "the office's GitHub App is not installed on this repo",
    );
  }
  return { client: new AppRepoClient(connection.api, token, repo), token };
}
