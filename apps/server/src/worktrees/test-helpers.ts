/**
 * Fixtures for worktree tests: a floor cloned from a local bare repo (no
 * network), agent rows, commits pushed to the remote from elsewhere, and a
 * fake GitHub REST server on port 0 that records every request.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agents } from "../db/schema/index.ts";
import { createFloors } from "../floors/index.ts";
import { FAKE_PAT, makeBareRepo, testDb } from "../floors/test-helpers.ts";
import { type GitRunner, gitBaseEnv, runGit } from "../github/git.ts";
import { createLogger } from "../logging.ts";
import { createWorktrees } from "./index.ts";

export { FAKE_PAT };
export const logger = createLogger({ level: "silent" });

/** Plain git for fixtures (not the office's hardened runner). */
export async function git(args: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(
    ["git", "-c", "user.name=Agent", "-c", "user.email=agent@example.com", ...args],
    { cwd, env: gitBaseEnv(), stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${err}`);
  return out.trim();
}

/** Commit a file on the remote's `branch` from a scratch clone (someone else pushing). */
export async function pushToRemote(bare: string, branch: string, file: string, message: string) {
  const work = await mkdtemp(join(tmpdir(), "office-upstream-"));
  await git(["clone", "--quiet", "--branch", branch, bare, work]);
  await Bun.write(join(work, file), `${message}\n`);
  await git(["add", file], work);
  await git(["commit", "--quiet", "-m", message], work);
  await git(["push", "--quiet", "origin", branch], work);
  return git(["rev-parse", "HEAD"], work);
}

/** Commit inside an agent worktree, as the agent would. */
export async function commitIn(worktree: string, file: string, message: string) {
  await Bun.write(join(worktree, file), `${message}\n`);
  await git(["-c", `safe.directory=${worktree}`, "add", file], worktree);
  await git(["-c", `safe.directory=${worktree}`, "commit", "--quiet", "-m", message], worktree);
}

/** Every file under `dir` whose content contains `needle` (to prove a token never lands on disk). */
export async function filesContaining(dir: string, needle: string): Promise<string[]> {
  const hits: string[] = [];
  for (const entry of await readdir(dir, { recursive: true })) {
    const path = join(dir, entry);
    if (!(await stat(path)).isFile()) continue;
    if ((await readFile(path)).includes(needle)) hits.push(path);
  }
  return hits;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

/** Fake GitHub REST: `respond` decides each reply; every request is recorded. */
export function fakeGitHub(respond: (req: RecordedRequest) => Response) {
  const requests: RecordedRequest[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      const text = await request.text();
      const rec: RecordedRequest = {
        method: request.method,
        path: `${url.pathname}${url.search}`,
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      };
      requests.push(rec);
      return respond(rec);
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, requests, stop: () => server.stop(true) };
}

/**
 * A ready floor `wt-floor` on `octo/hello` (default branch `trunk`, with a
 * stored PAT unless `token: false`), an owner, and the worktrees service.
 */
export async function setupFloor(
  root: string,
  options: { token?: boolean; apiBase?: string; git?: GitRunner } = {},
) {
  const id = randomUUID().slice(0, 8);
  const remotes = join(root, `remotes-${id}`);
  const remoteBase = await makeBareRepo(remotes, "octo", "hello", "trunk");
  const bare = join(remotes, "octo", "hello.git");
  const { db, addUser } = testDb();
  const owner = addUser("Olga", "owner");
  const floors = createFloors({
    db,
    logger,
    config: { projectsDir: join(root, `projects-${id}`), githubRemoteBase: remoteBase },
    keyring: { current: 1, keys: { 1: randomBytes(32) } },
  });
  const created = floors.service.create(owner, {
    name: "WT Floor",
    tier: "small",
    repos: [{ repo: "octo/hello", ...(options.token === false ? {} : { token: FAKE_PAT }) }],
  });
  await created.cloned;
  const floorId = created.floor.floorId;
  const repo = floors.repos.listFloorRepos(floorId)[0];
  if (!repo || repo.cloneStatus !== "ready") throw new Error("fixture clone failed");
  const worktreesDir = join(root, `worktrees-${id}`);
  const mounts: string[] = [];
  const gitCalls: string[][] = [];
  const baseGit = options.git ?? runGit;
  const makeWorktrees = () =>
    createWorktrees({
      db,
      logger,
      config: { worktreesDir, githubApiBase: options.apiBase ?? "http://127.0.0.1:9" },
      repos: floors.repos,
      runner: {
        async mountProject(_user, ref) {
          mounts.push(ref.workdir);
          return { workdir: ref.workdir };
        },
      },
      git: (args, opts) => {
        gitCalls.push([...args]);
        return baseGit(args, opts);
      },
    });
  const worktrees = makeWorktrees();

  const addAgent = (
    agentId: string,
    fields: { taskTitle?: string; issueNumber?: number; taskSummary?: string } = {},
  ) => {
    db.insert(agents)
      .values({
        id: agentId,
        floorId,
        repoId: repo.repoId,
        deskSeatId: `desk-${agentId}`,
        ownerUserId: owner.id,
        provider: "claude-code",
        model: "test",
        profileId: "office:claude-code",
        workdir: repo.workdir,
        taskTitle: fields.taskTitle ?? "",
        taskSummary: fields.taskSummary ?? null,
        issueNumber: fields.issueNumber ?? null,
      })
      .run();
    return agentId;
  };

  return {
    db,
    owner,
    floorId,
    repo,
    bare,
    worktreesDir,
    worktrees,
    /** A second service over the same database, as after an office restart. */
    restart: makeWorktrees,
    mounts,
    gitCalls,
    addAgent,
  };
}
