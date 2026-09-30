/**
 * The facts a workflow looks at (#155), taken from one verified GitHub event
 * of the #35 event bus (or a schedule tick). Everything in here comes from
 * GitHub and is untrusted: titles, bodies, comments and branch names are
 * prompt-injection vectors and are only ever used as data (filters, the
 * prompt's clearly marked untrusted sections).
 *
 * Large text is capped so a context can be stored with its run and replayed
 * by a dry run.
 */
import type { AnyGitHubEvent } from "../github/events.ts";

const TEXT_CAP = 20_000;
const MAX_LABELS = 50;
const MAX_PATHS = 3_000;

/** Hidden marker in everything the office posts; comments carrying it never trigger a workflow. */
export const OFFICE_MARKER = "<!-- regulus-office:workflow -->";

export interface PullFacts {
  number: number;
  title: string;
  body: string;
  author: string;
  authorIsBot: boolean;
  draft: boolean;
  state: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  /** `owner/name` of the head repo; null when the fork was deleted. */
  headRepo: string | null;
  /** Head in another repo than the base (or unknown): a fork PR. */
  fork: boolean;
  labels: string[];
  url: string;
}

export interface IssueFacts {
  number: number;
  title: string;
  body: string;
  author: string;
  authorIsBot: boolean;
  labels: string[];
  url: string;
  /** The "issue" is a pull request (issue_comment on a PR). */
  isPull: boolean;
}

export interface CommentFacts {
  author: string;
  authorIsBot: boolean;
  body: string;
  url: string;
  /** Posted by the office itself (hidden marker): never a trigger. */
  fromOffice: boolean;
}

export interface CheckFacts {
  conclusion: string | null;
  headSha: string;
  headBranch: string | null;
  /** Same-repo PRs GitHub associates with the suite. */
  prNumbers: number[];
}

export interface PushFacts {
  ref: string;
  branch: string | null;
  after: string;
  deleted: boolean;
  pusher: string;
  /** Added, modified and removed paths of the pushed commits (capped). */
  paths: string[];
}

export interface WorkflowContext {
  deliveryId: string;
  /** `pull_request.opened`, `push`, `schedule`, … */
  event: string;
  name: string;
  action: string | null;
  source: "webhook" | "poll" | "schedule";
  receivedAt: number;
  repo: { owner: string; name: string; fullName: string } | null;
  repoIds: string[];
  floorIds: string[];
  sender: { login: string; isBot: boolean } | null;
  fromOfficeApp: boolean;
  stale: boolean;
  pr?: PullFacts;
  issue?: IssueFacts;
  comment?: CommentFacts;
  /** The label a `labeled` event added. */
  label?: string;
  check?: CheckFacts;
  push?: PushFacts;
  /** Changed files once known (PR files are fetched by the run). */
  files?: string[];
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null;
const str = (v: unknown, cap = 300): string => (typeof v === "string" ? v.slice(0, cap) : "");
const num = (v: unknown): number | null => (typeof v === "number" && v > 0 ? v : null);

export function capText(text: string, cap = TEXT_CAP): string {
  return text.length > cap ? `${text.slice(0, cap)}\n[… cut at ${cap} characters]` : text;
}

export function isBotAccount(account: unknown): boolean {
  const a = obj(account);
  const login = str(a?.login);
  return a?.type === "Bot" || /\[bot\]$/i.test(login);
}

function labelsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((l) => (typeof l === "string" ? l : str(obj(l)?.name, 100)))
    .filter(Boolean)
    .slice(0, MAX_LABELS);
}

export function pullFacts(raw: unknown, repoFullName: string | null): PullFacts | undefined {
  const p = obj(raw);
  const number = num(p?.number);
  if (!p || number === null) return undefined;
  const base = obj(p.base);
  const head = obj(p.head);
  const headRepo = str(obj(head?.repo)?.full_name, 200) || null;
  const baseRepo = str(obj(base?.repo)?.full_name, 200) || repoFullName;
  return {
    number,
    title: str(p.title, 300),
    body: capText(str(p.body, TEXT_CAP + 1)),
    author: str(obj(p.user)?.login, 100),
    authorIsBot: isBotAccount(p.user),
    draft: p.draft === true,
    state: str(p.state, 20),
    baseRef: str(base?.ref, 250),
    headRef: str(head?.ref, 250),
    headSha: str(head?.sha, 64),
    headRepo,
    // Unknown head repo counts as a fork: the safe side.
    fork: !headRepo || !baseRepo || headRepo.toLowerCase() !== baseRepo.toLowerCase(),
    labels: labelsOf(p.labels),
    url: str(p.html_url, 500),
  };
}

function issueFacts(raw: unknown): IssueFacts | undefined {
  const i = obj(raw);
  const number = num(i?.number);
  if (!i || number === null) return undefined;
  return {
    number,
    title: str(i.title, 300),
    body: capText(str(i.body, TEXT_CAP + 1)),
    author: str(obj(i.user)?.login, 100),
    authorIsBot: isBotAccount(i.user),
    labels: labelsOf(i.labels),
    url: str(i.html_url, 500),
    isPull: obj(i.pull_request) !== null,
  };
}

function commentFacts(raw: unknown): CommentFacts | undefined {
  const c = obj(raw);
  if (!c) return undefined;
  const body = str(c.body, TEXT_CAP + 1);
  return {
    author: str(obj(c.user)?.login, 100),
    authorIsBot: isBotAccount(c.user),
    body: capText(body),
    url: str(c.html_url, 500),
    fromOffice: body.includes(OFFICE_MARKER),
  };
}

function checkFacts(name: string, payload: Raw): CheckFacts | undefined {
  const run = obj(payload.check_run);
  const suite = name === "check_suite" ? obj(payload.check_suite) : obj(run?.check_suite);
  const source = name === "check_suite" ? suite : run;
  if (!source) return undefined;
  const prs = Array.isArray(source.pull_requests) ? source.pull_requests : [];
  return {
    conclusion: str(source.conclusion, 30) || null,
    headSha: str(source.head_sha ?? suite?.head_sha, 64),
    headBranch: str(suite?.head_branch, 250) || null,
    prNumbers: prs
      .map((p) => num(obj(p)?.number))
      .filter((n): n is number => n !== null)
      .slice(0, 10),
  };
}

function pushFacts(payload: Raw): PushFacts {
  const ref = str(payload.ref, 300);
  const paths = new Set<string>();
  for (const c of Array.isArray(payload.commits) ? payload.commits : []) {
    for (const key of ["added", "modified", "removed"]) {
      const list = obj(c)?.[key];
      for (const p of Array.isArray(list) ? list : []) {
        if (typeof p === "string" && paths.size < MAX_PATHS) paths.add(p.slice(0, 500));
      }
    }
  }
  return {
    ref,
    branch: ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null,
    after: str(payload.after, 64),
    deleted: payload.deleted === true || /^0+$/.test(str(payload.after, 64)),
    pusher: str(obj(payload.pusher)?.name, 100) || str(obj(payload.sender)?.login, 100),
    paths: [...paths],
  };
}

export function contextFromEvent(event: AnyGitHubEvent): WorkflowContext {
  const payload = event.payload as Raw;
  const full = event.repo?.fullName ?? null;
  const ctx: WorkflowContext = {
    deliveryId: event.deliveryId,
    event: event.action ? `${event.name}.${event.action}` : event.name,
    name: event.name,
    action: event.action,
    source: event.source,
    receivedAt: event.receivedAt,
    repo: event.repo,
    repoIds: event.repoIds,
    floorIds: event.floorIds,
    sender: event.sender ? { login: event.sender.login, isBot: event.sender.type === "Bot" } : null,
    fromOfficeApp: event.fromOfficeApp,
    stale: event.stale,
  };
  const label = str(obj(payload.label)?.name, 100);
  if (label) ctx.label = label;
  switch (event.name) {
    case "pull_request":
    case "pull_request_review":
      ctx.pr = pullFacts(payload.pull_request, full);
      if (event.name === "pull_request_review") ctx.comment = commentFacts(payload.review);
      break;
    case "issues":
      ctx.issue = issueFacts(payload.issue);
      break;
    case "issue_comment":
      ctx.issue = issueFacts(payload.issue);
      ctx.comment = commentFacts(payload.comment);
      break;
    case "check_suite":
    case "check_run":
      ctx.check = checkFacts(event.name, payload);
      break;
    case "push":
      ctx.push = pushFacts(payload);
      ctx.files = ctx.push.paths;
      break;
  }
  return ctx;
}

/** One line for lists: `octo/app#12 Fix the parser`. */
export function contextSummary(ctx: WorkflowContext): string {
  const repo = ctx.repo?.fullName ?? "";
  if (ctx.pr) return `${repo}#${ctx.pr.number} ${ctx.pr.title}`.slice(0, 300);
  if (ctx.issue) return `${repo}#${ctx.issue.number} ${ctx.issue.title}`.slice(0, 300);
  if (ctx.push) return `${repo} ${ctx.push.ref} → ${ctx.push.after.slice(0, 7)}`.slice(0, 300);
  if (ctx.check) {
    return `${repo} ${ctx.check.conclusion ?? "check"} at ${ctx.check.headSha.slice(0, 7)}`.slice(
      0,
      300,
    );
  }
  return `${repo} ${ctx.event}`.trim().slice(0, 300);
}

/** `/office <command>` on any line of a comment or review body (first one wins). */
export function officeCommand(body: string): string | null {
  const m = /^[ \t]*\/office[ \t]+([a-z][a-z0-9-]{0,31})\b/im.exec(body);
  return m?.[1]?.toLowerCase() ?? null;
}
