/**
 * A meeting's shared worktree (#50, SPEC §8, D17): a worktree of the
 * starter's own clone, in the starter's own area of the operation, named after
 * the meeting (`<area>/<meetingId>`) on an `office/meeting-…` branch. Only the
 * starter's runner reaches it; every member is the starter's henchman, so
 * sharing it never crosses humans. `.meeting/` (the notes) is ignored by git
 * through the clone's `info/exclude`, so it is never committed or pushed and
 * never counts as uncommitted work.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { githubPulls } from "../db/schema/index.ts";
import type { RepoAccess } from "../github/repo-access.ts";
import type { GitWorktreeWorkspaces } from "../worktrees/workspaces.ts";
import type { MeetingWorkspaces } from "./ports.ts";
import { NOTES_DIR } from "./prompt.ts";

const EXCLUDE_LINE = `/${NOTES_DIR}/`;

/** Add `/.meeting/` to the clone's `info/exclude` once. */
export async function excludeNotes(clone: string): Promise<void> {
  const file = join(clone, ".git", "info", "exclude");
  const current = await readFile(file, "utf8").catch(() => "");
  if (current.split("\n").some((l) => l.trim() === EXCLUDE_LINE)) return;
  await mkdir(dirname(file), { recursive: true });
  const sep = current === "" || current.endsWith("\n") ? "" : "\n";
  await appendFile(file, `${sep}# Regulus Office meeting notes (#50)\n${EXCLUDE_LINE}\n`);
}

/** The PR's head as `origin/<branch>`, when it is an open PR on a branch of this repo. */
export function pullHead(db: Db, repos: RepoAccess, repoId: string, prNumber: number) {
  const repo = repos.getRepo(repoId);
  const pull = db
    .select({ state: githubPulls.state, headRef: githubPulls.headRef, raw: githubPulls.raw })
    .from(githubPulls)
    .where(and(eq(githubPulls.repoId, repoId), eq(githubPulls.number, prNumber)))
    .get();
  if (!repo || !pull?.headRef || pull.state !== "open") return null;
  let headRepo: unknown;
  try {
    headRepo = (JSON.parse(pull.raw) as { head?: { repo?: { full_name?: unknown } } }).head?.repo
      ?.full_name;
  } catch {
    headRepo = undefined;
  }
  const same = `${repo.owner}/${repo.name}`.toLowerCase();
  if (typeof headRepo === "string" && headRepo.toLowerCase() !== same) return null;
  return `origin/${pull.headRef}`;
}

export function gitMeetingWorkspaces(deps: {
  db: Db;
  repos: RepoAccess;
  workspaces: GitWorktreeWorkspaces;
}): MeetingWorkspaces {
  const { db, repos, workspaces } = deps;
  return {
    async prepare(input) {
      const prepared = await workspaces.prepare({
        agentId: input.meetingId,
        operationId: input.operationId,
        repoId: input.repoId,
        ownerUserId: input.ownerUserId,
        slug: input.slug,
        ...(input.base ? { base: input.base } : {}),
      });
      const { clone } = workspaces.cloneFor({ ...input, workdir: prepared.workdir });
      await excludeNotes(clone);
      return prepared;
    },
    async uncommitted(input) {
      const repo = repos.getRepo(input.repoId);
      if (!repo) return [];
      const { clone } = workspaces.cloneFor(input);
      const paths = await workspaces.uncommitted(repo, clone, input.workdir);
      return paths.filter((p) => !p.startsWith(`${NOTES_DIR}/`));
    },
    release: (input) => workspaces.releaseShared(input),
    baseBranch: (repoId) => repos.getRepo(repoId)?.defaultBranch ?? "main",
    pullBase: (repoId, prNumber) => pullHead(db, repos, repoId, prNumber),
  };
}
