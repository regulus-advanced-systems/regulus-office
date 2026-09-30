/**
 * The workflow half of the fake GitHub (#155 tests only), plugged into
 * `startFakeGitHub({ extra })`: pull requests and their files, repo
 * permissions, branches, and the writes a run makes (reviews, comments,
 * labels, check runs). Every call must carry an installation token minted by
 * the fake for that repo; writes are recorded with the token that made them.
 */
import type { FakeGitHubServer } from "../../github/fake-github.ts";

export interface FakePull {
  number: number;
  title: string;
  body?: string;
  author?: string;
  authorType?: "User" | "Bot";
  draft?: boolean;
  base: string;
  head: string;
  headSha: string;
  /** `owner/name` of the head repo; defaults to the base repo (same-repo PR). */
  headRepo?: string | null;
  labels?: string[];
  files: string[];
}

export interface FakeWrite {
  kind: "review" | "comment" | "commit_comment" | "labels" | "check_run" | "check_run_update";
  repo: string;
  token: string;
  body: Record<string, unknown>;
}

export function fakeWorkflowGitHub(opts: {
  repo: string;
  pulls: FakePull[];
  /** login → `admin|maintain|write|triage|read`; others get 404. */
  permissions?: Record<string, string>;
  branches?: Record<string, string>;
  defaultBranch?: string;
}) {
  const writes: FakeWrite[] = [];
  let server: FakeGitHubServer | null = null;
  let seq = 100;
  const [owner, name] = opts.repo.split("/") as [string, string];
  const pullJson = (p: FakePull) => ({
    number: p.number,
    title: p.title,
    body: p.body ?? "",
    state: "open",
    draft: p.draft ?? false,
    user: { login: p.author ?? "alice", type: p.authorType ?? "User" },
    labels: (p.labels ?? []).map((l) => ({ name: l })),
    html_url: `https://github.example/${opts.repo}/pull/${p.number}`,
    base: { ref: p.base, repo: { full_name: opts.repo } },
    head: {
      ref: p.head,
      sha: p.headSha,
      repo: p.headRepo === null ? null : { full_name: p.headRepo ?? opts.repo },
    },
  });
  const tokenOk = (auth: string | null): string | null => {
    const token = auth?.replace(/^Bearer /, "") ?? "";
    const entry = server?.minted.get(token);
    if (!entry || entry.installation.account.toLowerCase() !== owner.toLowerCase()) return null;
    if (entry.repo && entry.repo.toLowerCase() !== name.toLowerCase()) return null;
    return token;
  };

  const handler = (req: Request, url: URL, body: unknown): Response | undefined => {
    const prefix = `/repos/${owner}/${name}`;
    if (!url.pathname.startsWith(prefix)) return undefined;
    const token = tokenOk(req.headers.get("authorization"));
    if (!token) return Response.json({ message: "Bad credentials" }, { status: 401 });
    const rest = url.pathname.slice(prefix.length);
    const record = (kind: FakeWrite["kind"]) =>
      writes.push({ kind, repo: opts.repo, token, body: (body ?? {}) as Record<string, unknown> });
    const html = (kind: string) => `https://github.example/${opts.repo}/${kind}/${(seq += 1)}`;
    let m: RegExpExecArray | null;
    if (req.method === "GET" && rest === "") {
      return Response.json({ full_name: opts.repo, default_branch: opts.defaultBranch ?? "main" });
    }
    if (req.method === "GET" && (m = /^\/pulls\/(\d+)$/.exec(rest))) {
      const p = opts.pulls.find((x) => x.number === Number(m?.[1]));
      return p
        ? Response.json(pullJson(p))
        : Response.json({ message: "Not Found" }, { status: 404 });
    }
    if (req.method === "GET" && (m = /^\/pulls\/(\d+)\/files$/.exec(rest))) {
      const p = opts.pulls.find((x) => x.number === Number(m?.[1]));
      const page = Number(url.searchParams.get("page") ?? "1");
      const files = (p?.files ?? []).slice((page - 1) * 100, page * 100);
      return Response.json(files.map((filename) => ({ filename })));
    }
    if (req.method === "GET" && (m = /^\/collaborators\/([^/]+)\/permission$/.exec(rest))) {
      const perm = opts.permissions?.[decodeURIComponent(m[1] ?? "")];
      return perm
        ? Response.json({ permission: perm === "maintain" ? "write" : perm, role_name: perm })
        : Response.json({ message: "Not Found" }, { status: 404 });
    }
    if (req.method === "GET" && (m = /^\/branches\/(.+)$/.exec(rest))) {
      const sha = opts.branches?.[decodeURIComponent(m[1] ?? "")];
      return sha
        ? Response.json({ commit: { sha } })
        : Response.json({ message: "Branch not found" }, { status: 404 });
    }
    if (req.method === "POST" && /^\/pulls\/\d+\/reviews$/.test(rest)) {
      record("review");
      return Response.json({ id: seq, html_url: html("pull/review") });
    }
    if (req.method === "POST" && /^\/issues\/\d+\/comments$/.test(rest)) {
      record("comment");
      return Response.json({ id: seq, html_url: html("issues/comment") }, { status: 201 });
    }
    if (req.method === "POST" && /^\/commits\/[^/]+\/comments$/.test(rest)) {
      record("commit_comment");
      return Response.json({ id: seq, html_url: html("commit/comment") }, { status: 201 });
    }
    if (req.method === "POST" && /^\/issues\/\d+\/labels$/.test(rest)) {
      record("labels");
      return Response.json([]);
    }
    if (req.method === "POST" && rest === "/check-runs") {
      record("check_run");
      seq += 1;
      return Response.json(
        { id: seq, html_url: `https://github.example/runs/${seq}` },
        { status: 201 },
      );
    }
    if (req.method === "PATCH" && /^\/check-runs\/\d+$/.test(rest)) {
      record("check_run_update");
      return Response.json({ id: seq });
    }
    return Response.json({ message: "Not Found" }, { status: 404 });
  };

  return {
    writes,
    handler,
    attach(s: FakeGitHubServer) {
      server = s;
    },
  };
}
