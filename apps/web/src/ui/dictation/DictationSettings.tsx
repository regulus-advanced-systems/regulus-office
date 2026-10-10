/**
 * Settings → Display and sound → Dictation (#260): on or off, where speech is
 * turned into text (said in full for both choices), and the language. Per
 * browser (dictationStore.ts).
 */
import { useId } from "react";
import { Switch } from "../components/Switch.tsx";
import { DICTATION_LANGUAGES, useDictationStore } from "./dictationStore.ts";
import { type DictationEngineId, ENGINE_AUDIO } from "./engine.ts";
import { DICTATION_HOTKEY } from "./holdKey.ts";
import "./dictation.css";

const ENGINE_LABEL: Readonly<Record<DictationEngineId, string>> = {
  local: "On this computer",
  vendor: "Your browser's online service",
};

export function DictationSettings() {
  const prefs = useDictationStore((s) => s.prefs);
  const update = useDictationStore((s) => s.updatePrefs);
  const group = useId();
  const langId = useId();
  return (
    <>
      <div className="rg-field">
        <Switch
          checked={prefs.enabled}
          onChange={(next) => update({ enabled: next })}
          label="Dictation"
          hint={`Hold ${DICTATION_HOTKEY.key} (or the mic button) in a terminal you control or a text box and speak; let go to stop. Nothing is sent until you press Enter.`}
        />
      </div>
      {prefs.enabled && (
        <>
          <fieldset className="rg-field rg-dictation-engines" data-testid="dictation-engines">
            <legend className="rg-field__label">Speech is turned into text</legend>
            {(["local", "vendor"] as const).map((id) => (
              <label key={id} className="rg-dictation-engine">
                <input
                  type="radio"
                  name={group}
                  value={id}
                  checked={prefs.engine === id}
                  // Choosing here, beside the text that says where the audio goes, is the say-so.
                  onChange={() =>
                    update({ engine: id, introSeen: prefs.introSeen || id === "vendor" })
                  }
                />
                <span>
                  <span className="rg-field__label">{ENGINE_LABEL[id]}</span>
                  <span className="rg-field__hint rg-dictation-engine__hint">
                    {ENGINE_AUDIO[id]}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="rg-field">
            <label className="rg-field__label" htmlFor={langId}>
              Dictation language
            </label>
            <select
              id={langId}
              className="rg-select"
              value={prefs.lang}
              onChange={(e) => update({ lang: e.currentTarget.value })}
            >
              <option value="">Browser language</option>
              {DICTATION_LANGUAGES.map(([tag, name]) => (
                <option key={tag} value={tag}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </>
  );
}
