/**
 * Provider choices for the spawn dialog (SPEC §7, §10 M1: Claude Code and
 * Codex; the others arrive in M4) with model and effort presets. Presets are
 * suggestions: the model is free text, and so is Codex's effort. Claude's
 * effort must be one of the values `claude --effort` accepts, which the
 * adapter checks again (packages/agent-adapters claude-code/spawn.ts).
 */
import type { ProviderId } from "@regulus/protocol";

export interface ProviderChoice {
  id: ProviderId;
  label: string;
  /** Milestone the provider arrives in, when not available yet. */
  comingIn?: string;
}

export const PROVIDER_CHOICES: readonly ProviderChoice[] = [
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "gemini-cli", label: "Gemini CLI", comingIn: "M4" },
  { id: "opencode", label: "OpenCode", comingIn: "M4" },
  { id: "kimi-code", label: "Kimi Code", comingIn: "M4" },
  { id: "custom", label: "Custom", comingIn: "M4" },
];

export const SPAWNABLE_PROVIDERS: ReadonlySet<ProviderId> = new Set(
  PROVIDER_CHOICES.filter((p) => !p.comingIn).map((p) => p.id),
);

export function providerLabel(id: ProviderId): string {
  return PROVIDER_CHOICES.find((p) => p.id === id)?.label ?? id;
}

export interface ModelPresets {
  models: readonly string[];
  defaultModel: string;
  efforts: readonly string[];
  /** Empty = let the CLI decide. */
  defaultEffort: string;
  /** Effort must be one of `efforts` (otherwise free text is allowed). */
  strictEffort: boolean;
}

/** Mirrors CLAUDE_EFFORTS in packages/agent-adapters/src/claude-code/spawn.ts. */
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultracode"] as const;

export const MODEL_PRESETS: Readonly<Partial<Record<ProviderId, ModelPresets>>> = {
  // Aliases resolve to the newest model of each family in the installed CLI.
  "claude-code": {
    models: ["opus", "sonnet", "haiku", "opusplan"],
    defaultModel: "opus",
    efforts: CLAUDE_EFFORTS,
    defaultEffort: "",
    strictEffort: true,
  },
  codex: {
    models: ["gpt-5-codex", "gpt-5", "gpt-5-codex-mini"],
    defaultModel: "gpt-5-codex",
    efforts: ["minimal", "low", "medium", "high"],
    defaultEffort: "",
    strictEffort: false,
  },
};

export function presetsFor(provider: ProviderId): ModelPresets {
  return (
    MODEL_PRESETS[provider] ?? {
      models: [],
      defaultModel: "",
      efforts: [],
      defaultEffort: "",
      strictEffort: false,
    }
  );
}
