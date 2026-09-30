/**
 * The throwaway checkout a workflow robot reads (#155).
 *
 * `<worktrees>/<floor>/<rid of the workflow identity>/wf-<runId>`: a fresh
 * `git init` in the workflow identity's own area on the floor, so the runner
 * mounts nothing of any human (#114) and the robot never sees a human's clone,
 * the office mirror or a credential. The office fetches the PR head (and the
 * base, for the diff) with the App's installation token, which goes only to
 * the repo's remote URL for that one command and is never stored: the
 * checkout has no remote at all, so there is nothing a robot could push to.
 * The office mirror seeds objects first when it exists (local, no token).
 *
 * Git hardening as for humans' clones (worktrees/git-ops.ts): no hooks, no
 * fsmonitor, and diffs without external diff drivers or textconv, since the
 * PR controls `.gitattributes`.
 *
 * Unless the workflow may run the PR's code, the tree is made read-only
 * before the robot starts. The directory is removed after the run.
 */
import { chmod, lstat, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { type GitRunner, summarizeGitError } from "../github/git.ts";
import { humanAreaDir } from "../runners/layout.ts";
import { ensurePrivateDir } from "../worktrees/clones.ts";
import { type GitContext, gitIn } from "../worktrees/git-ops.ts";
import { WorkflowRefusal } from "./github-app.ts";

/** The runner identity every workflow robot runs as: no human's HOME, logins or areas. */
export const WORKFLOW_RUNNER_USER = "officeworkflows";

export interface CheckoutRequest {
  worktreesDir: string;
  floorSlug: string;
  runId: string;
  /** Credential-free `https://github.com/o/r.git`. */
  remoteUrl: string;
  /** The office-only mirror of the repo, used to seed objects when present. */
  mirror: string | null;
  token: string;
  /** e.g. `refs/pull/12/head`, `refs/heads/main`. */
  headRef: string;
  /** Base branch ref for the diff (PRs); none for other targets. */
  baseRef: string | null;
}

export interface Checkout {
  dir: string;
  headSha: string;
  /** Unified diff base...head (capped by the git runner), or null without a base. */
  diff: string | null;
  files: string[] | null;
}

const HEAD = "refs/office/head";
const BASE = "refs/office/base";
const REF = /^refs\/(heads|pull|tags)\/[A-Za-z0-9._/-]{1,250}$/;

export function checkoutDir(req: Pick<CheckoutRequest, "worktreesDir" | "floorSlug" | "runId">) {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(req.runId)) throw new Error("invalid run id");
  return join(
    humanAreaDir(req.worktreesDir, req.floorSlug, WORKFLOW_RUNNER_USER),
    `wf-${req.runId}`,
  );
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function prepareCheckout(git: GitRunner, req: CheckoutRequest): Promise<Checkout> {
  for (const ref of [req.headRef, req.baseRef]) {
    if (ref !== null && (!REF.test(ref) || ref.includes(".."))) {
      throw new WorkflowRefusal("bad_ref", "the branch name cannot be fetched safely");
    }
  }
  const dir = checkoutDir(req);
  const area = join(dir, "..");
  await ensurePrivateDir(area);
  await rm(dir, { recursive: true, force: true });
  const ctx: GitContext = { git, safe: [dir, ...(req.mirror ? [req.mirror] : [])] };
  const step = async (args: string[], opts: { token?: string; scope?: string } = {}) => {
    const res = await gitIn(ctx, args, { cwd: dir, token: opts.token, tokenScope: opts.scope });
    if (res.code !== 0) {
      throw new Error(`git ${args[0]} failed: ${summarizeGitError(res.stderr, [req.token])}`);
    }
    return res.stdout;
  };
  const init = await gitIn(ctx, ["init", "--quiet", dir], { cwd: area });
  if (init.code !== 0) throw new Error("git init failed");
  if (req.mirror && (await exists(join(req.mirror, ".git")))) {
    // Best effort: the mirror's objects, so the network fetch below is small.
    await gitIn(
      ctx,
      ["fetch", "--quiet", "--no-tags", req.mirror, "+refs/remotes/origin/*:refs/seed/*"],
      {
        cwd: dir,
      },
    );
  }
  const specs = [`+${req.headRef}:${HEAD}`, ...(req.baseRef ? [`+${req.baseRef}:${BASE}`] : [])];
  await step(["fetch", "--quiet", "--no-tags", req.remoteUrl, ...specs], {
    token: req.token,
    scope: req.remoteUrl,
  });
  const headSha = (await step(["rev-parse", "--verify", `${HEAD}^{commit}`])).trim();
  await step(["-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", headSha]);
  let diff: string | null = null;
  let files: string[] | null = null;
  if (req.baseRef) {
    const range = `${BASE}...${HEAD}`;
    const flags = ["--no-color", "--no-ext-diff", "--no-textconv"];
    diff = await step(["diff", ...flags, range]);
    files = (await step(["diff", ...flags, "--name-only", range])).split("\n").filter(Boolean);
  }
  // The base ref only served the diff. There is no remote: nothing to push to.
  await gitIn(ctx, ["update-ref", "-d", BASE], { cwd: dir });
  return { dir, headSha, diff, files };
}

/** Take write permission away from everything in the checkout (defence in depth). */
export async function makeReadOnly(dir: string): Promise<void> {
  // lstat: a PR's symlink must never make the office chmod something outside the checkout.
  const walk = async (p: string, depth: number): Promise<void> => {
    const s = await lstat(p);
    if (s.isDirectory()) {
      if (depth < 64) {
        for (const name of await readdir(p)) await walk(join(p, name), depth + 1);
      }
      await chmod(p, s.mode & 0o7555);
    } else if (s.isFile()) {
      await chmod(p, s.mode & 0o7555);
    }
  };
  await walk(dir, 0);
}

export async function removeCheckout(dir: string): Promise<void> {
  const walk = async (p: string, depth: number): Promise<void> => {
    let s: Awaited<ReturnType<typeof lstat>>;
    try {
      s = await lstat(p);
    } catch {
      return;
    }
    if (!s.isDirectory()) return;
    await chmod(p, (s.mode | 0o700) & 0o7777);
    if (depth < 64) for (const name of await readdir(p)) await walk(join(p, name), depth + 1);
  };
  await walk(dir, 0).catch(() => {});
  await rm(dir, { recursive: true, force: true });
}
