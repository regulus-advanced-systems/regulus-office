/**
 * Dry run (#155): would this workflow run for that past event, with which
 * prompt, and what would it post? Pure: no GitHub call, no henchman, nothing
 * written. Facts only a real run fetches (the PR's changed files, the diff,
 * the commenter's permission) are named as such.
 */
import type { WorkflowDryRunResult, WorkflowSpec } from "@regulus/protocol";
import type { WorkflowContext } from "./context.ts";
import { loopReason } from "./engine.ts";
import { matchWorkflow } from "./match.ts";
import { plannedActions } from "./post.ts";
import { renderPrompt } from "./prompt.ts";
import { SecretScrubber } from "./scrub.ts";
import { targetFromContext } from "./target.ts";

const PROMPT_PREVIEW_MAX = 40_000;

export function safetyNotes(spec: WorkflowSpec, ctx: WorkflowContext | null): string[] {
  const fork = ctx?.pr?.fork ?? false;
  const notes = [
    `runs on the office's ${spec.henchman.provider} API key only (usage → office); never a subscription`,
    "posts as the office's GitHub App with an installation token for this repo only",
    "the henchman reads a throwaway checkout in its own sandbox and cannot push",
  ];
  if (fork) {
    notes.push(
      "fork PR: comment review at most; no approve, request changes, labels or code execution",
    );
  }
  if (spec.henchman.executePrCode) {
    notes.push(
      fork || !ctx?.pr
        ? "running PR code is on but does not apply here (same-repo PRs only)"
        : "the henchman may run the PR's code (same-repo PR) inside its sandbox",
    );
  } else notes.push("the henchman does not run any code from the PR");
  if (spec.actions.approve.enabled) notes.push("approve is on (an office admin allowed it)");
  if (spec.actions.fix.enabled) notes.push("fix is not available yet: runs would be refused");
  if (spec.trigger.kind === "command") {
    notes.push("the commenter's write access to the repo is checked when the run starts");
  }
  return notes;
}

export function dryRun(
  spec: WorkflowSpec,
  operationId: string,
  ctx: WorkflowContext,
): WorkflowDryRunResult {
  const reasons: string[] = [];
  let matched = true;
  if (!ctx.operationIds.includes(operationId)) {
    matched = false;
    reasons.push("the event is for a repo that is not in this operation");
  }
  const loop = loopReason(ctx);
  if (loop) {
    matched = false;
    reasons.push(`ignored: ${loop}`);
  }
  const m = matchWorkflow(spec, ctx, { strict: false });
  if (!m.matched) matched = false;
  reasons.push(...m.reasons);
  if (m.matched && ctx.pr && ctx.files === undefined && spec.filters.paths.include.length > 0) {
    reasons.push("the paths filter is checked against the PR's files when the run starts");
  }
  if (!spec.enabled) reasons.push("the workflow is turned off, so it would not run now");
  const target = targetFromContext(ctx);
  const prompt = renderPrompt(
    spec,
    {
      ctx,
      files: ctx.files ?? null,
      diff: "(the diff is fetched when the run starts)",
      repo: ctx.repo?.fullName ?? "",
    },
    { canRunCommands: spec.henchman.executePrCode && !!ctx.pr && !ctx.pr.fork, nonce: "preview" },
  ).text;
  return {
    matched,
    reasons: reasons.map((r) => r.slice(0, 300)),
    target,
    // PR text could carry keys; the preview never shows one.
    prompt: new SecretScrubber().redact(
      prompt.length > PROMPT_PREVIEW_MAX ? prompt.slice(0, PROMPT_PREVIEW_MAX) : prompt,
    ),
    actions: plannedActions(spec, {
      kind: target?.kind ?? "commit",
      fork: ctx.pr?.fork ?? false,
    }),
    safety: safetyNotes(spec, ctx).map((s) => s.slice(0, 300)),
  };
}
