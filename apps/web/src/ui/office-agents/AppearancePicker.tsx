/**
 * How an office agent looks (#280, D32): a gallery of thumbnails, like the
 * skin picker of #225 whose thumbnails and styles it reuses. The forms come
 * from the protocol's list, so one the art adds shows up here by itself; a
 * form with no thumbnail yet gets a plain plate with its initial.
 */
import {
  isCharacterFormId,
  OFFICE_AGENT_APPEARANCES,
  officeAgentAppearanceLabel,
} from "@regulus/protocol";
import { useId } from "react";
import { providerLightColor } from "../../scene/avatar/colorSets.ts";
import { SkinThumb } from "../settings/SkinThumb.tsx";
import "../settings/skinRules.css";

const TRIM = providerLightColor("claude-code");

export function AppearanceThumb({ id, size = "md" }: { id: string; size?: "sm" | "md" }) {
  if (isCharacterFormId(id)) return <SkinThumb skin={id} trim={TRIM} size={size} />;
  return (
    <span
      className={`rg-skin-thumb rg-skin-thumb--${size}`}
      aria-hidden="true"
      data-placeholder="true"
    >
      <span className="rg-skin-thumb__fallback">{officeAgentAppearanceLabel(id).charAt(0)}</span>
    </span>
  );
}

export function AppearancePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (appearance: string) => void;
}) {
  const name = useId();
  // A stored form the list no longer has stays selectable, so saving does not silently change it.
  const ids = OFFICE_AGENT_APPEARANCES.includes(value)
    ? OFFICE_AGENT_APPEARANCES
    : [...OFFICE_AGENT_APPEARANCES, value];
  return (
    <fieldset className="rg-office-agent-form__group">
      <legend className="rg-field__label">Appearance</legend>
      <div className="rg-skin-gallery">
        {ids.map((id) => (
          <label key={id} className="rg-skin-gallery__item">
            <input
              type="radio"
              name={`${name}-appearance`}
              value={id}
              checked={value === id}
              onChange={() => onChange(id)}
            />
            <AppearanceThumb id={id} />
            <span className="rg-skin-gallery__label">{officeAgentAppearanceLabel(id)}</span>
          </label>
        ))}
      </div>
      <div className="rg-field__hint">
        How it looks in the office. Looks only: it changes nothing about what the agent is or may
        do, and you can change it at any time.
      </div>
    </fieldset>
  );
}
