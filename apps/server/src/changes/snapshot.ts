/**
 * One look at a henchman's worktree (#38): `git status` for what is not
 * committed yet, and the diff of the working tree against the merge-base
 * with `origin/<default>` for everything the branch changes. Renames are
 * shown as a deletion plus an addition, as `status --no-renames` lists them,
 * so every entry maps to exactly one path that commit and discard act on.
 *
 * Uncommitted files carry `sig`, an lstat fingerprint (size, inode, mtime,
 * ctime in ns), which commit and discard compare to catch a henchman editing
 * a file after its human looked at it.
 */
import { CHANGES_MAX_FILES, type ChangedFile, type ChangesSnapshot } from "@regulus/protocol";
import { type CmdResult, type HenchmanShell, text } from "./henchman-shell.ts";
import { parseRawNumstat, parseStat, parseStatusV2, STAT_FORMAT, type StatInfo } from "./parse.ts";
import { ChangesHttpError } from "./paths.ts";

/** A snapshot plus what the server keeps to itself. */
export interface WorktreeLook {
  snapshot: Omit<ChangesSnapshot, "canWrite" | "agentId">;
  /** The commit diffs are taken against (merge-base, else HEAD, else null for an unborn branch). */
  baseSha: string | null;
  byPath: Map<string, ChangedFile & { regular: boolean }>;
}

const STAT_CHUNK = 400;

/** Map a failed git call to an HTTP error (the index lock is the henchman's own git at work). */
export function gitFailure(res: CmdResult, what: string): ChangesHttpError {
  const detail = res.stderr.trim().split("\n").slice(-3).join(" ").slice(0, 400);
  if (/index\.lock|Unable to create .*\.lock/i.test(res.stderr)) {
    return new ChangesHttpError(
      409,
      "git_busy",
      "the henchman's git is busy (index lock held); try again in a moment",
    );
  }
  if (res.timedOut) return new ChangesHttpError(504, "git_failed", `${what} timed out`);
  if (/not a git repository|cannot change to|No such file or directory/i.test(res.stderr)) {
    return new ChangesHttpError(409, "unavailable", `the henchman's worktree is not reachable`);
  }
  return new ChangesHttpError(500, "git_failed", `${what} failed${detail ? `: ${detail}` : ""}`);
}

async function statAll(shell: HenchmanShell, paths: string[]): Promise<Map<string, StatInfo>> {
  const all = new Map<string, StatInfo>();
  for (let i = 0; i < paths.length; i += STAT_CHUNK) {
    const chunk = paths.slice(i, i + STAT_CHUNK);
    // Exit 1 when some path vanished in between: the others are still printed.
    const res = await shell.run(["stat", `--printf=${STAT_FORMAT}`, "--", ...chunk]);
    for (const [p, info] of parseStat(text(res.stdout))) all.set(p, info);
  }
  return all;
}

export async function lookAtWorktree(
  shell: HenchmanShell,
  baseRef: string,
  now: () => number = Date.now,
): Promise<WorktreeLook> {
  const statusRes = await shell.git([
    "status",
    "--porcelain=v2",
    "-z",
    "--branch",
    "--untracked-files=all",
    "--no-renames",
  ]);
  if (statusRes.code !== 0) throw gitFailure(statusRes, "git status");
  if (statusRes.truncated) {
    throw new ChangesHttpError(413, "too_large", "too many changed files to list");
  }
  const status = parseStatusV2(text(statusRes.stdout));

  let baseSha: string | null = null;
  let ahead = 0;
  if (status.head) {
    const mb = await shell.git(["merge-base", "HEAD", `refs/remotes/${baseRef}`]);
    baseSha = mb.code === 0 ? text(mb.stdout).trim() || null : null;
    if (baseSha) {
      const count = await shell.git(["rev-list", "--count", `${baseSha}..HEAD`]);
      ahead = count.code === 0 ? Number(text(count.stdout).trim()) || 0 : 0;
    }
  }
  const diffBase = baseSha ?? status.head;

  const files = new Map<string, ChangedFile & { regular: boolean }>();
  if (diffBase) {
    const diff = await shell.git([
      "diff",
      "--raw",
      "--numstat",
      "-z",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      diffBase,
      "--",
    ]);
    if (diff.code !== 0) throw gitFailure(diff, "git diff");
    for (const e of parseRawNumstat(text(diff.stdout))) {
      files.set(e.path, { ...e, uncommitted: false, sig: null, regular: !e.symlink });
    }
  }
  for (const s of status.entries) {
    const known = files.get(s.path);
    if (known) {
      known.uncommitted = true;
      if (s.kind === "conflicted") known.kind = "conflicted";
    } else {
      // Uncommitted but equal to the base (e.g. a committed change undone), or untracked.
      files.set(s.path, {
        path: s.path,
        kind: s.kind,
        uncommitted: true,
        additions: null,
        deletions: null,
        binary: false,
        symlink: false,
        sig: null,
        regular: true,
      });
    }
  }

  const sorted = [...files.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  const shown = sorted.slice(0, CHANGES_MAX_FILES);
  const present = shown.filter((f) => f.uncommitted && f.kind !== "deleted").map((f) => f.path);
  const stats = await statAll(shell, present);
  for (const f of shown) {
    const st = f.uncommitted ? stats.get(f.path) : undefined;
    if (!st) continue;
    f.sig = st.sig;
    f.symlink = st.symlink;
    f.regular = st.regular;
  }
  const byPath = new Map(shown.map((f) => [f.path, f]));
  return {
    baseSha: diffBase,
    byPath,
    snapshot: {
      branch: status.branch,
      head: status.head,
      base: { ref: baseRef, sha: baseSha },
      ahead,
      files: shown.map(({ regular: _r, ...f }) => f),
      truncated: sorted.length > shown.length,
      polledAt: now(),
    },
  };
}
