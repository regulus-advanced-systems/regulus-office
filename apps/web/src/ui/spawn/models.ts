/**
 * Model and effort presets for the spawn dialog. The data itself lives in
 * `@regulus/protocol` (model-presets.ts), the only place to update when a
 * provider ships new models; the office agent form (#280) reads the same list.
 */
import {
  type ModelPreset,
  PROVIDER_PRESETS,
  type ProviderId,
  type ProviderPreset,
} from "@regulus/protocol";

export { type ModelPreset, PROVIDER_PRESETS, type ProviderPreset };

const EFFORT_LABELS: Readonly<Record<string, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultra: "Ultra",
};

export function effortLabel(effort: string): string {
  return EFFORT_LABELS[effort] ?? effort;
}

export const SPAWNABLE_PROVIDERS: ReadonlySet<ProviderId> = new Set(
  PROVIDER_PRESETS.map((p) => p.id),
);

export function providerPreset(id: ProviderId): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

export function providerLabel(id: ProviderId): string {
  return providerPreset(id)?.label ?? id;
}

export function findModel(provider: ProviderId, model: string): ModelPreset | undefined {
  return providerPreset(provider)?.models.find((m) => m.id === model);
}

/** The effort to preselect for a model: its default, else the middle-most level. */
export function defaultEffortFor(provider: ProviderId, model: string): string {
  const preset = findModel(provider, model);
  if (!preset || preset.efforts.length === 0) return "";
  return preset.defaultEffort ?? preset.efforts[Math.floor(preset.efforts.length / 2)] ?? "";
}
