/**
 * Genius picker (SPEC §9.3, D22, #185): archetype, four colours and an
 * accessory, with a turntable preview. Shown at first login and from
 * Settings. Every choice is a native radio group (arrow keys move within a
 * group, Tab between groups); Save sends the look to the server, which
 * validates it and shows it to everyone in the office at once.
 */
import {
  accessoriesFor,
  GENIUS_ARCHETYPES,
  GENIUS_COLOR_SLOTS,
  type GeniusColorSlot,
  type GeniusLookValue,
} from "@regulus/protocol/src/genius.ts";
import { useId, useState } from "react";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";
import { saveGeniusLook } from "./api.ts";
import { initialDraft, sameLook, withAccessory, withArchetype, withColor } from "./draft.ts";
import { ACCESSORY_LABELS, ARCHETYPE_INFO, describeLook } from "./labels.ts";
import { closeGeniusPicker, type PickerReason } from "./pickerStore.ts";
import { TurntablePreview } from "./TurntablePreview.tsx";
import "./avatarPicker.css";

const SLOT_LABELS: Record<GeniusColorSlot, string> = {
  outfit: "Outfit",
  trim: "Trim",
  skin: "Skin",
  hair: "Hair",
};

const titleCase = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

export function AvatarPicker({ open, reason }: { open: boolean; reason: PickerReason }) {
  if (!open) return null;
  return <PickerDialog reason={reason} />;
}

function PickerDialog({ reason }: { reason: PickerReason }) {
  const current = useSessionStore((s) => s.user?.avatar);
  const setAvatar = useSessionStore((s) => s.setAvatar);
  const toast = useUiStore((s) => s.toast);
  const [look, setLook] = useState(() => initialDraft(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const first = reason === "first_login";

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await saveGeniusLook(look);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAvatar(result.look);
    toast({
      kind: "success",
      message: `${ARCHETYPE_INFO[result.look.archetype].label} it is. Welcome to the lair.`,
    });
    closeGeniusPicker();
  };

  const unchanged = !first && current !== undefined && sameLook(look, current);
  return (
    <Modal
      open
      onClose={closeGeniusPicker}
      title={first ? "Choose your genius" : "Change your genius"}
      width={820}
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={closeGeniusPicker}>
            {first ? "Decide later" : "Cancel"}
          </Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={busy || unchanged}
            data-testid="genius-save"
          >
            {busy ? "Saving…" : first ? "Enter the lair" : "Save genius"}
          </Button>
        </>
      }
    >
      <div className="rg-genius-picker">
        <TurntablePreview look={look} label={describeLook(look)} />
        <div className="rg-genius-picker__choices">
          {first && (
            <p className="rg-genius-picker__intro">
              Every lair needs a mastermind. Pick who you are; you can change it later in Settings.
            </p>
          )}
          <fieldset className="rg-genius-group">
            <legend className="rg-field__label">Archetype</legend>
            <div className="rg-genius-archetypes">
              {GENIUS_ARCHETYPES.map((archetype) => (
                <label key={archetype} className="rg-genius-card">
                  <input
                    type="radio"
                    name={`${id}-archetype`}
                    value={archetype}
                    checked={look.archetype === archetype}
                    onChange={() => setLook((l) => withArchetype(l, archetype))}
                  />
                  <span className="rg-genius-card__name">{ARCHETYPE_INFO[archetype].label}</span>
                  <span className="rg-genius-card__blurb">{ARCHETYPE_INFO[archetype].blurb}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {(Object.keys(GENIUS_COLOR_SLOTS) as GeniusColorSlot[]).map((slot) => (
            <fieldset key={slot} className="rg-genius-group">
              <legend className="rg-field__label">{SLOT_LABELS[slot]}</legend>
              <div className="rg-genius-swatches">
                {Object.entries(GENIUS_COLOR_SLOTS[slot]).map(([colour, hex]) => (
                  <label key={colour} className="rg-genius-swatch" title={titleCase(colour)}>
                    <input
                      type="radio"
                      name={`${id}-${slot}`}
                      value={colour}
                      aria-label={`${SLOT_LABELS[slot]}: ${colour}`}
                      checked={look[slot] === colour}
                      onChange={() => setLook((l) => withColor(l, slot, colour))}
                    />
                    <span style={{ background: hex }} />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <fieldset className="rg-genius-group">
            <legend className="rg-field__label">Accessory</legend>
            <div className="rg-genius-chips">
              {accessoriesFor(look.archetype).map((accessory) => (
                <label key={accessory} className="rg-genius-chip">
                  <input
                    type="radio"
                    name={`${id}-accessory`}
                    value={accessory}
                    checked={look.accessory === accessory}
                    onChange={() => setLook((l) => withAccessory(l, accessory))}
                  />
                  <span>{ACCESSORY_LABELS[accessory] ?? accessory}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {error && <FormAlert>{error}</FormAlert>}
        </div>
      </div>
    </Modal>
  );
}
