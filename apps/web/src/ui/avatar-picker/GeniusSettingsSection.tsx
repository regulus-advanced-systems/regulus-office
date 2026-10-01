/** Settings entry for the genius picker (#185): the current genius and a button to change it. */
import { useSessionStore } from "../../state/session.ts";
import { Button } from "../components/Button.tsx";
import { ARCHETYPE_INFO, describeLook } from "./labels.ts";
import { openGeniusPicker } from "./pickerStore.ts";

export function GeniusSettingsSection() {
  const look = useSessionStore((s) => s.user?.avatar);
  if (!look) return null;
  return (
    <section className="rg-settings__group" aria-label="Your genius">
      <h3 className="rg-settings__heading">Your genius</h3>
      <div>
        <Button
          variant="secondary"
          size="sm"
          aria-haspopup="dialog"
          onClick={() => openGeniusPicker("settings")}
        >
          Change genius…
        </Button>
      </div>
      <div className="rg-field__hint">
        {describeLook(look)}. {ARCHETYPE_INFO[look.archetype].blurb}
      </div>
    </section>
  );
}
