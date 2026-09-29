/**
 * Settings skeleton (SPEC §11): the signed-in account (invites, sign-out),
 * reduced-motion toggle persisted in localStorage, a volume placeholder the
 * jukebox work will wire up, and the clock format. Rendered inside a Modal
 * by the HUD.
 */
import { useId } from "react";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { AccountSection } from "../auth/AccountSection.tsx";
import { Button } from "../components/Button.tsx";
import { Switch } from "../components/Switch.tsx";
import { openProvidersPanel } from "../providers/providersStore.ts";
import { FirstPersonSettings } from "./FirstPersonSettings.tsx";
import { DEFAULT_SETTINGS } from "./settingsStorage.ts";

export function SettingsForm() {
  const settings = useUiStore((s) => s.settings);
  const osReducedMotion = useUiStore((s) => s.osReducedMotion);
  const reducedMotion = useUiStore(selectReducedMotion);
  const update = useUiStore((s) => s.updateSettings);
  const volumeId = useId();

  return (
    <div>
      <AccountSection />

      <div className="rg-field">
        <div className="rg-field__label">AI providers</div>
        <div>
          <Button variant="secondary" size="sm" onClick={() => openProvidersPanel()}>
            Connect providers
          </Button>
        </div>
        <div className="rg-field__hint">
          Sign in to Claude Code or Codex in your own runner, or add API and plan keys.
        </div>
      </div>

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

      <FirstPersonSettings />

      <div className="rg-field">
        <div>
          <Button variant="secondary" size="sm" onClick={() => update({ ...DEFAULT_SETTINGS })}>
            Reset to defaults
          </Button>
        </div>
      </div>
    </div>
  );
}
