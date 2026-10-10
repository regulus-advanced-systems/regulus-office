/**
 * What a board helper tells whoever walks up to it (SPEC §10 M5 "brief the
 * visitor"; #56): its board in a headline and a few lines, made from the board
 * as the office has it. Pure, and no model runs for it, so a brief is free and
 * the same for everyone who may see the room.
 *
 * Nothing here goes beyond what the board itself shows a person in the room:
 * card numbers and titles, counts, and the queue's own short reasons.
 */
import {
  type IssueCard,
  KIOSK_BRIEF_LIMITS,
  type KioskBoard,
  type PullCard,
  type QueueSettings,
  type QueueTask,
} from "@regulus/protocol";

export interface BriefFacts {
  issues: readonly IssueCard[];
  pulls: readonly PullCard[];
  queue: { tasks: readonly QueueTask[]; settings: QueueSettings } | null;
  /** Issue and PR numbers a henchman is on right now, per repo (`<repoId>#<number>`). */
  working: { issues: ReadonlySet<string>; pulls: ReadonlySet<string> };
  now: number;
}

export interface BriefText {
  headline: string;
  lines: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** "3 h ago", "2 d ago", "just now". */
export function ago(now: number, then: number): string {
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

const keyOf = (card: { repoId: string; number: number }) => `${card.repoId}#${card.number}`;
const card = (c: { number: number; title: string }, note: string) =>
  `#${c.number} ${clip(c.title, 90)}${note ? ` (${note})` : ""}`;
const TOP = 3;

function issuesBrief(facts: BriefFacts): BriefText {
  const open = facts.issues.filter((i) => i.state === "open");
  const closed = facts.issues.length - open.length;
  if (open.length === 0) {
    return {
      headline: "No open issues.",
      lines: closed > 0 ? [`${plural(closed, "issue")} closed in the last two days.`] : [],
    };
  }
  const taken = open.filter((i) => facts.working.issues.has(keyOf(i)));
  const unassigned = open.filter((i) => i.assignees.length === 0 && !taken.includes(i));
  const lines = [
    `${plural(taken.length, "issue has", "issues have")} a henchman on ${taken.length === 1 ? "it" : "them"}; ${unassigned.length} ${unassigned.length === 1 ? "has" : "have"} nobody assigned.`,
  ];
  if (closed > 0) lines.push(`${plural(closed, "issue")} closed in the last two days.`);
  const free = open.filter((i) => !taken.includes(i));
  if (free.length > 0) {
    lines.push("Most recently touched, with no henchman on them:");
    for (const i of free.slice(0, TOP)) lines.push(card(i, ago(facts.now, i.updatedAt)));
  }
  return { headline: `${plural(open.length, "open issue")}.`, lines };
}

function pullsBrief(facts: BriefFacts): BriefText {
  const open = facts.pulls.filter((p) => p.state === "open");
  const merged = facts.pulls.filter((p) => p.merged).length;
  if (open.length === 0) {
    return {
      headline: "No open pull requests.",
      lines: merged > 0 ? [`${plural(merged, "pull request")} merged in the last two days.`] : [],
    };
  }
  const drafts = open.filter((p) => p.draft).length;
  const failing = open.filter((p) => p.checksState === "failure");
  const changes = open.filter((p) => p.reviewState === "changes_requested");
  const approved = open.filter((p) => p.reviewState === "approved" && p.checksState !== "failure");
  const lines = [
    `${failing.length} with failing checks, ${changes.length} with changes requested, ${approved.length} approved and ready.`,
  ];
  if (merged > 0) lines.push(`${plural(merged, "pull request")} merged in the last two days.`);
  const needs = [...new Set([...failing, ...changes])];
  if (needs.length > 0) {
    lines.push("Needing attention:");
    for (const p of needs.slice(0, TOP)) {
      const why = [
        p.checksState === "failure" ? "checks failing" : "",
        p.reviewState === "changes_requested" ? "changes requested" : "",
        facts.working.pulls.has(keyOf(p)) ? "a henchman is on it" : "",
      ].filter(Boolean);
      lines.push(card(p, why.join(", ")));
    }
  } else if (approved.length > 0) {
    lines.push("Ready to merge:");
    for (const p of approved.slice(0, TOP)) lines.push(card(p, ago(facts.now, p.updatedAt)));
  }
  return {
    headline: `${plural(open.length, "open pull request")}${drafts > 0 ? `, ${plural(drafts, "draft")}` : ""}.`,
    lines,
  };
}

const taskName = (t: QueueTask) =>
  clip(
    t.title || (t.refNumber > 0 ? `${t.kind === "pr" ? "PR" : "Issue"} #${t.refNumber}` : "A task"),
    90,
  );

function queueBrief(facts: BriefFacts): BriefText {
  if (!facts.queue) return { headline: "The task queue cannot be read right now.", lines: [] };
  const { tasks, settings } = facts.queue;
  const queued = tasks.filter((t) => t.state === "queued");
  const running = tasks.filter((t) => t.state === "running");
  const failed = tasks.filter((t) => t.state === "failed");
  const lines = [`At most ${settings.maxRunning} run at once, ${settings.maxPerOwner} per person.`];
  if (running.length > 0) {
    lines.push("Running now:");
    for (const t of running.slice(0, TOP))
      lines.push(`${taskName(t)} (${t.ownerName || "someone"})`);
  }
  if (queued.length > 0) {
    lines.push("Next up:");
    for (const t of queued.slice(0, TOP)) {
      lines.push(`${taskName(t)}${t.reason ? ` (waiting: ${clip(t.reason, 50)})` : ""}`);
    }
  }
  if (failed.length > 0) lines.push(`${plural(failed.length, "task")} failed recently.`);
  return {
    headline:
      queued.length + running.length === 0
        ? "The queue is empty."
        : `${plural(queued.length, "task")} waiting, ${running.length} running.`,
    lines,
  };
}

export function buildBrief(board: KioskBoard, facts: BriefFacts): BriefText {
  const text =
    board === "issues"
      ? issuesBrief(facts)
      : board === "pulls"
        ? pullsBrief(facts)
        : queueBrief(facts);
  return {
    headline: clip(text.headline, 200),
    lines: text.lines
      .slice(0, KIOSK_BRIEF_LIMITS.linesMax)
      .map((line) => clip(line, KIOSK_BRIEF_LIMITS.lineMax)),
  };
}
