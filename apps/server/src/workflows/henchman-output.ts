/**
 * Reading what a workflow henchman answered (#155), and turning it into
 * something safe to post.
 *
 * - Claude `-p --output-format json` prints one result object with
 *   `structured_output` (from `--json-schema`) or the text in `result`,
 *   `total_cost_usd` and `usage`.
 * - `codex exec --json` prints JSONL events: `item.completed` items of type
 *   `agent_message` hold the text, `turn.completed` the token usage.
 *
 * The answer is untrusted (the henchman read attacker-written text): it is
 * validated, capped, mentions are defused so it cannot ping people, labels
 * are limited to the workflow's list, and inline comments must point at
 * lines the diff actually adds or changes.
 */
import type { WorkflowProvider } from "@regulus/protocol";
import { z } from "zod";
import type { RunUsage } from "./runs.ts";

export const SUMMARY_MAX = 60_000;
const COMMENT_MAX = 4_000;

export const HenchmanReview = z.object({
  summary: z.string().max(200_000),
  verdict: z.enum(["comment", "request_changes", "approve"]).catch("comment"),
  comments: z
    .array(
      z.object({
        path: z.string().min(1).max(500),
        line: z.number().int().positive(),
        body: z.string().min(1).max(20_000),
      }),
    )
    .max(200)
    .catch([]),
  labels: z.array(z.string().min(1).max(100)).max(50).catch([]),
});
export type HenchmanReview = z.infer<typeof HenchmanReview>;

export interface HenchmanResult {
  review: HenchmanReview | null;
  usage: RunUsage;
  /** Why no review could be read (short, no model output). */
  error: string | null;
}

const EMPTY_USAGE: RunUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
};

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null;

/** The first JSON object in a text (a fenced block or bare braces). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text);
  const candidates = [fenced?.[1], text.trim()];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c);
    } catch {
      // try the next shape
    }
  }
  return null;
}

function toReview(value: unknown): HenchmanReview | null {
  const parsed = HenchmanReview.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseClaudeOutput(stdout: string): HenchmanResult {
  let result: Raw | null = null;
  // One JSON object; tolerate stray lines before it.
  for (const line of [stdout.trim(), ...stdout.trim().split("\n").reverse()]) {
    try {
      const v = obj(JSON.parse(line));
      if (v?.type === "result") {
        result = v;
        break;
      }
    } catch {
      // not this line
    }
  }
  if (!result) return { review: null, usage: EMPTY_USAGE, error: "no result from the CLI" };
  const u = obj(result.usage);
  const usage: RunUsage = {
    inputTokens: n(u?.input_tokens),
    outputTokens: n(u?.output_tokens),
    cacheReadTokens: n(u?.cache_read_input_tokens),
    cacheWriteTokens: n(u?.cache_creation_input_tokens),
    costUsd: n(result.total_cost_usd),
  };
  if (result.is_error === true) {
    return {
      review: null,
      usage,
      error: `the CLI reported ${String(result.subtype ?? "an error")}`,
    };
  }
  const review =
    toReview(result.structured_output) ??
    (typeof result.result === "string" ? toReview(extractJson(result.result)) : null);
  return { review, usage, error: review ? null : "the answer was not the review JSON" };
}

export function parseCodexOutput(stdout: string): HenchmanResult {
  const usage = { ...EMPTY_USAGE };
  let last: string | null = null;
  let failure: string | null = null;
  for (const line of stdout.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let ev: Raw | null;
    try {
      ev = obj(JSON.parse(line));
    } catch {
      continue;
    }
    const item = obj(ev?.item);
    if (ev?.type === "item.completed" && item?.type === "agent_message") {
      if (typeof item.text === "string") last = item.text;
    } else if (ev?.type === "turn.completed") {
      const u = obj(ev.usage);
      usage.inputTokens += n(u?.input_tokens);
      usage.cacheReadTokens += n(u?.cached_input_tokens);
      usage.outputTokens += n(u?.output_tokens);
    } else if (ev?.type === "turn.failed" || ev?.type === "error") {
      failure = "the CLI reported a failed turn";
    }
  }
  const review = last ? toReview(extractJson(last)) : null;
  return {
    review,
    usage,
    error: review ? null : (failure ?? (last ? "the answer was not the review JSON" : "no answer")),
  };
}

export function parseHenchmanOutput(provider: WorkflowProvider, stdout: string): HenchmanResult {
  return provider === "claude-code" ? parseClaudeOutput(stdout) : parseCodexOutput(stdout);
}

/** `@user` and `@org/team` would notify people; a zero-width joiner keeps the text readable. */
export function defuseMentions(text: string): string {
  return text.replace(/(^|[^\w`])@([A-Za-z0-9][\w-]*)/g, "$1@‍$2");
}

export function cleanText(text: string, cap: number): string {
  const t = defuseMentions(text.replace(/\r\n/g, "\n")).replace(/<!--[\s\S]*?-->/g, "");
  return t.length > cap ? `${t.slice(0, cap)}\n\n[… cut]` : t;
}

/** Lines each file's new version adds or changes in a unified diff: where inline comments may go. */
export function commentableLines(diff: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  let file: Set<number> | null = null;
  let line = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const path = raw.slice(4).replace(/^b\//, "");
      file = path === "/dev/null" ? null : new Set();
      if (file) out.set(path, file);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!file || raw.startsWith("--- ") || raw.startsWith("diff ")) continue;
    if (raw.startsWith("+")) {
      file.add(line);
      line += 1;
    } else if (raw.startsWith(" ")) line += 1;
  }
  return out;
}

export interface PostableReview {
  body: string;
  verdict: HenchmanReview["verdict"];
  inline: { path: string; line: number; body: string }[];
  /** Inline comments that did not point at a changed line; kept in the body. */
  moved: number;
  labels: string[];
}

export function postableReview(
  review: HenchmanReview,
  opts: {
    diff: string | null;
    maxInline: number;
    inline: boolean;
    allowedLabels: readonly string[];
    labelMatches: (label: string, allowed: readonly string[]) => boolean;
  },
): PostableReview {
  const lines = opts.diff ? commentableLines(opts.diff) : new Map<string, Set<number>>();
  const inline: PostableReview["inline"] = [];
  const extra: string[] = [];
  for (const c of review.comments) {
    const body = cleanText(c.body, COMMENT_MAX);
    if (opts.inline && inline.length < opts.maxInline && lines.get(c.path)?.has(c.line)) {
      inline.push({ path: c.path, line: c.line, body });
    } else {
      extra.push(`- \`${c.path.replace(/`/g, "")}:${c.line}\`: ${body.replace(/\n+/g, " ")}`);
    }
  }
  let body = cleanText(review.summary, SUMMARY_MAX);
  if (extra.length > 0) body += `\n\n**More notes**\n${extra.slice(0, 100).join("\n")}`;
  const labels = [
    ...new Set(review.labels.filter((l) => opts.labelMatches(l, opts.allowedLabels))),
  ].slice(0, 10);
  return { body, verdict: review.verdict, inline, moved: extra.length, labels };
}
