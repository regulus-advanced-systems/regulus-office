/**
 * What an office agent "runs on" (#280; SPEC §8, D2, D3): the one choice in
 * the agent form that stands for a provider and a credential together, and the
 * models known for that choice.
 *
 * A choice is the owner's own Claude subscription login, or one key profile
 * that the session engine can use: an Anthropic API key, **DeepSeek** (which
 * runs through Claude Code against DeepSeek's Anthropic-compatible API), a
 * Z.AI or Kimi plan key, or a custom Anthropic-compatible endpoint.
 *
 * - A personal agent may run on its owner's login, its owner's own keys, or
 *   the office key its owner may use for henchmen (`office:<provider>`).
 * - A shared agent runs on one office-wide key, picked by name (its profile
 *   id); never on anybody's login (SPEC §8 rule 3).
 *
 * The model lists are not a second list: Claude's come from
 * `PROVIDER_PRESETS` (model-presets.ts, also the spawn dialog's), the others
 * from the key preset's own `modelOverrides` (provider-connect.ts).
 */
import { z } from "zod";
import { CREDENTIAL_PROFILE_OWNERS } from "./credentials-api.ts";
import { PROVIDER_IDS } from "./enums.ts";
import { type ModelTier, PROVIDER_PRESETS } from "./model-presets.ts";
import { KEY_PRESET_IDS, KEY_PRESETS, type KeyPresetId } from "./provider-connect.ts";

/** What the caller can run an office agent on right now. */
export const OFFICE_AGENT_RUNS_ON_API_PATH = "/api/office-agents/runs-on";

/** Providers the CLI session engine can run today (Codex is a follow-up). */
export const CLI_SESSION_PROVIDERS = ["claude-code"] as const;

/** `login`: the owner's own subscription login in their runner. Else a key preset. */
export const RUNS_ON_KINDS = ["login", ...KEY_PRESET_IDS] as const;
export type RunsOnKind = (typeof RUNS_ON_KINDS)[number];

/** Key presets the session engine can use (those that run through one of its CLIs). */
export function sessionEngineRuns(preset: KeyPresetId): boolean {
  return (CLI_SESSION_PROVIDERS as readonly string[]).includes(KEY_PRESETS[preset].provider);
}

/** Plain names, as the form and the agent card show them. */
export const RUNS_ON_LABELS: Readonly<Record<RunsOnKind, string>> = {
  login: "Claude subscription",
  anthropic: "Claude (Anthropic API key)",
  openai: "OpenAI API key",
  gemini: "Gemini API key",
  deepseek: "DeepSeek",
  zai: "Z.AI GLM Coding Plan",
  kimi: "Kimi Code plan",
  "custom-claude": "Other Anthropic-compatible endpoint",
  "custom-codex": "Other Responses-API endpoint",
};

export interface AgentModelChoice {
  /** Stored as the agent's model and passed to the CLI as `--model`. */
  id: string;
  label: string;
  /** One short line: what it is good for. */
  hint: string;
  tier?: ModelTier;
}

/** Names for model ids that appear in key presets. Anything else is shown by its id. */
const MODEL_NAMES: Readonly<Record<string, { label: string; hint: string }>> = {
  "deepseek-flash": { label: "DeepSeek Flash", hint: "Fast and inexpensive, for everyday work" },
  "deepseek-v4-pro": { label: "DeepSeek V4 Pro", hint: "DeepSeek's most capable model" },
  "k3-256k": { label: "Kimi K3", hint: "The Kimi Code plan's model" },
};

const CLAUDE_MODELS: readonly AgentModelChoice[] = (
  PROVIDER_PRESETS.find((p) => p.id === "claude-code")?.models ?? []
).map((m) => ({ id: m.id, label: m.label, hint: m.hint, ...(m.tier ? { tier: m.tier } : {}) }));

/**
 * The known models for a choice. A key preset with its own model names
 * (DeepSeek, Kimi) lists those, the one behind `opus` marked strong and the
 * one behind `haiku` cheap; every other choice lists Claude Code's own names.
 */
export function agentModelsFor(kind: RunsOnKind): readonly AgentModelChoice[] {
  const overrides = kind === "login" ? undefined : KEY_PRESETS[kind].modelOverrides;
  if (!overrides) return CLAUDE_MODELS;
  const ids = [...new Set(Object.values(overrides))];
  const strong = overrides.opus;
  const cheap = overrides.haiku;
  return ids
    .map((id): AgentModelChoice => {
      const tier: ModelTier | undefined =
        ids.length < 2 ? undefined : id === cheap ? "cheap" : id === strong ? "strong" : undefined;
      return {
        id,
        label: MODEL_NAMES[id]?.label ?? id,
        hint: MODEL_NAMES[id]?.hint ?? "",
        ...(tier ? { tier } : {}),
      };
    })
    .sort((a, b) => Number(b.tier === "strong") - Number(a.tier === "strong"));
}

/** Preselected when a choice is picked: the preset's everyday model, else Sonnet. */
export function defaultAgentModel(kind: RunsOnKind): string {
  const models = agentModelsFor(kind);
  const overrides = kind === "login" ? undefined : KEY_PRESETS[kind].modelOverrides;
  const wanted = overrides ? (overrides.default ?? "") : "sonnet";
  return (models.find((m) => m.id === wanted) ?? models[0])?.id ?? "sonnet";
}

/** The model's name as the card shows it; a custom id is shown as typed. */
export function agentModelLabel(kind: RunsOnKind | undefined, model: string): string {
  const known = [...(kind ? agentModelsFor(kind) : []), ...CLAUDE_MODELS];
  return known.find((m) => m.id === model)?.label ?? MODEL_NAMES[model]?.label ?? model;
}

/** One thing an agent can run on. Never carries a key, an envelope or a base URL. */
export const RunsOnChoice = z.object({
  /** Sent as the agent's `profileId`; absent = the owner's own login. */
  profileId: z.string().min(1).max(64).optional(),
  kind: z.enum(RUNS_ON_KINDS),
  /** The key profile's own name ("" for the login). */
  label: z.string().max(200),
  owner: z.enum(CREDENTIAL_PROFILE_OWNERS),
  provider: z.enum(PROVIDER_IDS),
});
export type RunsOnChoice = z.infer<typeof RunsOnChoice>;

export const OfficeAgentRunsOnResponse = z.object({
  /** For the caller's own personal agent: their keys, then the office key they may use. */
  personal: z.array(RunsOnChoice),
  /** For a shared agent: every office-wide key, by name. Empty unless the caller is an owner or admin. */
  shared: z.array(RunsOnChoice),
});
export type OfficeAgentRunsOnResponse = z.infer<typeof OfficeAgentRunsOnResponse>;

/** What an agent runs on, as everyone who sees its card may know it: the kind, never the key's name. */
export const OfficeAgentRunsOn = z.object({
  /** `unknown`: its key was removed, or is of a kind this office no longer knows. */
  kind: z.enum([...RUNS_ON_KINDS, "unknown"]),
  /** Paid by the office's key rather than the owner's own login or key. */
  officeKey: z.boolean(),
  /** The key's name; only for viewers who may configure the agent. */
  label: z.string().max(200).optional(),
});
export type OfficeAgentRunsOn = z.infer<typeof OfficeAgentRunsOn>;
