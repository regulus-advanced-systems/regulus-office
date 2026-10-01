/**
 * The owner's write actions in the changes window (#38): commit chosen files
 * with a message, and discard one file's uncommitted changes. The caller
 * (service.ts) has checked D12 and holds the robot's lock.
 *
 * Both take a fresh look at the worktree first and refuse with
 * `changed_since_viewed` when a file's fingerprint differs from what the
 * human saw, and with `git_busy` when the robot's own git holds the index
 * lock. Nothing is forced: no lock is removed, no hook runs, other staged
 * work of the robot stays staged (`git commit --only -- <paths>`).
 */
import type { CommitChangesRequest, FileSig } from "@regulus/protocol";
import { ChangesHttpError, checkRepoPath } from "./paths.ts";
import { type RobotShell, text } from "./robot-shell.ts";
import { gitFailure, type WorktreeLook } from "./snapshot.ts";

export interface CommitIdentity {
  name: string;
  email: string;
}

/** Every file must be an uncommitted change whose fingerprint is unchanged. */
export function checkViewed(look: WorktreeLook, files: readonly FileSig[]): void {
  const stale: string[] = [];
  for (const f of files) {
    checkRepoPath(f.path);
    const entry = look.byPath.get(f.path);
    if (!entry?.uncommitted) {
      throw new ChangesHttpError(
        409,
        "not_changed",
        `${f.path} has no uncommitted changes (any more)`,
        [f.path],
      );
    }
    if (entry.sig !== f.sig) stale.push(f.path);
  }
  if (stale.length > 0) {
    throw new ChangesHttpError(
      409,
      "changed_since_viewed",
      "the henchman changed these files after you looked; review them again",
      stale,
    );
  }
}

/** `-c user.*` only when the owner has no git identity of their own in the runner. */
async function identityArgs(shell: RobotShell, fallback: CommitIdentity): Promise<string[]> {
  const res = await shell.git(["config", "--get", "user.email"], { maxBytes: 4096 });
  if (res.code === 0 && text(res.stdout).trim()) return [];
  return ["-c", `user.name=${fallback.name}`, "-c", `user.email=${fallback.email}`];
}

export async function commitFiles(
  shell: RobotShell,
  look: WorktreeLook,
  req: CommitChangesRequest,
  identity: CommitIdentity,
): Promise<{ sha: string; files: number }> {
  const paths = [...new Set(req.files.map((f) => f.path))];
  checkViewed(look, req.files);
  const add = await shell.git(["add", "-A", "--", ...paths]);
  if (add.code !== 0) throw gitFailure(add, "git add");
  const who = await identityArgs(shell, identity);
  const commit = await shell.git([
    ...who,
    "commit",
    "--quiet",
    "--no-verify",
    "--only",
    "-m",
    req.message,
    "--",
    ...paths,
  ]);
  if (commit.code !== 0) throw gitFailure(commit, "git commit");
  const head = await shell.git(["rev-parse", "HEAD"]);
  if (head.code !== 0) throw gitFailure(head, "git rev-parse");
  return { sha: text(head.stdout).trim(), files: paths.length };
}

export async function discardFile(
  shell: RobotShell,
  look: WorktreeLook,
  file: FileSig,
): Promise<void> {
  checkViewed(look, [file]);
  const entry = look.byPath.get(file.path);
  if (!entry) return;
  if (entry.kind === "untracked") {
    const res = await shell.git(["clean", "--force", "--quiet", "--", file.path]);
    if (res.code !== 0) throw gitFailure(res, "git clean");
    return;
  }
  // In HEAD: back to HEAD in both index and working tree.
  const inHead = await shell.git(["cat-file", "-e", `HEAD:${file.path}`]);
  const res =
    inHead.code === 0
      ? await shell.git(["restore", "--source=HEAD", "--staged", "--worktree", "--", file.path])
      : // Added (staged) but never committed: drop it from the index and the disk.
        await shell.git(["rm", "--force", "--quiet", "--", file.path]);
  if (res.code !== 0) throw gitFailure(res, "discarding the file");
}
