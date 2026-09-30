/**
 * What a run works on (#155): a PR (head and base refs, fresh facts from the
 * API, its changed files), an issue, or a commit on a branch.
 */
import type { WorkflowSpec, WorkflowTarget } from "@regulus/protocol";
import type { PullFacts, WorkflowContext } from "./context.ts";
import { type AppRepoClient, WorkflowRefusal } from "./github-app.ts";

export interface ResolvedTarget {
  view: WorkflowTarget;
  kind: "pull" | "issue" | "commit";
  number: number | null;
  pr: PullFacts | null;
  /** What to check out, e.g. `refs/pull/3/head`. */
  headRef: string;
  /** Base branch ref for the diff (PRs only). */
  baseRef: string | null;
  /** Commit the check run and review attach to, once known. */
  sha: string | null;
}

/** The cooldown/dedupe key of a context before anything is fetched. */
export function targetKey(ctx: WorkflowContext): string | null {
  const repo = ctx.repo?.fullName.toLowerCase();
  if (!repo) return null;
  const number = ctx.pr?.number ?? ctx.issue?.number ?? ctx.check?.prNumbers[0];
  if (number) return `${repo}#${number}`;
  const sha = ctx.push?.after ?? ctx.check?.headSha;
  return sha ? `${repo}@${sha}` : null;
}

/** A first guess at the target from the event alone (queue, dry run). */
export function targetFromContext(ctx: WorkflowContext): WorkflowTarget | null {
  if (!ctx.repo) return null;
  const repo = ctx.repo.fullName;
  if (ctx.pr) {
    return {
      kind: "pull",
      repo,
      number: ctx.pr.number,
      sha: ctx.pr.headSha || null,
      title: ctx.pr.title,
      url: ctx.pr.url || null,
    };
  }
  if (ctx.issue) {
    return {
      kind: ctx.issue.isPull ? "pull" : "issue",
      repo,
      number: ctx.issue.number,
      sha: null,
      title: ctx.issue.title,
      url: ctx.issue.url || null,
    };
  }
  const prNumber = ctx.check?.prNumbers[0];
  if (prNumber) {
    return {
      kind: "pull",
      repo,
      number: prNumber,
      sha: ctx.check?.headSha ?? null,
      title: null,
      url: null,
    };
  }
  const sha = ctx.push?.after ?? ctx.check?.headSha ?? null;
  return { kind: "commit", repo, number: null, sha, title: ctx.push?.ref ?? null, url: null };
}

/** Fetch what the run needs from GitHub and fill `ctx.pr` / `ctx.files` with fresh facts. */
export async function resolveTarget(
  client: AppRepoClient,
  spec: WorkflowSpec,
  ctx: WorkflowContext,
): Promise<ResolvedTarget> {
  const repo = `${client.repo.owner}/${client.repo.name}`;
  const prNumber =
    ctx.pr?.number ?? (ctx.issue?.isPull ? ctx.issue.number : undefined) ?? ctx.check?.prNumbers[0];
  if (prNumber) {
    const pr = await client.pull(prNumber);
    ctx.pr = pr;
    ctx.files = await client.pullFiles(prNumber);
    if (!pr.baseRef) throw new WorkflowRefusal("bad_ref", "the PR has no base branch");
    return {
      kind: "pull",
      number: pr.number,
      pr,
      headRef: `refs/pull/${pr.number}/head`,
      baseRef: `refs/heads/${pr.baseRef}`,
      sha: pr.headSha || null,
      view: {
        kind: "pull",
        repo,
        number: pr.number,
        sha: pr.headSha || null,
        title: pr.title,
        url: pr.url || null,
      },
    };
  }
  let branch: string | null = null;
  if (spec.trigger.kind === "schedule") branch = spec.trigger.branch ?? null;
  else if (ctx.push?.branch) branch = ctx.push.branch;
  else if (ctx.check?.headBranch) branch = ctx.check.headBranch;
  branch ??= await client.defaultBranch();
  const issueNumber =
    ctx.issue?.number ??
    (spec.trigger.kind === "schedule" ? (spec.trigger.issueNumber ?? null) : null);
  const kind = issueNumber ? "issue" : "commit";
  const sha = kind === "commit" ? await client.branchHead(branch) : null;
  return {
    kind,
    number: issueNumber,
    pr: null,
    headRef: `refs/heads/${branch}`,
    baseRef: null,
    sha,
    view: {
      kind,
      repo,
      number: issueNumber,
      sha,
      title: ctx.issue?.title ?? branch,
      url: ctx.issue?.url || null,
    },
  };
}
