/**
 * Linking a task to the pull request its robot opens (#37). A PR belongs to
 * a task when its head branch is the robot's worktree branch in the same
 * floor repo. It shows up three ways:
 *
 * - the robot's owner opens it through the office (`agent.pr`), which the
 *   AgentManager reports to its observer;
 * - a `pull_request` event on the GitHub event bus (#35: webhook or poll);
 * - the board cache (`github_pulls`), for a PR that appeared while the
 *   office was down or before the task finished.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { agents, githubPulls } from "../db/schema/index.ts";
import type { GitHubEvent } from "../github/events.ts";

/** Robots working on `headRef` in one of these floor repos. */
export function agentsOnBranch(db: Db, repoIds: readonly string[], headRef: string): string[] {
  if (repoIds.length === 0 || !headRef) return [];
  return db
    .select({ id: agents.id })
    .from(agents)
    .where(and(inArray(agents.repoId, [...repoIds]), eq(agents.worktreeBranch, headRef)))
    .all()
    .map((r) => r.id);
}

/** The newest cached PR from a robot's branch, or null. */
export function cachedPrFor(db: Db, agentId: string): number | null {
  const agent = db
    .select({ repoId: agents.repoId, branch: agents.worktreeBranch })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get();
  if (!agent?.branch) return null;
  const pr = db
    .select({ number: githubPulls.number })
    .from(githubPulls)
    .where(and(eq(githubPulls.repoId, agent.repoId), eq(githubPulls.headRef, agent.branch)))
    .orderBy(desc(githubPulls.number))
    .get();
  return pr?.number ?? null;
}

/** Head branch and number of a `pull_request` event (webhook or poll payload). */
export function pullFromEvent(
  event: GitHubEvent<"pull_request">,
): { headRef: string; number: number } | null {
  const pr = event.payload.pull_request as
    | { number?: unknown; head?: { ref?: unknown } }
    | undefined;
  const number = pr?.number ?? event.payload.number;
  const headRef = pr?.head?.ref;
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1) return null;
  if (typeof headRef !== "string" || !headRef) return null;
  return { headRef, number };
}
