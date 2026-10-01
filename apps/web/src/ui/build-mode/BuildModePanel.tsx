/**
 * The build-mode console (#187, SPEC §9.1): size (S/M/L or custom 4–12
 * tiles a side), door side, whether the ghost's spot is clear (and why
 * not, in the server's words), and Build here / Cancel. The ghost itself is
 * drawn in the scene (scene/compound/build/Ghost.tsx). Every control works
 * from the keyboard; the status line is a live region.
 */
import { DOOR_SIDES, type DoorSide, ROOM_MAX_TILES, ROOM_MIN_TILES } from "@regulus/protocol";
import { useEffect, useId, useRef } from "react";
import { useCompoundStore } from "../../state/compound.ts";
import { Button } from "../components/Button.tsx";
import { Panel } from "../Panel.tsx";
import { clampSide, DOOR_SIDE_LABELS, presetOf, SIZE_PRESETS, type SizePreset } from "./logic.ts";
import { useBuildModeStore } from "./store.ts";
import { useVerdict } from "./verdict.ts";
import "./build-mode.css";

const SIDES = Array.from(
  { length: ROOM_MAX_TILES - ROOM_MIN_TILES + 1 },
  (_, i) => ROOM_MIN_TILES + i,
);

export function BuildModePanel({ onConfirm }: { onConfirm: () => void }) {
  const world = useCompoundStore((s) => s.world);
  const intent = useBuildModeStore((s) => s.intent);
  const size = useBuildModeStore((s) => s.size);
  const doorSide = useBuildModeStore((s) => s.doorSide);
  const busy = useBuildModeStore((s) => s.busy);
  const error = useBuildModeStore((s) => s.error);
  const verdict = useVerdict();
  const ref = useRef<HTMLDivElement>(null);
  const ids = { w: useId(), d: useId(), title: useId() };
  const preset = presetOf(size);

  // Take the keyboard from the dialog that opened build mode (after it gives focus back).
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  if (!world || !intent) return null;
  const store = useBuildModeStore.getState();
  const name = intent.kind === "create" ? intent.request.name : intent.name;
  const setPreset = (p: SizePreset | "custom") => {
    if (p === "custom") return store.setSize(world, { ...size });
    store.setSize(world, { w: SIZE_PRESETS[p].w, d: SIZE_PRESETS[p].d });
  };
  const canBuild = verdict?.state !== "refused" && !busy;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-labelledby={ids.title}
      className="rg-dock"
      data-testid="build-mode"
    >
      <Panel
        title={
          <span id={ids.title}>{intent.kind === "create" ? `Build ${name}` : `Move ${name}`}</span>
        }
      >
        <fieldset className="rg-build__seg">
          <legend>Size</legend>
          <div className="rg-build__chips">
            {(Object.keys(SIZE_PRESETS) as SizePreset[]).map((p) => (
              <label key={p} className="rg-build__chip">
                <input
                  type="radio"
                  name="build-size"
                  checked={preset === p}
                  disabled={busy}
                  onChange={() => setPreset(p)}
                  aria-label={`${SIZE_PRESETS[p].label}, ${SIZE_PRESETS[p].w} by ${SIZE_PRESETS[p].d} tiles`}
                />
                {p} {SIZE_PRESETS[p].w}×{SIZE_PRESETS[p].d}
              </label>
            ))}
            <label className="rg-build__chip">
              <input
                type="radio"
                name="build-size"
                checked={preset === "custom"}
                disabled={busy}
                onChange={() => setPreset("custom")}
                aria-label="Custom size"
              />
              Custom
            </label>
          </div>
          <div className="rg-build__dims">
            <label htmlFor={ids.w}>Width</label>
            <select
              id={ids.w}
              className="rg-select"
              value={size.w}
              disabled={busy}
              onChange={(e) =>
                store.setSize(world, { ...size, w: clampSide(Number(e.currentTarget.value)) })
              }
            >
              {SIDES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <label htmlFor={ids.d}>Depth</label>
            <select
              id={ids.d}
              className="rg-select"
              value={size.d}
              disabled={busy}
              onChange={(e) =>
                store.setSize(world, { ...size, d: clampSide(Number(e.currentTarget.value)) })
              }
            >
              {SIDES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="rg-muted">tiles (2 m)</span>
          </div>
        </fieldset>
        <fieldset className="rg-build__seg">
          <legend>Door</legend>
          <div className="rg-build__chips">
            {DOOR_SIDES.map((side: DoorSide) => (
              <label key={side} className="rg-build__chip">
                <input
                  type="radio"
                  name="build-door"
                  checked={doorSide === side}
                  disabled={busy}
                  onChange={() => store.setDoor(side)}
                />
                {DOOR_SIDE_LABELS[side]}
              </label>
            ))}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => store.rotate(1)}>
              Turn (R)
            </Button>
          </div>
        </fieldset>
        <div
          className="rg-build__status"
          role="status"
          aria-live="polite"
          data-state={verdict?.state ?? "checking"}
          data-testid="build-status"
        >
          {error ?? verdict?.text ?? "Checking…"}
        </div>
        <p className="rg-build__keys">
          The ghost follows the mouse; click to hold it. Arrows nudge it, R turns the door, Enter
          builds, Esc cancels. Z/C turn the camera, the wheel zooms.
        </p>
        <div className="rg-dock__actions">
          <Button variant="primary" disabled={!canBuild} onClick={onConfirm}>
            {busy
              ? "Working…"
              : intent.kind === "create"
                ? "Build here (Enter)"
                : "Move here (Enter)"}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => store.cancel()}>
            Cancel (Esc)
          </Button>
        </div>
      </Panel>
    </div>
  );
}
