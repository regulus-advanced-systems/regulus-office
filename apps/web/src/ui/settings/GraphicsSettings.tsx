/**
 * Graphics quality (#190, SPEC §11): Auto (picked from the GPU) or a fixed
 * Low / Medium / High preset (scene/compound/quality.ts). Saved with the
 * other client settings; the scene follows at once (a change of
 * antialiasing restarts the 3D view for a moment).
 */
import { useId } from "react";
import { type Quality, useQualityStore } from "../../scene/compound/quality.ts";
import { useUiStore } from "../../state/ui.ts";
import { GRAPHICS_SETTINGS, type GraphicsSetting } from "./settingsStorage.ts";

export const QUALITY_LABELS: Record<Quality, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const HINTS: Record<Quality, string> = {
  low: "For software rendering and weak machines: no lamp lights or shadows, less decor, near rooms only, lower resolution.",
  medium:
    "For laptops with integrated graphics: no antialiasing and fewer lamp lights; all the decor.",
  high: "For a dedicated graphics card: antialiasing, every lamp light, shadows and decor.",
};

export function graphicsLabel(setting: GraphicsSetting, detected: Quality): string {
  return setting === "auto" ? `Auto (${QUALITY_LABELS[detected]})` : QUALITY_LABELS[setting];
}

export function GraphicsSettings() {
  const setting = useUiStore((s) => s.settings.graphics);
  const update = useUiStore((s) => s.updateSettings);
  const detected = useQualityStore((s) => s.detected);
  const shown = useQualityStore((s) => s.quality);
  const id = useId();
  return (
    <div className="rg-field" data-testid="settings-graphics">
      <label className="rg-field__label" htmlFor={id}>
        Graphics quality
      </label>
      <select
        id={id}
        className="rg-select"
        value={setting}
        onChange={(e) => update({ graphics: e.currentTarget.value as GraphicsSetting })}
      >
        {GRAPHICS_SETTINGS.map((g) => (
          <option key={g} value={g}>
            {graphicsLabel(g, detected)}
          </option>
        ))}
      </select>
      <div className="rg-field__hint">{HINTS[shown]}</div>
    </div>
  );
}
