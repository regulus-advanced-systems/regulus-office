/**
 * Statusline JSON → usage and limit samples. Claude Code pipes this JSON to
 * the statusline command on every update
 * (https://code.claude.com/docs/en/statusline#available-data); the generated
 * forwarder POSTs it to the office unchanged.
 *
 * - `rate_limits.five_hour` / `seven_day` → `LimitSample`s (only present for
 *   Pro/Max subscribers after the first response; `resets_at` is epoch seconds).
 *   `spend_limit` is not mapped: its period is gateway-defined and its
 *   percentage may exceed 100, which no `LimitWindowKind` describes.
 * - `cost.total_cost_usd` is cumulative per session, and the statusline also
 *   re-runs on events that do not add usage, so a `UsageSample` is emitted
 *   only when the session's cost grew since the last payload, carrying the
 *   cost delta and the last API call's token counts (`context_window.current_usage`).
 */
import type { LimitSample, UsageSample } from "@regulus/protocol";
import { count, isObject, type Json, num, obj, str } from "./payload.ts";

const WINDOWS = [
  ["five_hour", "five_hour"],
  ["seven_day", "seven_day"],
] as const;

export function limitSamplesFromStatusline(payload: unknown, now: number): LimitSample[] {
  const limits = isObject(payload) ? obj(payload, "rate_limits") : undefined;
  const out: LimitSample[] = [];
  for (const [field, windowKind] of WINDOWS) {
    const window = obj(limits, field);
    const used = num(window, "used_percentage");
    if (used === undefined) continue;
    const resets = num(window, "resets_at");
    out.push({
      windowKind,
      usedPct: Math.min(100, Math.max(0, used)),
      ...(resets !== undefined && resets > 0 ? { resetsAt: Math.round(resets * 1000) } : {}),
      observedAt: now,
      source: "statusline",
    });
  }
  return out;
}

/** Remembers each agent's last cumulative cost so only growth becomes usage. */
export class StatuslineUsageTracker {
  readonly #last = new Map<string, { sessionId: string; cost: number }>();

  sample(agentId: string, payload: unknown, now: number): UsageSample | null {
    if (!isObject(payload)) return null;
    const cost = num(obj(payload, "cost"), "total_cost_usd");
    if (cost === undefined || cost < 0) return null;
    const sessionId = str(payload, "session_id") ?? "";
    const prev = this.#last.get(agentId);
    const base = prev && prev.sessionId === sessionId ? prev.cost : 0;
    // A lower total within the same session means a reset (e.g. /clear); rebase.
    if (prev && prev.sessionId === sessionId && cost < base) {
      this.#last.set(agentId, { sessionId, cost });
      return null;
    }
    this.#last.set(agentId, { sessionId, cost });
    const delta = cost - base;
    if (delta <= 0) return null;
    return {
      ts: now,
      ...tokens(obj(obj(payload, "context_window"), "current_usage")),
      costUsdEstimate: round(delta),
      source: "statusline",
    };
  }

  forget(agentId: string): void {
    this.#last.delete(agentId);
  }
}

function tokens(usage: Json | undefined) {
  return {
    inputTokens: count(num(usage, "input_tokens")),
    outputTokens: count(num(usage, "output_tokens")),
    cacheReadTokens: count(num(usage, "cache_read_input_tokens")),
    cacheWriteTokens: count(num(usage, "cache_creation_input_tokens")),
  };
}

function round(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}
