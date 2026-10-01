/**
 * Settings → Display and sound (#225, SPEC §11): graphics quality and first
 * person on the left; reduced motion, volume and the clock on the right;
 * reset to defaults below. All of it is per browser (settingsStorage.ts).
 */
import { useId } from "react";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { Switch } from "../components/Switch.tsx";
import { FirstPersonSettings } from "./FirstPersonSettings.tsx";
import { GraphicsSettings } from "./GraphicsSettings.tsx";
import { DEFAULT_SETTINGS } from "./settingsStorage.ts";

export function DisplaySettings() {
  const settings = useUiStore((s) => s.settings);
  const osReducedMotion = useUiStore((s) => s.osReducedMotion);
  const reducedMotion = useUiStore(selectReducedMotion);
  const update = useUiStore((s) => s.updateSettings);
  const volumeId = useId();

  return (
    <>
      <div className="rg-settings__columns">
        <section className="rg-settings__group" aria-label="Display">
          <h3 className="rg-settings__heading">Display</h3>
          <GraphicsSettings />
          <FirstPersonSettings />
        </section>
        <section className="rg-settings__group" aria-label="Motion and sound">
          <h3 className="rg-settings__heading">Motion and sound</h3>
          <div className="rg-field">
            <Switch
              checked={reducedMotion}
              onChange={(next) => update({ reducedMotion: next })}
              label="Reduce motion"
              hint={
                settings.reducedMotion === null
                  ? `Following your system setting (${osReducedMotion ? "on" : "off"}). Disables work bubbles, confetti and dialog animations.`
                  : "Disables work bubbles, confetti and dialog animations."
              }
            />
            {settings.reducedMotion !== null && (
              <div>
                <Button variant="ghost" size="sm" onClick={() => update({ reducedMotion: null })}>
                  Follow system setting
                </Button>
              </div>
            )}
          </div>
          <div className="rg-field">
            <label className="rg-field__label" htmlFor={volumeId}>
              Volume <span className="rg-muted">({Math.round(settings.volume * 100)}%)</span>
            </label>
            <input
              id={volumeId}
              className="rg-range"
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(settings.volume * 100)}
              onChange={(e) => update({ volume: Number(e.currentTarget.value) / 100 })}
            />
            <div className="rg-field__hint">
              Placeholder: the jukebox and ambience (M3) will read this value.
            </div>
          </div>
          <div className="rg-field">
            <Switch
              checked={settings.hour12}
              onChange={(next) => update({ hour12: next })}
              label="12-hour clock"
              hint="Top bar clock format."
            />
          </div>
        </section>
      </div>
      <div className="rg-settings__actions">
        <Button variant="secondary" size="sm" onClick={() => update({ ...DEFAULT_SETTINGS })}>
          Reset to defaults
        </Button>
        <span className="rg-field__hint">Everything on this tab, for this browser.</span>
      </div>
    </>
  );
}
