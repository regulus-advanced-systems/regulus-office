/**
 * Quick travel (SPEC §9.1, #186; replaces the elevator): `F` or the Rooms
 * panel lists the rooms the player may enter (the lobby, the war room, the
 * break room and every finished project room with access), with their busy
 * counts and clone state; picking one puts the player at its door. Anyone
 * who manages a room gets a gear beside it for its settings (people).
 */
import { useCallback, useMemo } from "react";
import type { WorldRoom } from "../../scene/compound/world.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { cloneBadge, useFloorsStore } from "../../state/floors.ts";
import { travelTo } from "../../state/travel.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { GearIcon } from "../components/icons.tsx";
import { Modal } from "../components/Modal.tsx";
import { canManageFloor, floorSettingsOverlay } from "../floors/floorSettings.ts";
import type { HotkeyEventDetail } from "../hotkeys/registry.ts";
import { useHotkeyEvents } from "../hotkeys/useHotkeys.ts";
import { useLocationName } from "./floorName.ts";

export const QUICK_TRAVEL_OVERLAY = "quick-travel";

/** Rooms quick travel offers: enterable and finished, special rooms first. */
export function travelRooms(rooms: readonly WorldRoom[]): WorldRoom[] {
  const special = rooms.filter((r) => r.kind !== "project");
  const projects = rooms.filter(
    (r) => r.kind === "project" && r.enterable && r.buildState === "ready",
  );
  return [...special, ...projects];
}

/** `F` toggles the quick travel menu; call once per page. */
export function useQuickTravelHotkey(): void {
  const toggle = useUiStore((s) => s.toggleOverlay);
  useHotkeyEvents(
    useCallback(
      (detail: HotkeyEventDetail) => {
        if (detail.id === "quickTravel") toggle(QUICK_TRAVEL_OVERLAY);
      },
      [toggle],
    ),
  );
}

export function QuickTravelDialog() {
  const open = useUiStore((s) => s.overlay === QUICK_TRAVEL_OVERLAY);
  const close = useUiStore((s) => s.closeOverlay);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const world = useCompoundStore((s) => s.world);
  const restFloors = useFloorsStore((s) => s.floors);
  const here = useLocationName();
  const rooms = useMemo(() => travelRooms(world?.rooms ?? []), [world]);
  const go = (room: WorldRoom) => {
    close(QUICK_TRAVEL_OVERLAY);
    travelTo(room.id);
  };
  return (
    <Modal open={open} onClose={() => close(QUICK_TRAVEL_OVERLAY)} title="Quick travel" width={420}>
      {rooms.length === 0 && <div className="rg-muted">The compound is still loading.</div>}
      <ul className="rg-list" aria-label="Rooms you can enter">
        {rooms.map((room) => {
          const badge =
            room.kind === "project"
              ? cloneBadge(restFloors?.find((f) => f.floorId === room.id))
              : null;
          return (
            <li key={room.id} className="rg-elevator__row">
              <button
                type="button"
                className="rg-list__item"
                aria-current={room.name === here ? "true" : undefined}
                onClick={() => go(room)}
              >
                <span className="rg-chip">{room.name}</span>
                <span className="rg-muted">
                  {badge ? (
                    <span className="rg-floor-badge" data-kind={badge}>
                      {badge === "cloning" ? "cloning" : "clone failed"}
                    </span>
                  ) : room.kind === "project" ? (
                    `${room.robotsWorking}/${room.robotsTotal} busy`
                  ) : null}
                </span>
              </button>
              {room.kind === "project" && canManageFloor(restFloors, room.id) && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="rg-elevator__gear"
                  aria-haspopup="dialog"
                  aria-label={`Operation settings: ${room.name}`}
                  title={`Operation settings: who can use ${room.name}`}
                  icon={<GearIcon />}
                  onClick={() => openOverlay(floorSettingsOverlay(room.id))}
                />
              )}
            </li>
          );
        })}
      </ul>
      <p className="rg-muted" style={{ fontSize: 12, marginTop: 8 }}>
        Travel puts you at the room's door. Rooms you may not enter are not listed; their doors show
        who is working inside.
      </p>
    </Modal>
  );
}
