/**
 * Quick travel (SPEC §9.1, #186; replaces the elevator): `F` or the Rooms
 * panel lists the rooms the player may enter (the lobby, the war room, the
 * break room and every finished project room with access), with their busy
 * counts and clone state; picking one puts the player at its door. Anyone
 * who manages a room gets a gear beside it for its settings (people).
 *
 * The lair has levels (#268, D26): above the rooms is the plain list of
 * levels to switch to (the lift is #269). The room list is grouped by level:
 * first the rooms of the level the player is on, then the rooms of the other
 * levels, each marked with its level; picking one of those goes to its level.
 */
import {
  type BuildingState,
  EMPTY_COMPOUND,
  type LevelKind,
  type LevelState,
} from "@regulus/protocol";
import { useCallback, useMemo } from "react";
import { compoundWorld, type WorldRoom } from "../../scene/compound/world.ts";
import { useBuildingStore } from "../../state/building.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { levelList, levelView, useLevelStore } from "../../state/level.ts";
import { cloneBadge, useOperationsStore } from "../../state/operations.ts";
import { travelTo, travelToLevel } from "../../state/travel.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { GearIcon } from "../components/icons.tsx";
import { Modal } from "../components/Modal.tsx";
import type { HotkeyEventDetail } from "../hotkeys/registry.ts";
import { useHotkeyEvents } from "../hotkeys/useHotkeys.ts";
import { canManageOperation, operationSettingsOverlay } from "../operations/operationSettings.ts";
import { useLocationName } from "./operationName.ts";

export const QUICK_TRAVEL_OVERLAY = "quick-travel";

/** Rooms quick travel offers: enterable and finished, special rooms first. */
export function travelRooms(rooms: readonly WorldRoom[]): WorldRoom[] {
  const special = rooms.filter((r) => r.kind !== "project");
  const projects = rooms.filter(
    (r) => r.kind === "project" && r.enterable && r.buildState === "ready",
  );
  return [...special, ...projects];
}

/** What a level is, beside its name in the level list. */
export function levelKindLabel(kind: LevelKind): string {
  if (kind === "lobby") return "shared level";
  if (kind === "org") return "organisation";
  if (kind === "account") return "account";
  return "rooms without a repo owner";
}

export interface LevelRoom {
  room: WorldRoom;
  /** The level the room is on, when it is not the one being looked at. */
  level: LevelState | null;
}

/**
 * Every room quick travel offers, grouped by level: the viewed level's rooms
 * (special rooms first), then the finished, enterable project rooms of each
 * other level in level order.
 */
export function levelRooms(
  here: readonly WorldRoom[],
  state: Pick<BuildingState, "compound" | "operations" | "levels"> | null,
  levelId: string,
  enterable: ReadonlySet<string> | null,
): LevelRoom[] {
  const out: LevelRoom[] = travelRooms(here).map((room) => ({ room, level: null }));
  for (const level of levelList(state)) {
    if (level.levelId === levelId) continue;
    const world = compoundWorld(levelView(state, level.levelId), enterable);
    for (const room of travelRooms(world?.rooms ?? [])) {
      if (room.kind === "project") out.push({ room, level });
    }
  }
  return out;
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
  const restOperations = useOperationsStore((s) => s.operations);
  const here = useLocationName();
  const published = useBuildingStore((s) => s.state?.levels);
  const operations = useBuildingStore((s) => s.state?.operations);
  const levels = useMemo(() => levelList({ levels: published }), [published]);
  const levelId = useLevelStore((s) => s.levelId);
  // Other levels' rooms come from their own published layouts.
  const rooms = useMemo(
    () =>
      levelRooms(
        world?.rooms ?? [],
        published && operations
          ? { compound: EMPTY_COMPOUND, levels: published, operations }
          : null,
        levelId,
        restOperations ? new Set(restOperations.map((f) => f.operationId)) : null,
      ),
    [world, published, operations, levelId, restOperations],
  );
  const go = (room: WorldRoom) => {
    close(QUICK_TRAVEL_OVERLAY);
    travelTo(room.id);
  };
  return (
    <Modal open={open} onClose={() => close(QUICK_TRAVEL_OVERLAY)} title="Quick travel" width={420}>
      {levels.length > 1 && (
        <ul className="rg-list" aria-label="Levels">
          {levels.map((level) => (
            <li key={level.levelId} className="rg-elevator__row">
              <button
                type="button"
                className="rg-list__item"
                aria-current={level.levelId === levelId ? "true" : undefined}
                onClick={() => travelToLevel(level.levelId)}
              >
                <span className="rg-chip">{level.name}</span>
                <span className="rg-muted">{levelKindLabel(level.kind)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {rooms.length === 0 && <div className="rg-muted">The compound is still loading.</div>}
      <ul className="rg-list" aria-label="Rooms you can enter">
        {rooms.map(({ room, level }) => {
          const badge =
            room.kind === "project"
              ? cloneBadge(restOperations?.find((f) => f.operationId === room.id))
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
                  {level ? `${level.name} · ` : null}
                  {badge ? (
                    <span className="rg-operation-badge" data-kind={badge}>
                      {badge === "cloning" ? "cloning" : "clone failed"}
                    </span>
                  ) : room.kind === "project" ? (
                    `${room.henchmenWorking}/${room.henchmenTotal} busy`
                  ) : null}
                </span>
              </button>
              {room.kind === "project" && canManageOperation(restOperations, room.id) && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="rg-elevator__gear"
                  aria-haspopup="dialog"
                  aria-label={`Operation settings: ${room.name}`}
                  title={`Operation settings: who can use ${room.name}`}
                  icon={<GearIcon />}
                  onClick={() => openOverlay(operationSettingsOverlay(room.id))}
                />
              )}
            </li>
          );
        })}
      </ul>
      <p className="rg-muted" style={{ fontSize: 12, marginTop: 8 }}>
        Travel puts you at the room's door. Rooms you may not enter are not listed; their doors show
        who is working inside. Each GitHub organisation or account has its own level; a room on
        another level takes you to that level.
      </p>
    </Modal>
  );
}
