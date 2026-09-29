/**
 * First-person view settings (SPEC §9.2, issue #144): field of view and mouse
 * sensitivity sliders, persisted with the other client settings. The rig
 * reads them live, so changes apply without leaving first person.
 */
import { useId } from "react";
import {
  DEFAULT_FPV_FOV,
  DEFAULT_MOUSE_SENSITIVITY,
  MAX_FPV_FOV,
  MAX_MOUSE_SENSITIVITY,
  MIN_FPV_FOV,
  MIN_MOUSE_SENSITIVITY,
} from "../../scene/camera/perspective.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";

export function FirstPersonSettings() {
  const fov = useUiStore((s) => s.settings.fpvFov);
  const sensitivity = useUiStore((s) => s.settings.mouseSensitivity);
  const update = useUiStore((s) => s.updateSettings);
  const fovId = useId();
  const sensId = useId();
  const isDefault = fov === DEFAULT_FPV_FOV && sensitivity === DEFAULT_MOUSE_SENSITIVITY;

  return (
    <div className="rg-field" data-testid="settings-first-person">
      <div className="rg-field__label">First-person view</div>

      <label className="rg-field__label" htmlFor={fovId}>
        Field of view <span className="rg-muted">({Math.round(fov)}°)</span>
      </label>
      <input
        id={fovId}
        className="rg-range"
        type="range"
        min={MIN_FPV_FOV}
        max={MAX_FPV_FOV}
        step={1}
        value={fov}
        onChange={(e) => update({ fpvFov: Number(e.currentTarget.value) })}
      />

      <label className="rg-field__label" htmlFor={sensId}>
        Mouse sensitivity <span className="rg-muted">({sensitivity.toFixed(2)}×)</span>
      </label>
      <input
        id={sensId}
        className="rg-range"
        type="range"
        min={MIN_MOUSE_SENSITIVITY}
        max={MAX_MOUSE_SENSITIVITY}
        step={0.05}
        value={sensitivity}
        onChange={(e) => update({ mouseSensitivity: Number(e.currentTarget.value) })}
      />

      <div className="rg-field__hint">
        Vertical field of view; {DEFAULT_FPV_FOV}° is recommended. Very wide screens are capped so
        the edges do not stretch.
      </div>
      {!isDefault && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              update({ fpvFov: DEFAULT_FPV_FOV, mouseSensitivity: DEFAULT_MOUSE_SENSITIVITY })
            }
          >
            Use recommended
          </Button>
        </div>
      )}
    </div>
  );
}
