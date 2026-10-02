/**
 * A meeting end to end over the real pieces (#50): the AgentManager spawning
 * FakeAdapter henchmen in tmux (LocalTmuxRunner), a real shared worktree of
 * the starter's own clone (local bare remote over file://), the one-click PR
 * path against a fake GitHub, and the office's own meeting ports. The fake
 * henchmen write their notes into `.meeting/` and the closer commits, as a
 * real henchman would. Skipped without tmux.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FakeAdapter } from "@regulus/agent-adapters";
import { type AgentEvent, StartMeetingRequest } from "@regulus/protocol";
import { isNotNull } from "drizzle-orm";
import { FAKE_AGENT, makeManager } from "../agents/manager/test-helpers.ts";
import { agents, desks } from "../db/schema/index.ts";
import { createPullRequestClient } from "../github/pulls.ts";
import { createLogger } from "../logging.ts";
import { hasTmux, LocalTmuxRunner } from "../runners/testing/local-tmux-runner.ts";
import { fakeGitHub, git, setupOperation } from "../worktrees/test-helpers.ts";
import { createMeetings } from "./index.ts";
import { waitFor } from "./test-helpers.ts";

let root: string;
let runner: LocalTmuxRunner | undefined;
let github: ReturnType<typeof fakeGitHub> | undefined;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "office-meeting-"));
});
afterEach(async () => {
  github?.stop();
  github = undefined;
  await runner?.dispose();
  runner = undefined;
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const IDENTITY = {
  GIT_AUTHOR_NAME: "Henchman",
  GIT_AUTHOR_EMAIL: "h@example.com",
  GIT_COMMITTER_NAME: "Henchman",
  GIT_COMMITTER_EMAIL: "h@example.com",
};

describe.skipIf(!hasTmux())("meeting room end to end", () => {
  test("a debate in a shared worktree ends in a draft PR; notes stay out of git", async () => {
    github = fakeGitHub((req) =>
      req.path.endsWith("/pulls") && req.method === "POST"
        ? Response.json(
            { number: 77, html_url: "https://github.com/octo/hello/pull/77", draft: true },
            { status: 201 },
          )
        : new Response("not found", { status: 404 }),
    );
    const f = await setupOperation(root, { apiBase: github.url });
    for (const seatId of ["d9s1", "d9s2"]) {
      f.db.insert(desks).values({ operationId: f.operationId, seatId }).run();
    }
    runner = await LocalTmuxRunner.create();
    let meetingId = "";
    const workdirs = new Set<string>();
    let meetings: ReturnType<typeof createMeetings> | undefined;

    // What the henchman "does" with a turn: its notes, and on the closing turn a commit.
    const onPrompt = (text: string, now: number): AgentEvent[] => {
      const workdir = meetings?.store.get(meetingId)?.workdir ?? "";
      workdirs.add(workdir);
      const file = /`(\.meeting\/turns\/[^`]+)`/.exec(text)?.[1] ?? "missing.md";
      const who = /You are (\w+)/.exec(text)?.[1] ?? "?";
      mkdirSync(dirname(join(workdir, file)), { recursive: true });
      writeFileSync(join(workdir, file), `${who} says: use an LRU cache\n`);
      if (text.includes("commit the change")) {
        writeFileSync(join(workdir, "cache.ts"), "export const cache = new Map();\n");
        Bun.spawnSync(["git", "add", "cache.ts"], { cwd: workdir });
        Bun.spawnSync(["git", "commit", "-q", "-m", "Add the cache"], {
          cwd: workdir,
          env: { ...process.env, ...IDENTITY },
        });
      }
      return [
        { kind: "status", ts: now, status: "working" },
        {
          kind: "usage",
          ts: now,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          source: "inband",
        },
        { kind: "status", ts: now, status: "idle" },
      ];
    };
    const adapter = new FakeAdapter({
      command: ["sh", FAKE_AGENT],
      script: [{ kind: "status", ts: 1, status: "idle" }],
      onPrompt,
    });
    const broadcasts: string[] = [];
    let observer: ReturnType<typeof createMeetings>["observer"] | undefined;
    let usage: ReturnType<typeof createMeetings>["usage"] | undefined;
    const { manager } = makeManager(f.db, runner, [adapter], {
      workspaces: f.worktrees.workspaces,
      clones: f.worktrees.workspaces,
      worktreeTools: {
        status: (id) => f.worktrees.workspaces.status(id),
        openPullRequest: (id, opts) => f.worktrees.openPullRequest(id, opts),
      },
      observer: {
        statusChanged: (view, previous) => observer?.statusChanged(view, previous),
        pullRequestOpened: () => {},
      },
      usage: { agentEvent: (id, event) => usage?.agentEvent(id, event) },
    });
    meetings = createMeetings({
      db: f.db,
      logger: createLogger({ level: "silent" }),
      rooms: {
        broadcast: (_op, type) => {
          broadcasts.push(type);
          return true;
        },
      },
      office: {
        repos: f.repos,
        worktrees: f.worktrees.workspaces,
        runner,
        github: createPullRequestClient({ apiBase: github.url }),
      },
      pollMs: 50,
    });
    observer = meetings.observer;
    usage = meetings.usage;
    meetings.bind(manager);

    const input = StartMeetingRequest.parse({
      operationId: f.operationId,
      repoId: f.repo.repoId,
      pattern: "debate",
      topic: "Add a cache for the board sync",
      members: [
        { provider: "custom", model: "fake-1" },
        { provider: "custom", model: "fake-2" },
      ],
      rounds: 1,
      tokenBudget: 50_000,
      turnTimeoutMinutes: 1,
    });
    const owner = { id: f.owner.id, role: f.owner.role };
    meetingId = meetings.service.start(owner, input).id;
    const row = await waitFor(
      () => {
        const r = meetings?.store.get(meetingId);
        return r?.finishedAt ? r : undefined;
      },
      "the meeting to finish",
      20_000,
    );
    expect(row.reason).toBe("opened draft pull request #77");
    expect(row.status).toBe("done");
    expect(row.tokensUsed).toBe(3 * 1200);
    expect(row.outputUrl).toBe("https://github.com/octo/hello/pull/77");

    // One worktree for everyone, in the starter's own area, on the meeting branch.
    expect(workdirs.size).toBe(1);
    const [workdir] = [...workdirs];
    expect(workdir?.startsWith(f.areaOf(f.owner.id))).toBe(true);
    expect(row.branch).toBe("office/meeting-add-a-cache-for-the-board-sync");

    // The transcript holds every turn's notes.
    const turns = meetings.store.turns(meetingId);
    expect(turns.map((t) => t.text.trim())).toEqual([
      "Proposer says: use an LRU cache",
      "Challenger says: use an LRU cache",
      "Proposer says: use an LRU cache",
    ]);

    // The branch went to the remote with the closer's commit and without the notes.
    const pr = github.requests.find((r) => r.method === "POST");
    expect(pr?.body).toMatchObject({ head: row.branch, base: "trunk", draft: true });
    const tree = await git(["ls-tree", "-r", "--name-only", row.branch ?? ""], f.bare);
    expect(tree.split("\n").filter(Boolean).sort()).toEqual(["README.md", "cache.ts"]);

    // Adjourned: every henchman went home, the shared worktree is gone, the branch stays.
    await waitFor(() => meetings?.store.get(meetingId)?.workdir === null, "the worktree removal");
    expect(existsSync(workdir ?? "")).toBe(false);
    expect(f.db.select().from(desks).where(isNotNull(desks.agentId)).all()).toEqual([]);
    const local = await git(["branch", "--list", row.branch ?? ""], f.cloneOf(f.owner.id));
    expect(local.trim()).toContain(row.branch ?? "");
    expect(broadcasts.every((t) => t === "meeting.changed")).toBe(true);
    meetings.close();
    await manager.close();
    // The members were the starter's own henchmen, working in the shared worktree.
    const rows = f.db.select().from(agents).all();
    expect(rows.map((r) => [r.ownerUserId, r.workdir])).toEqual([
      [f.owner.id, workdir ?? ""],
      [f.owner.id, workdir ?? ""],
    ]);
  }, 30_000);
});
