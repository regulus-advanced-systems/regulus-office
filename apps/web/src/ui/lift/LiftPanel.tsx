/**
 * The lift's panel (SPEC §14 D26; #269): the levels this viewer can reach,
 * each with the name and picture of the GitHub organisation or account it
 * belongs to, and nothing else: no rooms, no counts. A level the viewer may
 * not reach is not in the building state at all, so it cannot be listed.
 * Picking a level closes the panel and rides there (state/lift.ts); the
 * level the player is on is marked and does nothing.
 *
 * Opened with `E` or a click at the lift (scene/compound/lift/LiftDriver.tsx).
 * An ordinary dialog: focus trapped, Escape closes, arrow keys are the
 * browser's own tab order over the level buttons.
 */
import type { LevelState } from "@regulus/protocol";
import { useCallback, useMemo } from "react";
import { useQualityStore } from "../../scene/compound/quality.ts";
import { useBuildingStore } from "../../state/building.ts";
import { type LevelLabel, levelLabel, levelList, useLevelStore } from "../../state/level.ts";
import {
  LIFT_OVERLAY,
  type RideResult,
  rideLift,
  rideStyle,
  useLiftStore,
} from "../../state/lift.ts";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { Modal } from "../components/Modal.tsx";
import { LevelAvatar } from "./LevelAvatar.tsx";
import "./lift.css";

export interface LiftRow {
  level: LevelState;
  label: LevelLabel;
  here: boolean;
}

/** The panel's rows: every published level in lift order, the current one marked. */
export function liftRows(levels: readonly LevelState[], levelId: string): LiftRow[] {
  return levels.map((level) => ({
    level,
    label: levelLabel(level, levels),
    here: level.levelId === levelId,
  }));
}

/** Ride to a level the way the panel does: by the viewer's motion and graphics settings. */
export function rideTo(levelId: string): RideResult {
  const ui = useUiStore.getState();
  return rideLift(levelId, {
    style: rideStyle(selectReducedMotion(ui), useQualityStore.getState().quality),
    onLost: () =>
      ui.toast({ kind: "error", title: "Lift", message: "That level is no longer there." }),
  });
}

export function LiftPanel() {
  const open = useUiStore((s) => s.overlay === LIFT_OVERLAY);
  const close = useUiStore((s) => s.closeOverlay);
  const published = useBuildingStore((s) => s.state?.levels);
  const levelId = useLevelStore((s) => s.levelId);
  const riding = useLiftStore((s) => s.ride !== null);
  const rows = useMemo(
    () => liftRows(levelList({ levels: published }), levelId),
    [published, levelId],
  );
  const go = useCallback(
    (row: LiftRow) => {
      if (row.here) return;
      close(LIFT_OVERLAY);
      rideTo(row.level.levelId);
    },
    [close],
  );
  return (
    <Modal open={open && !riding} onClose={() => close(LIFT_OVERLAY)} title="Lift" width={440}>
      <ul className="rg-lift" aria-label="Levels you can reach">
        {rows.map((row) => (
          <li key={row.level.levelId}>
            <button
              type="button"
              className="rg-lift__row"
              aria-current={row.here ? "true" : undefined}
              aria-disabled={row.here ? "true" : undefined}
              data-level={row.level.levelId}
              onClick={() => go(row)}
            >
              <span className="rg-lift__mark" aria-hidden="true">
                {row.label.mark}
              </span>
              <LevelAvatar level={row.level} />
              <span className="rg-lift__text">
                <span className="rg-lift__name">{row.label.title}</span>
                <span className="rg-lift__caption">
                  {row.here && <span className="rg-lift__here">You are here · </span>}
                  {row.label.caption}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="rg-muted rg-lift__note">
        {rows.length > 1
          ? "The lift stops at the levels you can reach: the lobby, and every GitHub organisation or account where you can see at least one repo."
          : "The lift has nowhere else to take you yet: a level opens when a room is built for a repo you can see."}
      </p>
    </Modal>
  );
}
