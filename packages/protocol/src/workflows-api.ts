/**
 * REST shapes for GitHub workflows (#155): the workflow list per floor, the
 * run history, recent GitHub events (for dry runs) and dry-run results.
 *
 * Reading a floor's workflows and runs needs `view` on the floor; creating,
 * changing, deleting, dry-running and cancelling need office owner/admin or
 * floor `manage`. Only office owners/admins may turn on `approve`.
 */
import { z } from "zod";
import { Id, TimestampMs } from "./common.ts";
import { WORKFLOW_PROVIDERS, WorkflowInput, WorkflowName } from "./workflows.ts";

export const WORKFLOWS_API_PATH = "/api/workflows";
export const WORKFLOW_RUNS_API_PATH = `${WORKFLOWS_API_PATH}/runs`;
export const WORKFLOW_EVENTS_API_PATH = `${WORKFLOWS_API_PATH}/events`;

export const workflowPath = (id: string) => `${WORKFLOWS_API_PATH}/${encodeURIComponent(id)}`;
export const workflowDryRunPath = (id: string) => `${workflowPath(id)}/dry-run`;
export const workflowRunPath = (id: string) =>
  `${WORKFLOW_RUNS_API_PATH}/${encodeURIComponent(id)}`;
export const workflowRunCancelPath = (id: string) => `${workflowRunPath(id)}/cancel`;

export const WORKFLOW_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  /** A safety rule said no (fork, command author without write access, no App, no office key). */
  "refused",
  /** Did not apply after all (paths filter, cooldown, budget, nothing to post). */
  "skipped",
  "cancelled",
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];
export const FINISHED_RUN_STATUSES: readonly WorkflowRunStatus[] = [
  "succeeded",
  "failed",
  "refused",
  "skipped",
  "cancelled",
];

export const WorkflowUsageToday = z.object({
  runs: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type WorkflowUsageToday = z.infer<typeof WorkflowUsageToday>;

export const WorkflowView = WorkflowInput.extend({
  id: Id,
  floorId: Id,
  createdBy: z.string().nullable(),
  createdAt: TimestampMs,
  updatedAt: TimestampMs,
  today: WorkflowUsageToday,
});
export type WorkflowView = z.infer<typeof WorkflowView>;

export const WorkflowListResponse = z.object({
  workflows: z.array(WorkflowView),
  /** Can the signed-in human edit this floor's workflows (admin or floor manage)? */
  canEdit: z.boolean(),
  /** Can they turn on approve (office owner/admin)? */
  canApprove: z.boolean(),
  /** What is missing for runs to happen: `github_app` (no App connected), `office_key:<provider>`. */
  missing: z.array(z.string().max(60)).max(10),
});
export type WorkflowListResponse = z.infer<typeof WorkflowListResponse>;

export const WorkflowTarget = z.object({
  kind: z.enum(["pull", "issue", "commit"]),
  repo: z.string().max(200),
  number: z.number().int().positive().nullable(),
  sha: z.string().max(64).nullable(),
  title: z.string().max(300).nullable(),
  url: z.string().max(500).nullable(),
});
export type WorkflowTarget = z.infer<typeof WorkflowTarget>;

export const WorkflowRunLink = z.object({
  kind: z.enum(["review", "comment", "labels", "check_run"]),
  url: z.string().max(500),
});
export type WorkflowRunLink = z.infer<typeof WorkflowRunLink>;

export const WorkflowRunView = z.object({
  id: Id,
  workflowId: Id,
  workflowName: WorkflowName,
  floorId: Id,
  /** `pull_request.opened`, `issue_comment.created`, `schedule`, … */
  trigger: z.string().max(80),
  deliveryId: z.string().max(200),
  target: WorkflowTarget.nullable(),
  status: z.enum(WORKFLOW_RUN_STATUSES),
  /** Short machine code with a human hint, e.g. `fork_pr`, `paths_filter`. */
  reason: z.string().max(300).nullable(),
  provider: z.enum(WORKFLOW_PROVIDERS),
  model: z.string().max(100).nullable(),
  /** The robot's name in the office (review desk later). */
  robot: z.string().max(80),
  queuedAt: TimestampMs,
  startedAt: TimestampMs.nullable(),
  finishedAt: TimestampMs.nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  links: z.array(WorkflowRunLink),
});
export type WorkflowRunView = z.infer<typeof WorkflowRunView>;

export const WorkflowRunDetail = WorkflowRunView.extend({
  /** Timestamped steps; never tokens, keys or prompt text. */
  log: z.array(z.string().max(1000)).max(500),
  /** The robot's summary as posted (or as it would have been). */
  summary: z.string().max(70_000).nullable(),
});
export type WorkflowRunDetail = z.infer<typeof WorkflowRunDetail>;

export const WorkflowRunListResponse = z.object({ runs: z.array(WorkflowRunView) });
export type WorkflowRunListResponse = z.infer<typeof WorkflowRunListResponse>;

export const WorkflowEventView = z.object({
  id: Id,
  floorIds: z.array(Id),
  /** `pull_request.opened` etc. */
  name: z.string().max(80),
  repo: z.string().max(200).nullable(),
  summary: z.string().max(300),
  sender: z.string().max(100).nullable(),
  receivedAt: TimestampMs,
});
export type WorkflowEventView = z.infer<typeof WorkflowEventView>;

export const WorkflowEventListResponse = z.object({ events: z.array(WorkflowEventView) });
export type WorkflowEventListResponse = z.infer<typeof WorkflowEventListResponse>;

export const WorkflowDryRunRequest = z.object({
  eventId: Id,
  /** Try an unsaved edit; the saved workflow when absent. */
  workflow: WorkflowInput.optional(),
});
export type WorkflowDryRunRequest = z.input<typeof WorkflowDryRunRequest>;

export const WorkflowDryRunResult = z.object({
  matched: z.boolean(),
  /** Why it did or did not match, one line each. */
  reasons: z.array(z.string().max(300)),
  target: WorkflowTarget.nullable(),
  /** The rendered prompt (untrusted parts included), capped. */
  prompt: z.string().max(40_000).nullable(),
  /** What would be posted, e.g. "PR review (comment)". Nothing is posted by a dry run. */
  actions: z.array(z.string().max(200)),
  /** Safety rules that would apply, e.g. "fork PR: no code execution". */
  safety: z.array(z.string().max(300)),
});
export type WorkflowDryRunResult = z.infer<typeof WorkflowDryRunResult>;

export const WorkflowCancelResponse = z.object({ cancelled: z.boolean() });
export type WorkflowCancelResponse = z.infer<typeof WorkflowCancelResponse>;
