/**
 * Price table for usage estimates (#40). Only used when the provider does not
 * report a cost itself (Claude's statusline `cost` and transcript `costUSD`
 * win). Subscription usage is shown at API-equivalent prices: an estimate of
 * what the tokens would cost, not what anyone is billed (D13: show only).
 *
 * Every price names the date it was checked and its source. USD per million
 * tokens, standard tier, global/short-context rates.
 */
import type { ProviderId } from "@regulus/protocol";

export interface ModelPrice {
  /** Model id, or the family prefix that dated ids start with. */
  model: string;
  provider: ProviderId;
  input: number;
  output: number;
  cacheRead: number;
  /** Cache writes (5-minute TTL for Anthropic; OpenAI bills none, so input). */
  cacheWrite: number;
  /** YYYY-MM-DD the price was checked. */
  asOf: string;
  source: string;
}

const ANTHROPIC = "https://platform.claude.com/docs/en/about-claude/pricing";
const OPENAI = "https://developers.openai.com/api/docs/pricing";
const CHECKED = "2026-09-30";

function claude(model: string, input: number, output: number, cacheRead: number): ModelPrice {
  return {
    model,
    provider: "claude-code",
    input,
    output,
    cacheRead,
    cacheWrite: input * 1.25,
    asOf: CHECKED,
    source: ANTHROPIC,
  };
}

function openai(model: string, input: number, output: number, cacheRead: number): ModelPrice {
  return {
    model,
    provider: "codex",
    input,
    output,
    cacheRead,
    cacheWrite: input,
    asOf: CHECKED,
    source: OPENAI,
  };
}

export const PRICES: readonly ModelPrice[] = [
  claude("claude-fable-5-1", 10, 50, 0.25),
  claude("claude-mythos-5-1", 10, 50, 0.25),
  claude("claude-fable-5", 10, 50, 1),
  claude("claude-mythos-5", 10, 50, 1),
  claude("claude-opus-5-5", 4, 20, 0.2),
  claude("claude-opus-5", 5, 25, 0.5),
  claude("claude-opus-4-8", 5, 25, 0.5),
  claude("claude-opus-4-7", 5, 25, 0.5),
  claude("claude-opus-4-6", 5, 25, 0.5),
  claude("claude-opus-4-5", 5, 25, 0.5),
  claude("claude-opus-4-1", 15, 75, 1.5),
  claude("claude-opus-4", 15, 75, 1.5),
  claude("claude-sonnet-5-5", 2, 10, 0.2),
  claude("claude-sonnet-5", 2, 10, 0.2),
  claude("claude-sonnet-4-6", 3, 15, 0.3),
  claude("claude-sonnet-4-5", 3, 15, 0.3),
  claude("claude-sonnet-4", 3, 15, 0.3),
  claude("claude-haiku-4-5", 1, 5, 0.1),
  openai("gpt-6-sol", 2, 10, 0.2),
  openai("gpt-6-astra", 10, 50, 1),
  openai("gpt-6-luna", 0.1, 0.5, 0.01),
  openai("gpt-5.3-codex", 1.75, 14, 0.175),
];

/** Latest check date of the table, shown on the wall. */
export const PRICES_AS_OF = PRICES.reduce((d, p) => (p.asOf > d ? p.asOf : d), "");

/**
 * What a spawn's model setting means when it is an alias or empty. Claude Code
 * aliases resolve to the newest model of the family (spawn dialog presets,
 * apps/web/src/ui/spawn/models.ts); Codex defaults to gpt-6-sol.
 */
const ALIASES: Readonly<Record<string, string>> = {
  "claude-code:": "claude-opus-5-5",
  "claude-code:default": "claude-opus-5-5",
  "claude-code:opus": "claude-opus-5-5",
  "claude-code:sonnet": "claude-sonnet-5-5",
  "claude-code:haiku": "claude-haiku-4-5",
  "claude-code:fable": "claude-fable-5-1",
  "codex:": "gpt-6-sol",
};

/** `anthropic.claude-x[1m]`, `claude-x@2026…` → `claude-x`, `claude-x-2026…`. */
export function normalizeModel(provider: ProviderId, model: string | null | undefined): string {
  let m = (model ?? "").trim().toLowerCase();
  m = m
    .replace(/^anthropic\./, "")
    .replace(/\[[^\]]*\]$/, "")
    .replace("@", "-");
  return ALIASES[`${provider}:${m}`] ?? m;
}

/** Exact id, else the longest family prefix followed by `-` (dated ids). */
export function priceFor(
  provider: ProviderId,
  model: string | null | undefined,
): ModelPrice | null {
  const id = normalizeModel(provider, model);
  if (!id) return null;
  let best: ModelPrice | null = null;
  for (const p of PRICES) {
    if (p.provider !== provider) continue;
    const hit = id === p.model || id.startsWith(`${p.model}-`);
    if (hit && (!best || p.model.length > best.model.length)) best = p;
  }
  return best;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** USD estimate for the tokens, or 0 when the model has no price here. */
export function estimateCostUsd(
  provider: ProviderId,
  model: string | null | undefined,
  t: TokenCounts,
): number {
  const p = priceFor(provider, model);
  if (!p) return 0;
  const usd =
    (t.inputTokens * p.input +
      t.outputTokens * p.output +
      t.cacheReadTokens * p.cacheRead +
      t.cacheWriteTokens * p.cacheWrite) /
    1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
