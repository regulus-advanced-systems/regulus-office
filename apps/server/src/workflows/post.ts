/**
 * Posting a run's result to GitHub as the office's App (#155), within what
 * the workflow turned on and what the safety rules allow:
 *
 * - review: `COMMENT`, or `REQUEST_CHANGES` when the workflow allows it;
 *   `APPROVE` only when an office owner/admin turned approve on, else an
 *   approving robot posts a comment review. So the App never counts toward
 *   branch protection unless an admin allowed it.
 * - fork PRs: a comment review, a comment and a neutral check run at most.
 *   No approve, no request changes, no labels (the PR author wrote the text
 *   the robot read), and no fix or code execution (see executor.ts).
 * - everything carries "via Regulus Office" and a hidden marker, so the
 *   office's own comments never trigger a workflow again.
 *
 * Every write is audited (`workflow_run.github_write`) with the run, the kind
 * and the repo, never the text.
 */
import type { WorkflowRunLink, WorkflowSpec } from "@regulus/protocol";
import { AUDIT_ACTIONS, writeAudit } from "../auth/audit.ts";
import type { Db } from "../db/index.ts";
import { OFFICE_MARKER, type PullFacts } from "./context.ts";
import type { AppRepoClient } from "./github-app.ts";
import { matchesAny } from "./match.ts";
import { type PostableReview, postableReview, type RobotReview } from "./robot-output.ts";

const CHECK_SUMMARY_MAX = 60_000;

export function footer(workflowName: string, runId: string): string {
  const name = workflowName.replace(/[\r\n<>]/g, " ").slice(0, 80);
  return `\n\n---\n<sub>via Regulus Office · workflow “${name}” · run ${runId.slice(0, 8)}</sub>\n${OFFICE_MARKER}`;
}

export type ReviewEvent = "COMMENT" | "REQUEST_CHANGES" | "APPROVE";

/** The review event GitHub gets for a verdict under the workflow's rules. */
export function reviewEvent(
  verdict: RobotReview["verdict"],
  actions: WorkflowSpec["actions"],
  fork: boolean,
): ReviewEvent {
  if (fork) return "COMMENT";
  if (verdict === "approve" && actions.approve.enabled) return "APPROVE";
  if (verdict === "request_changes" && actions.review.allowRequestChanges) return "REQUEST_CHANGES";
  return "COMMENT";
}

/** Human-readable list of what a run would post (dry run, run log). */
export function plannedActions(spec: WorkflowSpec, target: { kind: string; fork: boolean }) {
  const out: string[] = [];
  const a = spec.actions;
  if (a.review.enabled && target.kind === "pull") {
    const events = ["comment review"];
    if (!target.fork && a.review.allowRequestChanges) events.push("request changes");
    if (!target.fork && a.approve.enabled) events.push("approve");
    out.push(
      `PR review (${events.join(" / ")})${a.review.inlineComments ? " with inline comments" : ""}`,
    );
  }
  if (a.comment.enabled) out.push(target.kind === "commit" ? "commit comment" : "comment");
  if (a.label.enabled && target.kind !== "commit" && !target.fork) {
    out.push(`labels from: ${a.label.allowed.join(", ") || "(none allowed)"}`);
  }
  if (a.checkRun.enabled && target.kind !== "issue") out.push("neutral check run");
  if (out.length === 0) out.push("nothing (the result stays in the run history)");
  return out;
}

export interface PostTarget {
  kind: "pull" | "issue" | "commit";
  number: number | null;
  sha: string | null;
  pr: PullFacts | null;
}

export interface PostDeps {
  db: Db;
  client: AppRepoClient;
  runId: string;
  workflowName: string;
  spec: WorkflowSpec;
  log: (line: string) => void;
}

export interface PostResult {
  links: WorkflowRunLink[];
  review: PostableReview;
}

export async function postResult(
  deps: PostDeps,
  target: PostTarget,
  review: RobotReview,
  diff: string | null,
): Promise<PostResult> {
  const { client, spec } = deps;
  const a = spec.actions;
  const fork = target.pr?.fork ?? false;
  const repo = `${client.repo.owner}/${client.repo.name}`;
  const tail = footer(deps.workflowName, deps.runId);
  const shaped = postableReview(review, {
    diff,
    maxInline: a.review.maxInlineComments,
    inline: a.review.inlineComments,
    allowedLabels: a.label.allowed,
    labelMatches: (label, allowed) => matchesAny(label, allowed, true),
  });
  const links: WorkflowRunLink[] = [];
  const audit = (kind: string, meta: Record<string, unknown> = {}) =>
    writeAudit(deps.db, {
      userId: null,
      action: AUDIT_ACTIONS.workflowRunGitHubWrite,
      targetKind: "workflow_run",
      targetId: deps.runId,
      meta: { kind, repo, number: target.number, sha: target.sha, ...meta },
    });

  if (a.review.enabled && target.kind === "pull" && target.number && target.sha) {
    const event = reviewEvent(shaped.verdict, a, fork);
    const url = await client.createReview(target.number, {
      commitId: target.sha,
      body: `${shaped.body}${tail}`,
      event,
      comments: shaped.inline,
    });
    audit("review", { event, inline: shaped.inline.length });
    deps.log(`posted a ${event.toLowerCase()} review with ${shaped.inline.length} inline comments`);
    if (url) links.push({ kind: "review", url });
  }
  if (a.comment.enabled) {
    let url = "";
    if (target.number) url = await client.comment(target.number, `${shaped.body}${tail}`);
    else if (target.sha) url = await client.commitComment(target.sha, `${shaped.body}${tail}`);
    if (target.number || target.sha) {
      audit("comment");
      deps.log("posted a comment");
      if (url) links.push({ kind: "comment", url });
    }
  }
  if (a.label.enabled && target.number && shaped.labels.length > 0) {
    if (fork) deps.log("fork PR: labels not added");
    else {
      await client.addLabels(target.number, shaped.labels);
      audit("labels", { labels: shaped.labels });
      deps.log(`added labels ${shaped.labels.join(", ")}`);
      links.push({ kind: "labels", url: target.pr?.url ?? "" });
    }
  }
  return { links, review: shaped };
}

export function checkSummary(body: string): string {
  return body.length > CHECK_SUMMARY_MAX ? `${body.slice(0, CHECK_SUMMARY_MAX)}\n\n[… cut]` : body;
}
