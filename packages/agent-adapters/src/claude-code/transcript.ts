/**
 * Usage from Claude Code transcripts (ccusage-style scan). Transcripts live at
 * `~/.claude/projects/<project>/<session-id>.jsonl`
 * (https://code.claude.com/docs/en/sessions); assistant entries carry
 * `message.usage`. The format is declared unstable, so only usage fields are
 * read, every line is parsed defensively, and nothing else in `~/.claude`
 * (in particular `.credentials.json`) is ever listed or opened (SPEC §8).
 */
import type { UsageSample } from "@regulus/protocol";
import type { RunnerOps } from "../types.ts";
import { count, isObject, num, obj, str } from "./payload.ts";

export function transcriptRoot(home: string): string {
  return `${home.replace(/\/+$/, "")}/.claude/projects`;
}

const SAFE_NAME = /^[^/\0]+$/;

/** Usage samples from one transcript's text; `seen` dedupes streamed duplicates. */
export function parseTranscriptUsage(
  text: string,
  seen: Set<string> = new Set(),
  since?: number,
): UsageSample[] {
  const out: UsageSample[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(entry) || str(entry, "type") !== "assistant") continue;
    const message = obj(entry, "message");
    const usage = obj(message, "usage");
    if (!usage) continue;
    const ts = Date.parse(str(entry, "timestamp") ?? "");
    if (!Number.isFinite(ts) || (since !== undefined && ts <= since)) continue;
    const key = `${str(message, "id") ?? ""}:${str(entry, "requestId") ?? str(entry, "uuid") ?? ""}`;
    if (key !== ":" && seen.has(key)) continue;
    seen.add(key);
    const cost = num(entry, "costUSD");
    out.push({
      ts,
      inputTokens: count(num(usage, "input_tokens")),
      outputTokens: count(num(usage, "output_tokens")),
      cacheReadTokens: count(num(usage, "cache_read_input_tokens")),
      cacheWriteTokens: count(num(usage, "cache_creation_input_tokens")),
      ...(cost !== undefined && cost >= 0 ? { costUsdEstimate: cost } : {}),
      source: "transcript",
    });
  }
  return out;
}

/** Scans every project's `*.jsonl` under the runner HOME's transcript root. */
export async function* scanTranscripts(
  runner: RunnerOps,
  home: string,
  opts: { since?: number; signal?: AbortSignal } = {},
): AsyncIterable<UsageSample> {
  const root = transcriptRoot(home);
  const seen = new Set<string>();
  for (const project of await runner.listDir(root)) {
    if (opts.signal?.aborted) return;
    if (!SAFE_NAME.test(project) || project === "." || project === "..") continue;
    const dir = `${root}/${project}`;
    for (const file of await runner.listDir(dir)) {
      if (opts.signal?.aborted) return;
      if (!file.endsWith(".jsonl") || !SAFE_NAME.test(file)) continue;
      const text = await runner.readTextFile(`${dir}/${file}`);
      if (text === null) continue;
      yield* parseTranscriptUsage(text, seen, opts.since);
    }
  }
}
