/** One-click PR: push over file://, PR via a fake GitHub REST server. */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { agents, auditLog } from "../db/schema/index.ts";
import { draftBody, draftTitle } from "./pull-request.ts";
import {
  commitIn,
  FAKE_PAT,
  fakeGitHub,
  filesContaining,
  git,
  type RecordedRequest,
  setupFloor,
} from "./test-helpers.ts";
import { WorkspaceError } from "./types.ts";

let root: string;
let github: ReturnType<typeof fakeGitHub> | undefined;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "office-prs-"));
});

afterEach(() => {
  github?.stop();
  github = undefined;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const pullJson = (number: number, draft = false) =>
  Response.json(
    { number, html_url: `https://github.com/octo/hello/pull/${number}`, draft },
    { status: 201 },
  );

async function agentWithWork(
  respond: (req: RecordedRequest) => Response,
  fields: { taskTitle?: string; issueNumber?: number; token?: boolean } = {},
) {
  github = fakeGitHub(respond);
  const f = await setupFloor(root, { apiBase: github.url, token: fields.token });
  const agentId = f.addAgent(`agent-${crypto.randomUUID().slice(0, 6)}`, fields);
  const ws = await f.worktrees.workspaces.prepare({
    agentId,
    floorId: f.floorId,
    repoId: f.repo.repoId,
    slug: "login fix",
    ownerUserId: f.owner.id,
  });
  return { f, agentId, ws, requests: github.requests };
}

async function errorOf(p: Promise<unknown>): Promise<WorkspaceError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof WorkspaceError) return err;
    throw err;
  }
  throw new Error("expected a WorkspaceError");
}

describe("drafting", () => {
  const commits = [
    { sha: "abc1234", subject: "Fix login redirect" },
    { sha: "def5678", subject: "Add test" },
  ];
  test("title: task title, else the first commit subject", () => {
    expect(draftTitle("Fix the login", commits)).toBe("Fix the login");
    expect(draftTitle("  ", commits)).toBe("Fix login redirect");
    expect(draftTitle("", [])).toBe("Changes from Regulus Office");
  });
  test("body: commits, Closes #n, office note", () => {
    const body = draftBody({ issueNumber: 7, branch: "office/x", commits, taskSummary: "Summary" });
    expect(body).toContain("Summary");
    expect(body).toContain("- abc1234 Fix login redirect");
    expect(body).toContain("Closes #7");
    expect(body).toContain("Opened from Regulus Office");
    expect(draftBody({ branch: "office/x", commits })).not.toContain("Closes");
  });
});

describe("openPullRequest", () => {
  test("pushes with the project credential and creates the PR with a drafted title and body", async () => {
    const { f, agentId, ws, requests } = await agentWithWork(() => pullJson(42, true), {
      taskTitle: "Fix the login redirect",
      issueNumber: 7,
    });
    await commitIn(ws.workdir, "login.ts", "Fix login redirect");
    await commitIn(ws.workdir, "login.test.ts", "Add login test");

    const pr = await f.worktrees.openPullRequest(agentId, { draft: true, actorUserId: f.owner.id });
    expect(pr).toEqual({
      number: 42,
      url: "https://github.com/octo/hello/pull/42",
      draft: true,
      created: true,
      branch: "office/login-fix",
    });

    // Pushed to the remote from the owner's own clone (#114); the mirror never had the branch.
    const local = await git(["-C", f.cloneOf(), "rev-parse", "refs/heads/office/login-fix"]);
    const inMirror = git(["-C", f.repo.workdir, "rev-parse", "refs/heads/office/login-fix"]);
    await expect(inMirror).rejects.toThrow();
    expect(await git(["-C", f.bare, "rev-parse", "office/login-fix"])).toBe(local);

    // Request shape and auth: token only in the Authorization header.
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req?.method).toBe("POST");
    expect(req?.path).toBe("/repos/octo/hello/pulls");
    expect(req?.headers.get("authorization")).toBe(`Bearer ${FAKE_PAT}`);
    expect(req?.headers.get("accept")).toBe("application/vnd.github+json");
    expect(req?.headers.get("x-github-api-version")).toBe("2022-11-28");
    const body = req?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      title: "Fix the login redirect",
      head: "office/login-fix",
      base: "trunk",
      draft: true,
    });
    expect(String(body.body)).toContain("Fix login redirect");
    expect(String(body.body)).toContain("Add login test");
    expect(String(body.body)).toContain("Closes #7");

    const row = f.db.select().from(agents).where(eq(agents.id, agentId)).get();
    expect(row?.prNumber).toBe(42);
    const audit = f.db.select().from(auditLog).where(eq(auditLog.targetId, agentId)).all();
    expect(audit.map((a) => a.action)).toEqual(["agent.pull_request"]);
    expect(audit[0]?.metaJson).not.toContain(FAKE_PAT);

    // No trace of the token in argv or on disk.
    expect(f.gitCalls.flat().join(" ")).not.toContain(FAKE_PAT);
    expect(await filesContaining(join(f.repo.workdir, ".git"), FAKE_PAT)).toEqual([]);
    expect(await filesContaining(join(f.cloneOf(), ".git"), FAKE_PAT)).toEqual([]);
  });

  test("an existing PR for the branch is returned instead of failing", async () => {
    const { f, agentId, ws, requests } = await agentWithWork((req) =>
      req.method === "POST"
        ? Response.json(
            {
              message: "Validation Failed",
              errors: [{ message: "A pull request already exists for octo:office/login-fix." }],
            },
            { status: 422 },
          )
        : Response.json([
            { number: 5, html_url: "https://github.com/octo/hello/pull/5", draft: false },
          ]),
    );
    await commitIn(ws.workdir, "a.ts", "Work");
    const pr = await f.worktrees.openPullRequest(agentId);
    expect(pr).toMatchObject({ number: 5, created: false });
    expect(requests.map((r) => r.method)).toEqual(["POST", "GET"]);
    const query = new URL(`http://x${requests[1]?.path}`).searchParams;
    expect(query.get("head")).toBe("octo:office/login-fix");
    expect(query.get("state")).toBe("open");
    expect(requests[1]?.headers.get("authorization")).toBe(`Bearer ${FAKE_PAT}`);
    expect(f.db.select().from(agents).where(eq(agents.id, agentId)).get()?.prNumber).toBe(5);
  });

  test("uncommitted changes are an error that lists them; nothing is pushed", async () => {
    const { f, agentId, ws, requests } = await agentWithWork(() => pullJson(1));
    await commitIn(ws.workdir, "a.ts", "Work");
    await writeFile(join(ws.workdir, "README.md"), "edited\n");
    await writeFile(join(ws.workdir, "notes.txt"), "new\n");
    const err = await errorOf(f.worktrees.openPullRequest(agentId));
    expect(err.code).toBe("uncommitted_changes");
    expect(err.status).toBe(409);
    expect([...err.files].sort()).toEqual(["README.md", "notes.txt"]);
    expect(requests).toHaveLength(0);
    expect(await git(["-C", f.bare, "branch", "--list", "office/login-fix"])).toBe("");
  });

  test("a branch without commits, or a repo without a token, cannot open a PR", async () => {
    const empty = await agentWithWork(() => pullJson(1));
    expect((await errorOf(empty.f.worktrees.openPullRequest(empty.agentId))).code).toBe(
      "no_commits",
    );

    const tokenless = await agentWithWork(() => pullJson(1), { token: false });
    await commitIn(tokenless.ws.workdir, "a.ts", "Work");
    expect((await errorOf(tokenless.f.worktrees.openPullRequest(tokenless.agentId))).code).toBe(
      "no_repo_credential",
    );
    expect(tokenless.requests).toHaveLength(0);
  });

  test("GitHub errors are reported without the token", async () => {
    const { f, agentId, ws } = await agentWithWork(() =>
      Response.json({ message: `Bad credentials ${FAKE_PAT}` }, { status: 401 }),
    );
    await commitIn(ws.workdir, "a.ts", "Work");
    const err = await errorOf(f.worktrees.openPullRequest(agentId));
    expect(err.code).toBe("github_error");
    expect(err.message).toContain("Bad credentials");
    expect(err.message).not.toContain(FAKE_PAT);
  });

  test("unknown agents and agents without a worktree", async () => {
    const f = await setupFloor(root);
    expect((await errorOf(f.worktrees.openPullRequest("nope"))).code).toBe("agent_not_found");
    const id = f.addAgent("bare-agent");
    expect((await errorOf(f.worktrees.openPullRequest(id))).code).toBe("no_worktree");
  });
});
