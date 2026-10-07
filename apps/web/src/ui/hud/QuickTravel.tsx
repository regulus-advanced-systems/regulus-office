/**
 * Quick travel (SPEC §9.1, #186; replaces the elevator): `F` or the Rooms
 * panel lists the rooms the player may enter, with their busy counts and
 * clone state; picking one puts the player at its door. Anyone who manages a
 * room gets a gear beside it for its settings (people).
 *
 * The lair has levels (D26; #268, #269) and the list is grouped by them: the
 * level the player is on first, then the others in lift order, each under
 * the name and picture of the GitHub organisation or account it belongs to,
 * with a button to that level's lift landing. A level lists its fixed rooms
 * (the lobby, war room and break room on the lobby level, the landing on the
 * others) and the finished rooms this viewer may enter; picking a room on
 * another level goes to that level. Rooms the viewer may not enter, closed
 * rooms and levels they cannot reach are not listed at all.
 */
import { type BuildingState, EMPTY_COMPOUND, type LevelState } from "@regulus/protocol";
import { useCallback, useMemo } from "react";
import { type CompoundWorld, compoundWorld, type WorldRoom } from "../../scene/compound/world.ts";
import { useBuildingStore } from "../../state/building.ts";
import { useCompoundStore } from "../../state/compound.ts";
import {
  type LevelLabel,
  levelLabel,
  levelList,
  levelView,
  useLevelStore,
} from "../../state/level.ts";
import { cloneBadge, useOperationsStore } from "../../state/operations.ts";
import { travelTo, travelToLevel } from "../../state/travel.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { GearIcon } from "../components/icons.tsx";
import { Modal } from "../components/Modal.tsx";
import type { HotkeyEventDetail } from "../hotkeys/registry.ts";
import { useHotkeyEvents } from "../hotkeys/useHotkeys.ts";
import { LevelAvatar } from "../lift/LevelAvatar.tsx";
import { canManageOperation, operationSettingsOverlay } from "../operations/operationSettings.ts";
import { useLocationName } from "./operationName.ts";
import "../lift/lift.css";

export const QUICK_TRAVEL_OVERLAY = "quick-travel";

/** Rooms quick travel offers: enterable and finished, special rooms first. */
export function travelRooms(rooms: readonly WorldRoom[]): WorldRoom[] {
  const special = rooms.filter((r) => r.kind !== "project");
  const projects = rooms.filter(
    (r) => r.kind === "project" && r.enterable && r.buildState === "ready",
  );
  return [...special, ...projects];
}

export interface TravelGroup {
  /** The level; null in an office that publishes no levels (one unnamed group). */
  level: LevelState | null;
  label: LevelLabel | null;
  /** The level the player is on. */
  here: boolean;
  rooms: WorldRoom[];
}

/**
 * Quick travel's groups: one per published level, the one being looked at
 * first and the rest in lift order, each with the rooms it offers.
 */
export function travelGroups(
  here: CompoundWorld | null,
  state: Pick<BuildingState, "compound" | "operations" | "levels"> | null,
  levelId: string,
  enterable: ReadonlySet<string> | null,
): TravelGroup[] {
  const levels = levelList(state);
  if (levels.length === 0)
    return here ? [{ level: null, label: null, here: true, rooms: travelRooms(here.rooms) }] : [];
  const groups = levels.map((level): TravelGroup => {
    const current = level.levelId === levelId;
    const world =
      current && here
        ? here
        : compoundWorld(levelView(state, level.levelId), enterable, level.levelId);
    return {
      level,
      label: levelLabel(level, levels),
      here: current,
      rooms: travelRooms(world?.rooms ?? []),
    };
  });
  return [...groups.filter((g) => g.here), ...groups.filter((g) => !g.here)];
}

/** How deep a level is, for a group's heading ("Sublevel 2"); nothing for the lobby level. */
export function levelDepth(label: LevelLabel): string {
  const depth = label.caption.split(" · ")[0] ?? "";
  return depth.startsWith("Sublevel") ? depth : "";
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
  const levelId = useLevelStore((s) => s.levelId);
  // Other levels' rooms come from their own published layouts.
  const groups = useMemo(
    () =>
      travelGroups(
        world,
        published && operations
          ? { compound: EMPTY_COMPOUND, levels: published, operations }
          : null,
        levelId,
        restOperations ? new Set(restOperations.map((f) => f.operationId)) : null,
      ),
    [world, published, operations, levelId, restOperations],
  );
  const go = (room: WorldRoom, group: TravelGroup) => {
    close(QUICK_TRAVEL_OVERLAY);
    travelTo(room.id, group.level ? { levelId: group.level.levelId } : {});
  };
  const goLevel = (group: TravelGroup) => {
    if (!group.level) return;
    close(QUICK_TRAVEL_OVERLAY);
    travelToLevel(group.level.levelId);
  };
  return (
    <Modal open={open} onClose={() => close(QUICK_TRAVEL_OVERLAY)} title="Quick travel" width={440}>
      {groups.length === 0 && <div className="rg-muted">The compound is still loading.</div>}
      {groups.map((group) => {
        const title = group.label?.title ?? "Rooms";
        return (
          <section
            key={group.level?.levelId ?? "rooms"}
            aria-label={title}
            data-level={group.level?.levelId}
            data-here={group.here ? "true" : undefined}
          >
            {group.level && group.label && (
              <h2 className="rg-travel__level">
                <LevelAvatar level={group.level} />
                <span className="rg-travel__level-name">{group.label.title}</span>
                <span className="rg-muted">
                  {group.here ? "you are here" : levelDepth(group.label)}
                </span>
                {!group.here && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="rg-travel__level-go"
                    aria-label={`Go to ${group.label.title}`}
                    title={`Go to the lift landing of ${group.label.title}`}
                    onClick={() => goLevel(group)}
                  >
                    Go
                  </Button>
                )}
              </h2>
            )}
            <ul className="rg-list" aria-label={`Rooms you can enter: ${title}`}>
              {group.rooms.map((room) => {
                const badge =
                  room.kind === "project"
                    ? cloneBadge(restOperations?.find((f) => f.operationId === room.id))
                    : null;
                return (
                  <li key={room.id} className="rg-elevator__row">
                    <button
                      type="button"
                      className="rg-list__item"
                      aria-current={group.here && room.name === here ? "true" : undefined}
                      onClick={() => go(room, group)}
                    >
                      <span className="rg-chip">{room.name}</span>
                      <span className="rg-muted">
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
          </section>
        );
      })}
      <p className="rg-muted" style={{ fontSize: 12, marginTop: 8 }}>
        Travel puts you at the room's door. Each GitHub organisation or account has its own level;
        only levels you can reach and rooms you may enter are listed. The lift in the lobby and on
        every landing goes between levels too.
      </p>
    </Modal>
  );
}
