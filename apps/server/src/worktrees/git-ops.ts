/**
 * Git plumbing for office-run commands on humans' clones, agent worktrees and
 * floor mirrors.
 *
 * A human's clone (#114) is shared with that human's agent worktrees, and
 * their runner can write to its `.git`. So before the office runs git there
 * with the project credential,
 * it (1) never runs repo hooks or fsmonitor, (2) refuses a config that could
 * execute commands or redirect the remote (`url.*.insteadOf`, `filter.*`,
 * `include*`, `credential.*`, ...), (3) checks that `origin` is still the
 * floor repo, and (4) sends the token only to that remote URL.
 * Checkouts may be owned by a runner account, so each command carries
 * `-c safe.directory=<path>` instead of touching any global config.
 */
import { readdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { GitResult, GitRunner } from "../github/git.ts";
import { CLONES_DIR } from "../runners/layout.ts";
import { WorkspaceError } from "./types.ts";

/** Branch prefix for agent work. Only these branches are ever deleted by the office. */
export const BRANCH_PREFIX = "office/";

const HARDENING = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];

/** Config keys (lowercased) that could run code or reroute traffic when the office runs git. */
const UNSAFE_KEYS: readonly RegExp[] = [
  /^include(if)?\./,
  /^url\./,
  /^filter\./,
  /^credential\./,
  /^http\./,
  /^protocol\./,
  /^core\.(hookspath|fsmonitor|sshcommand|gitproxy|askpass|alternaterefscommand|worktree)$/,
  /^remote\.[^.]+\.(uploadpack|receivepack|proxy|vcs|pushurl)$/,
];
/** The only `remote.origin.*` keys accepted; `url` must also equal the floor repo's remote. */
const ORIGIN_KEYS = /^remote\.origin\.(url|fetch|tagopt|prune)$/;

export interface GitContext {
  git: GitRunner;
  /** Directories git may treat as safe despite their owner. */
  safe: readonly string[];
}

/** Run hardened git; never throws on a non-zero exit. */
export function gitIn(
  ctx: GitContext,
  args: readonly string[],
  options: { cwd: string; token?: string | null; tokenScope?: string; timeoutMs?: number },
): Promise<GitResult> {
  const safe = ctx.safe.flatMap((p) => ["-c", `safe.directory=${p}`]);
  return ctx.git([...safe, ...HARDENING, ...args], options);
}

/** `office/<slug>`-safe: lowercase letters, digits and single hyphens, at most 48 chars. */
export function branchSlug(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug || "agent";
}

const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Agent ids name worktree directories; refuse anything that could leave the human's area. */
export function checkAgentDirName(agentId: string): string {
  if (!AGENT_ID.test(agentId) || agentId === CLONES_DIR) {
    throw new WorkspaceError("agent_not_found", "invalid agent id");
  }
  return agentId;
}

/** Parse `git status --porcelain=v1 -z` into paths. */
export function parsePorcelain(out: string): string[] {
  const files: string[] = [];
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? "";
    if (entry.length < 4) continue;
    files.push(entry.slice(3));
    // Renames and copies carry the original path as the next NUL field.
    if (entry[0] === "R" || entry[0] === "C") i++;
  }
  return files;
}

async function configKeys(ctx: GitContext, file: string) {
  // `--file` does not follow include directives, so nothing outside `file` is read.
  const res = await ctx.git(["config", "--file", file, "--null", "--list"], { cwd: "/" });
  if (res.code !== 0) return [] as [string, string][];
  return res.stdout
    .split("\0")
    .filter(Boolean)
    .map((entry): [string, string] => {
      const nl = entry.indexOf("\n");
      return nl < 0
        ? [entry.toLowerCase(), ""]
        : [entry.slice(0, nl).toLowerCase(), entry.slice(nl + 1)];
    });
}

async function exists(path: string): Promise<boolean> {
  try {
    await realpath(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Refuse to run credentialed git in a clone whose shared config was altered
 * to execute commands or send traffic elsewhere. `adminDir` adds that
 * worktree's `config.worktree`.
 */
export async function assertSafeClone(
  ctx: GitContext,
  clone: string,
  remoteUrl: string,
  adminDir?: string,
): Promise<void> {
  const files = [join(clone, ".git", "config")];
  if (adminDir && (await exists(join(adminDir, "config.worktree")))) {
    files.push(join(adminDir, "config.worktree"));
  }
  const bad = new Set<string>();
  for (const file of files) {
    for (const [key, value] of await configKeys(ctx, file)) {
      if (key.startsWith("remote.origin.")) {
        if (!ORIGIN_KEYS.test(key) || (key === "remote.origin.url" && value !== remoteUrl)) {
          bad.add(key);
        }
      } else if (UNSAFE_KEYS.some((re) => re.test(key))) bad.add(key);
    }
  }
  if (bad.size > 0) {
    throw new WorkspaceError(
      "worktree_failed",
      `refusing to run git: the clone's config has unsafe entries (${[...bad].sort().join(", ")}); an admin must review ${clone}/.git/config`,
    );
  }
}

/**
 * The `.git/worktrees/<name>` admin dir whose `gitdir` points at `worktree`,
 * found by reading files (the worktree's own `.git` file is agent-writable and
 * not trusted). Also checks that its `commondir` leads back to the clone.
 */
export async function findAdminDir(clone: string, worktree: string): Promise<string | null> {
  const base = join(clone, ".git", "worktrees");
  let names: string[];
  try {
    names = await readdir(base);
  } catch {
    return null;
  }
  const commonReal = await realpath(join(clone, ".git"));
  for (const name of names) {
    const dir = join(base, name);
    try {
      const gitdir = (await readFile(join(dir, "gitdir"), "utf8")).trim();
      if (gitdir !== join(worktree, ".git")) continue;
      const commondir = (await readFile(join(dir, "commondir"), "utf8")).trim();
      if ((await realpath(join(dir, commondir))) !== commonReal) return null;
      return dir;
    } catch {}
  }
  return null;
}

/** Args that pin git to the trusted admin dir and work tree. */
export function worktreeArgs(adminDir: string, worktree: string): string[] {
  return [`--git-dir=${adminDir}`, `--work-tree=${worktree}`];
}

/**
 * Env for the agent's own git inside its worktree (for #26 to merge into the
 * spawn env): the checkout is owned by the office account, so git in the
 * runner would otherwise refuse it as "dubious ownership". Carries no secret.
 */
export function agentGitEnv(worktree: string, clone: string): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: worktree,
    GIT_CONFIG_KEY_1: "safe.directory",
    GIT_CONFIG_VALUE_1: clone,
  };
}

/** Serialises git work per key (a clone path: worktree add/remove and pushes share its `.git`). */
export class KeyedMutex {
  readonly #tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.#tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.#tails.set(key, tail);
    void tail.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
    return next;
  }
}
