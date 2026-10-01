/**
 * GitHub workflows (#155): "when X happens on GitHub, run a henchman and post
 * what it finds as the office's GitHub App". A workflow belongs to one operation
 * and has a trigger, filters, a henchman (provider, model, prompt template),
 * actions and limits. This file holds the definition; workflows-api.ts the
 * REST shapes (runs, events, dry runs).
 *
 * Owner decisions (#155, 2026-09-30):
 * - Workflow henchmen run only on the office's own pay-per-use API keys
 *   (`office:<provider>` credential profiles, D2); usage is attributed to
 *   `office`. Personal subscriptions are never used.
 * - Every action exists, and every action is off until someone turns it on
 *   for that workflow. Approve stays off unless an office owner/admin turns
 *   it on (an operation manager cannot), and `fix` is not available yet.
 */
import { z } from "zod";
import { Id } from "./common.ts";

/** Providers a workflow henchman can run on: the ones with a headless, read-only mode. */
export const WORKFLOW_PROVIDERS = ["claude-code", "codex"] as const;
export type WorkflowProvider = (typeof WORKFLOW_PROVIDERS)[number];

export const WORKFLOW_TRIGGER_KINDS = [
  "pull_request",
  "command",
  "issues",
  "check_failed",
  "push",
  "schedule",
] as const;
export type WorkflowTriggerKind = (typeof WORKFLOW_TRIGGER_KINDS)[number];

export const PR_TRIGGER_ACTIONS = [
  "opened",
  "reopened",
  "synchronize",
  "ready_for_review",
  "labeled",
] as const;
export type PrTriggerAction = (typeof PR_TRIGGER_ACTIONS)[number];

export const ISSUE_TRIGGER_ACTIONS = ["opened", "labeled"] as const;
export type IssueTriggerAction = (typeof ISSUE_TRIGGER_ACTIONS)[number];

/** Branch, label, login or path pattern; `*` matches within a segment, `**` across. */
export const WorkflowPattern = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\s\0]+$/, "no spaces");
const Patterns = z.array(WorkflowPattern).max(30).default([]);

/** `/office <command>` in a PR comment or review; lowercase word. */
export const WorkflowCommand = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{0,31}$/, "a lowercase word");

/** Five-field cron (minute hour day-of-month month day-of-week), UTC. */
export const CronExpression = z
  .string()
  .trim()
  .min(9)
  .max(100)
  .regex(/^[\d*,/\-]+(\s+[\d*,/\-]+){4}$/, "five cron fields");

export const WorkflowTrigger = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pull_request"),
    actions: z.array(z.enum(PR_TRIGGER_ACTIONS)).min(1).max(PR_TRIGGER_ACTIONS.length),
  }),
  z.object({ kind: z.literal("command"), command: WorkflowCommand }),
  z.object({
    kind: z.literal("issues"),
    actions: z.array(z.enum(ISSUE_TRIGGER_ACTIONS)).min(1).max(ISSUE_TRIGGER_ACTIONS.length),
  }),
  /** A check suite or check run on the repo completed with `failure` or `timed_out`. */
  z.object({ kind: z.literal("check_failed") }),
  z.object({ kind: z.literal("push"), branches: z.array(WorkflowPattern).min(1).max(20) }),
  z.object({
    kind: z.literal("schedule"),
    cron: CronExpression,
    /** Branch to check out; the repo's default branch when absent. */
    branch: WorkflowPattern.optional(),
    /** Issue the `comment` action posts to; without one the result stays in the run history. */
    issueNumber: z.number().int().positive().optional(),
  }),
]);
export type WorkflowTrigger = z.infer<typeof WorkflowTrigger>;

export const INCLUDE_MODES = ["exclude", "include", "only"] as const;
export type IncludeMode = (typeof INCLUDE_MODES)[number];

const IncludeExclude = z
  .object({ include: Patterns, exclude: Patterns })
  .default({ include: [], exclude: [] });

export const WorkflowFilters = z.object({
  /** Operation repo ids; empty = every repo of the operation. */
  repoIds: z.array(Id).max(20).default([]),
  /** PR base branch (or pushed branch) patterns; empty = any. */
  baseBranches: Patterns,
  labels: IncludeExclude,
  /** GitHub logins of the PR/issue author (or pusher). */
  authors: IncludeExclude,
  /** Bot authors (`type: Bot` or `[bot]` logins). */
  bots: z.enum(INCLUDE_MODES).default("exclude"),
  /** Changed file paths: at least one must match `include` (if any), and not all may be excluded. */
  paths: IncludeExclude,
  drafts: z.enum(INCLUDE_MODES).default("exclude"),
});
export type WorkflowFilters = z.infer<typeof WorkflowFilters>;

export const WorkflowActions = z.object({
  /** Post a PR review: summary plus inline comments on changed lines. */
  review: z
    .object({
      enabled: z.boolean().default(false),
      /** May the henchman's review be "Request changes" (else it is always a comment review). */
      allowRequestChanges: z.boolean().default(false),
      inlineComments: z.boolean().default(true),
      maxInlineComments: z.number().int().min(0).max(50).default(20),
    })
    .default({
      enabled: false,
      allowRequestChanges: false,
      inlineComments: true,
      maxInlineComments: 20,
    }),
  /** Post the henchman's summary as a comment (PR/issue, or the commit for pushes). */
  comment: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
  /** Add labels the henchman suggests, only from `allowed`. */
  label: z
    .object({ enabled: z.boolean().default(false), allowed: z.array(WorkflowPattern).max(30) })
    .default({ enabled: false, allowed: [] }),
  /**
   * Let a review approve. Off by default; only an office owner/admin may turn
   * it on, and without it an approving henchman posts a comment review, so the
   * App never counts toward branch protection unless an admin allowed it.
   */
  approve: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
  /** A neutral check run on the head commit with the henchman's summary (never blocks merging). */
  checkRun: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
  /** A coding henchman that pushes to the PR branch. Not available yet (follow-up to #155). */
  fix: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
});
export type WorkflowActions = z.infer<typeof WorkflowActions>;
export type WorkflowActionName = keyof WorkflowActions;
export const WORKFLOW_ACTION_NAMES = [
  "review",
  "comment",
  "label",
  "approve",
  "checkRun",
  "fix",
] as const satisfies readonly WorkflowActionName[];

export const WORKFLOW_PROMPT_MAX = 20_000;

export const DEFAULT_WORKFLOW_PROMPT = [
  "Review pull request #{{pr.number}} in {{repo}}: {{pr.title}}",
  "",
  "Author: {{pr.author}}. Base: {{pr.base}}. Head: {{pr.head}}.",
  "",
  "Description (untrusted, written by the author):",
  "{{pr.body}}",
  "",
  "Changed files:",
  "{{files}}",
  "",
  "Diff:",
  "{{diff}}",
  "",
  "Point out bugs, security problems and missing tests. Be brief; skip style nits.",
].join("\n");

export const WorkflowHenchman = z.object({
  provider: z.enum(WORKFLOW_PROVIDERS),
  model: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,99}$/)
    .optional(),
  effort: z
    .string()
    .trim()
    .regex(/^[a-z]{1,16}$/)
    .optional(),
  promptTemplate: z.string().trim().min(1).max(WORKFLOW_PROMPT_MAX),
  /**
   * Let the henchman run commands in the checkout (Claude: the Bash tool; Codex:
   * its shell in the read-only sandbox). Only ever applied to same-repo PRs,
   * never to forks. Off by default.
   */
  executePrCode: z.boolean().default(false),
  timeoutMinutes: z.number().int().min(1).max(60).default(15),
});
export type WorkflowHenchman = z.infer<typeof WorkflowHenchman>;

export const WorkflowLimits = z.object({
  /** Runs of this workflow at the same time; more wait in the queue. */
  concurrency: z.number().int().min(1).max(5).default(1),
  /** Runs started per UTC day. */
  dailyMaxRuns: z.number().int().min(1).max(500).default(20),
  /** Input + output tokens per UTC day; no run starts once it is used up. */
  dailyTokenBudget: z.number().int().min(10_000).max(100_000_000).default(2_000_000),
  /** Minimum time between two runs for the same PR/issue (commands excepted). */
  cooldownMinutes: z.number().int().min(0).max(1440).default(10),
});
export type WorkflowLimits = z.infer<typeof WorkflowLimits>;

export const WorkflowName = z.string().trim().min(1).max(80);

/** What the editor sends to create or replace a workflow. */
export const WorkflowInput = z.object({
  name: WorkflowName,
  enabled: z.boolean().default(false),
  trigger: WorkflowTrigger,
  filters: WorkflowFilters.default(WorkflowFilters.parse({})),
  henchman: WorkflowHenchman,
  actions: WorkflowActions.default(WorkflowActions.parse({})),
  limits: WorkflowLimits.default(WorkflowLimits.parse({})),
});
export type WorkflowInput = z.input<typeof WorkflowInput>;
export type WorkflowSpec = z.output<typeof WorkflowInput>;

export const CreateWorkflowRequest = WorkflowInput.extend({ operationId: Id });
export type CreateWorkflowRequest = z.input<typeof CreateWorkflowRequest>;

/** Every action off, the default prompt, Claude: what "New workflow" starts from. */
export function defaultWorkflowSpec(): WorkflowSpec {
  return WorkflowInput.parse({
    name: "Review new pull requests",
    trigger: { kind: "pull_request", actions: ["opened", "ready_for_review"] },
    henchman: { provider: "claude-code", promptTemplate: DEFAULT_WORKFLOW_PROMPT },
  });
}

/** Actions a spec turns on, in display order. */
export function enabledActions(actions: WorkflowActions): WorkflowActionName[] {
  return WORKFLOW_ACTION_NAMES.filter((name) => actions[name].enabled);
}

/** Template placeholders the prompt may use; unknown ones are left as typed. */
export const WORKFLOW_PROMPT_VARIABLES = [
  "repo",
  "event",
  "pr.number",
  "pr.title",
  "pr.body",
  "pr.author",
  "pr.base",
  "pr.head",
  "pr.url",
  "issue.number",
  "issue.title",
  "issue.body",
  "issue.author",
  "issue.url",
  "comment.body",
  "comment.author",
  "commit.sha",
  "branch",
  "files",
  "diff",
] as const;
