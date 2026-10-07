/**
 * Model and effort presets (the spawn dialog, and the office agent form of #280): the only place to update when
 * a provider ships new models. Claude Code takes its CLI aliases, which the
 * installed CLI resolves to the newest model of that family; Codex takes model
 * ids. Effort levels are per model, and the default is the provider's own.
 *
 * Sources (checked 2026-09-29):
 * - Claude Code: https://code.claude.com/docs/en/model-config (aliases,
 *   effort levels per model, `claude --effort` values, default effort medium
 *   for Opus 5.5 / Sonnet 5.5; Haiku 4.5 has no effort setting).
 * - Codex: https://learn.chatgpt.com/docs/models (gpt-6-sol is the default;
 *   reasoning efforts and defaults per model).
 */
import type { ProviderId } from "./enums.ts";

export const MODEL_TIERS = ["cheap", "strong"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export interface ModelPreset {
  /** Passed to the CLI as-is (`--model` / `-c model=`). */
  id: string;
  label: string;
  /** One short line: what it is good for. */
  hint: string;
  /** Effort levels the model accepts, lowest first; empty = no effort setting. */
  efforts: readonly string[];
  /** Preselected effort (the provider's own default for this model). */
  defaultEffort?: string;
  /** Marked in pickers that say so (#280): the cheap and the strong choice of a provider. */
  tier?: ModelTier;
}

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  models: readonly ModelPreset[];
  /** Preselected model. */
  defaultModel: string;
}

const CLAUDE_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    defaultModel: "opus",
    models: [
      {
        id: "opus",
        label: "Opus",
        hint: "Best for most coding work",
        efforts: CLAUDE_LEVELS,
        defaultEffort: "medium",
        tier: "strong",
      },
      {
        id: "sonnet",
        label: "Sonnet",
        hint: "Fast everyday coding",
        efforts: CLAUDE_LEVELS,
        defaultEffort: "medium",
      },
      { id: "haiku", label: "Haiku", hint: "Quick, simple tasks", efforts: [], tier: "cheap" },
      {
        id: "fable",
        label: "Fable",
        hint: "Hardest, longest tasks",
        efforts: CLAUDE_LEVELS,
        defaultEffort: "high",
      },
    ],
  },
  {
    id: "codex",
    label: "Codex",
    defaultModel: "gpt-6-sol",
    models: [
      {
        id: "gpt-6-sol",
        label: "GPT-6 Sol",
        hint: "Complex coding and agent work",
        efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
        defaultEffort: "medium",
      },
      {
        id: "gpt-6-astra",
        label: "GPT-6 Astra",
        hint: "Most capable, deepest reasoning",
        efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
        defaultEffort: "low",
      },
      {
        id: "gpt-6-luna",
        label: "GPT-6 Luna",
        hint: "Efficient, focused tasks",
        efforts: ["low", "medium", "high", "xhigh", "max"],
        defaultEffort: "high",
      },
    ],
  },
];
