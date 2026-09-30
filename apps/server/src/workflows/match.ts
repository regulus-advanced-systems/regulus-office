/**
 * Does a workflow apply to a context (#155)? Two passes:
 *
 * - at the event (`strict: false`): facts the event does not carry (a
 *   command comment's PR base branch, a PR's changed files) do not reject;
 * - in the run, once the PR and its files are fetched (`strict: true`):
 *   every filter must hold, else the run is `skipped`.
 *
 * Patterns: `*` matches within a path segment, `**` across segments, `?` one
 * character. Labels and logins compare case-insensitively (GitHub treats them
 * so); branches and paths case-sensitively.
 */
import type { WorkflowFilters, WorkflowSpec, WorkflowTrigger } from "@regulus/protocol";
import { officeCommand, type WorkflowContext } from "./context.ts";

const cache = new Map<string, RegExp>();

export function globRegExp(pattern: string, caseInsensitive = false): RegExp {
  const key = `${caseInsensitive ? "i" : "s"}:${pattern}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === "*" && pattern[i + 1] === "*") {
      // `**/` also matches nothing: `src/**/a.ts` matches `src/a.ts`.
      if (pattern[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const re = new RegExp(`^${out}$`, caseInsensitive ? "i" : "");
  if (cache.size > 500) cache.clear();
  cache.set(key, re);
  return re;
}

export function matchesAny(value: string, patterns: readonly string[], ci = false): boolean {
  return patterns.some((p) => globRegExp(p, ci).test(value));
}

const FAILED = new Set(["failure", "timed_out"]);

/** Null when the trigger fires for this context, else why not. */
export function triggerMismatch(trigger: WorkflowTrigger, ctx: WorkflowContext): string | null {
  switch (trigger.kind) {
    case "pull_request":
      if (ctx.name !== "pull_request") return "not a pull request event";
      if (!ctx.action || !(trigger.actions as string[]).includes(ctx.action)) {
        return `pull request action ${ctx.action ?? "none"} is not one of ${trigger.actions.join(", ")}`;
      }
      return null;
    case "command": {
      const commentable =
        (ctx.name === "issue_comment" && ctx.action === "created") ||
        (ctx.name === "pull_request_review" && ctx.action === "submitted");
      if (!commentable || !ctx.comment) return "not a new comment or review";
      const cmd = officeCommand(ctx.comment.body);
      if (cmd !== trigger.command) return `no "/office ${trigger.command}" in the comment`;
      return null;
    }
    case "issues":
      if (ctx.name !== "issues") return "not an issue event";
      if (!ctx.action || !(trigger.actions as string[]).includes(ctx.action)) {
        return `issue action ${ctx.action ?? "none"} is not one of ${trigger.actions.join(", ")}`;
      }
      return null;
    case "check_failed":
      if (ctx.name !== "check_suite" && ctx.name !== "check_run") return "not a check event";
      if (ctx.action !== "completed") return "check not completed";
      if (!ctx.check?.conclusion || !FAILED.has(ctx.check.conclusion)) {
        return `check concluded ${ctx.check?.conclusion ?? "unknown"}`;
      }
      return null;
    case "push":
      if (ctx.name !== "push" || !ctx.push) return "not a push";
      if (ctx.push.deleted) return "branch deleted";
      if (!ctx.push.branch || !matchesAny(ctx.push.branch, trigger.branches)) {
        return `branch ${ctx.push.branch ?? ctx.push.ref} does not match ${trigger.branches.join(", ")}`;
      }
      return null;
    case "schedule":
      return ctx.name === "schedule" ? null : "not a schedule tick";
  }
}

function includeExclude(
  what: string,
  values: readonly string[],
  rule: { include: readonly string[]; exclude: readonly string[] },
  ci: boolean,
  out: string[],
): void {
  if (rule.include.length > 0 && !values.some((v) => matchesAny(v, rule.include, ci))) {
    out.push(`no ${what} matches ${rule.include.join(", ")}`);
  }
  const excluded = values.find((v) => matchesAny(v, rule.exclude, ci));
  if (excluded !== undefined) out.push(`${what} ${excluded} is excluded`);
}

function tri(what: string, mode: "exclude" | "include" | "only", value: boolean, out: string[]) {
  if (mode === "exclude" && value) out.push(`${what} are excluded`);
  if (mode === "only" && !value) out.push(`only ${what}`);
}

/** Reasons the filters reject the context; empty when they all hold. */
export function filterMismatches(
  filters: WorkflowFilters,
  ctx: WorkflowContext,
  opts: { strict: boolean },
): string[] {
  const out: string[] = [];
  if (filters.repoIds.length > 0 && !ctx.repoIds.some((id) => filters.repoIds.includes(id))) {
    out.push("repo is not selected");
  }
  const branch = ctx.pr?.baseRef || ctx.push?.branch || ctx.check?.headBranch || null;
  if (filters.baseBranches.length > 0) {
    if (branch === null) {
      if (opts.strict && (ctx.pr || ctx.push)) out.push("branch unknown");
    } else if (!matchesAny(branch, filters.baseBranches)) {
      out.push(`branch ${branch} does not match ${filters.baseBranches.join(", ")}`);
    }
  }
  const labels = ctx.pr?.labels ?? ctx.issue?.labels;
  if (labels) includeExclude("label", labels, filters.labels, true, out);
  const author = ctx.pr?.author || ctx.issue?.author || ctx.push?.pusher || "";
  if (author) includeExclude("author", [author], filters.authors, true, out);
  // Check events come from CI bots; only authors of PRs, issues and pushes count.
  const bot =
    ctx.pr?.authorIsBot ??
    ctx.issue?.authorIsBot ??
    (ctx.push ? ctx.sender?.isBot : false) ??
    false;
  tri("bot authors", filters.bots, bot, out);
  if (ctx.pr) tri("draft PRs", filters.drafts, ctx.pr.draft, out);
  const { include, exclude } = filters.paths;
  if (include.length > 0 || exclude.length > 0) {
    if (ctx.files === undefined) {
      if (opts.strict) out.push("changed files unknown");
    } else {
      if (include.length > 0 && !ctx.files.some((f) => matchesAny(f, include))) {
        out.push(`no changed file matches ${include.join(", ")}`);
      }
      if (
        exclude.length > 0 &&
        ctx.files.length > 0 &&
        ctx.files.every((f) => matchesAny(f, exclude))
      ) {
        out.push("every changed file is excluded");
      }
    }
  }
  return out;
}

export interface MatchResult {
  matched: boolean;
  reasons: string[];
}

export function matchWorkflow(
  spec: Pick<WorkflowSpec, "trigger" | "filters">,
  ctx: WorkflowContext,
  opts: { strict: boolean } = { strict: false },
): MatchResult {
  const trigger = triggerMismatch(spec.trigger, ctx);
  if (trigger) return { matched: false, reasons: [trigger] };
  const reasons = filterMismatches(spec.filters, ctx, opts);
  return reasons.length > 0
    ? { matched: false, reasons }
    : { matched: true, reasons: [`${ctx.event} matches the ${spec.trigger.kind} trigger`] };
}
