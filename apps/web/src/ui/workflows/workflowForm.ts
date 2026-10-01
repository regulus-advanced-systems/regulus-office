/**
 * Pure helpers for the workflows panel (#155): the overlay id, text ⇄
 * pattern lists, trigger defaults per kind, and the labels the list and the
 * run history show. The server validates everything again.
 */
import {
  defaultWorkflowSpec,
  enabledActions,
  type WorkflowActionName,
  type WorkflowRunStatus,
  type WorkflowRunView,
  type WorkflowSpec,
  type WorkflowTrigger,
  type WorkflowTriggerKind,
} from "@regulus/protocol";

const OVERLAY_PREFIX = "workflows:";

export const workflowsOverlay = (operationId: string): string => `${OVERLAY_PREFIX}${operationId}`;

export function operationIdFromWorkflowsOverlay(overlay: string | null): string | null {
  return overlay?.startsWith(OVERLAY_PREFIX) ? overlay.slice(OVERLAY_PREFIX.length) || null : null;
}

/** One pattern per line (commas also split); blanks dropped. */
export function textToPatterns(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const patternsToText = (list: readonly string[]): string => list.join("\n");

export const TRIGGER_LABELS: Record<WorkflowTriggerKind, string> = {
  pull_request: "Pull request",
  command: "/office command in a PR comment",
  issues: "Issue",
  check_failed: "Failed check",
  push: "Push to a branch",
  schedule: "Schedule (cron, UTC)",
};

export const ACTION_LABELS: Record<WorkflowActionName, string> = {
  review: "Post a PR review",
  comment: "Post a comment",
  label: "Add labels",
  approve: "Allow approving",
  checkRun: "Neutral check run",
  fix: "Push fixes",
};

export function defaultTrigger(kind: WorkflowTriggerKind): WorkflowTrigger {
  switch (kind) {
    case "pull_request":
      return { kind, actions: ["opened", "ready_for_review"] };
    case "command":
      return { kind, command: "review" };
    case "issues":
      return { kind, actions: ["opened"] };
    case "check_failed":
      return { kind };
    case "push":
      return { kind, branches: ["main"] };
    case "schedule":
      return { kind, cron: "0 7 * * 1-5" };
  }
}

export function triggerSummary(t: WorkflowTrigger): string {
  switch (t.kind) {
    case "pull_request":
      return `PR ${t.actions.join(", ")}`;
    case "command":
      return `/office ${t.command}`;
    case "issues":
      return `issue ${t.actions.join(", ")}`;
    case "check_failed":
      return "a check failed";
    case "push":
      return `push to ${t.branches.join(", ")}`;
    case "schedule":
      return `cron ${t.cron}`;
  }
}

export function actionsSummary(spec: Pick<WorkflowSpec, "actions">): string {
  const on = enabledActions(spec.actions);
  return on.length === 0 ? "no actions on" : on.map((a) => ACTION_LABELS[a]).join(", ");
}

export function newWorkflow(): WorkflowSpec {
  return defaultWorkflowSpec();
}

/** A deep copy the editor may change freely. */
export const cloneSpec = (spec: WorkflowSpec): WorkflowSpec => structuredClone(spec);

export const STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
  refused: "Refused",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

export function formatDuration(
  run: Pick<WorkflowRunView, "startedAt" | "finishedAt">,
  now: number,
) {
  if (!run.startedAt) return "–";
  const ms = (run.finishedAt ?? now) - run.startedAt;
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export function targetLabel(run: Pick<WorkflowRunView, "target">): string {
  const t = run.target;
  if (!t) return "–";
  if (t.number) return `${t.repo}#${t.number}`;
  if (t.sha) return `${t.repo}@${t.sha.slice(0, 7)}`;
  return t.repo;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export const MISSING_HINTS: Record<string, string> = {
  github_app:
    "No GitHub App is connected. Workflows post only as the office's App: connect one in Settings → GitHub.",
  "office_key:claude-code":
    "No office Anthropic API key. An admin adds one under Connect providers (office key); workflows never use personal logins.",
  "office_key:codex":
    "No office OpenAI API key. An admin adds one under Connect providers (office key); workflows never use personal logins.",
};
