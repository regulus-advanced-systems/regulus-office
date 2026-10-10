/**
 * Settings → Display and sound (#225, SPEC §11): graphics quality and first
 * person on the left; reduced motion, volume, the jukebox mute (#47), voice (#48) and the clock
 * on the right;
 * reset to defaults below. All of it is per browser (settingsStorage.ts).
 */
import { useId } from "react";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { Switch } from "../components/Switch.tsx";
import { DictationSettings } from "../dictation/DictationSettings.tsx";
import { FirstPersonSettings } from "./FirstPersonSettings.tsx";
import { GraphicsSettings } from "./GraphicsSettings.tsx";
import { DEFAULT_SETTINGS } from "./settingsStorage.ts";
import { VoiceSettings } from "./VoiceSettings.tsx";

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
          <div className="rg-field">
            <Switch
              checked={settings.activityBubbles}
              onChange={(next) => update({ activityBubbles: next })}
              label="Activity bubbles"
              hint="A few words over each henchman on what it is doing. A henchman that needs you or has finished shows its bubble either way."
            />
          </div>
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
              Every office sound: the lobby jukebox, the beach, the klaxon, the gong and dings.
            </div>
          </div>
          <div className="rg-field">
            <Switch
              checked={settings.jukeboxMuted}
              onChange={(next) => update({ jukeboxMuted: next })}
              label="Mute the jukebox"
              hint="Only for you: the music keeps playing for everyone else."
            />
          </div>
          <VoiceSettings />
          <DictationSettings />
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
