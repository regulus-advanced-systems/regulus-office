/**
 * Usage from Claude Code transcripts (ccusage-style scan). Transcripts live at
 * `~/.claude/projects/<project>/<session-id>.jsonl`
 * (https://code.claude.com/docs/en/sessions); assistant entries carry
 * `message.usage`. The format is declared unstable, so only usage fields are
 * read, every line is parsed defensively, and nothing else in `~/.claude`
 * (in particular `.credentials.json`) is ever listed or opened (SPEC §8).
 */
import type { UsageSample } from "@regulus/protocol";
import { count, isObject, num, obj, str } from "./payload.ts";

export function transcriptRoot(home: string): string {
  return `${home.replace(/\/+$/, "")}/.claude/projects`;
}

/**
 * Usage samples from transcript lines; `seen` dedupes streamed duplicates
 * (one API response is written as several lines with the same message id).
 * `fallbackSessionId` (the file name) is used when a line has no `sessionId`.
 */
export function parseTranscriptUsage(
  text: string,
  seen: Set<string> = new Set(),
  since?: number,
  fallbackSessionId?: string,
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
    const model = str(message, "model");
    const sessionId = str(entry, "sessionId") ?? fallbackSessionId;
    out.push({
      ts,
      inputTokens: count(num(usage, "input_tokens")),
      outputTokens: count(num(usage, "output_tokens")),
      cacheReadTokens: count(num(usage, "cache_read_input_tokens")),
      cacheWriteTokens: count(num(usage, "cache_creation_input_tokens")),
      ...(cost !== undefined && cost >= 0 ? { costUsdEstimate: cost } : {}),
      source: "transcript",
      ...(model && model.length <= 128 && model !== "<synthetic>" ? { model } : {}),
      ...(sessionId && sessionId.length <= 128 ? { sessionId } : {}),
      ...(key !== ":" && key.length <= 256 ? { dedupeKey: key } : {}),
    });
  }
  return out;
}
