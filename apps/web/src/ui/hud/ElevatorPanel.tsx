/**
 * Elevator list (SPEC §9.1): the lobby and the floors this user may enter,
 * with name, busy counts, a palette chip and clone status; clicking rides
 * there (`floor.go` + FloorRoom switch). Owners and admins get "Add floor";
 * anyone who manages a floor gets a gear beside it for its settings (people).
 */
import { PALETTES, paletteById } from "@regulus/floor-layout";
import { type FloorSummary, LOBBY_FLOOR_ID } from "@regulus/protocol";
import { useMemo } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { useBuildingStore } from "../../state/building.ts";
import { useFloorStore } from "../../state/floor.ts";
import { cloneBadge, useFloorsStore } from "../../state/floors.ts";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { GearIcon } from "../components/icons.tsx";
import { ADD_FLOOR_OVERLAY } from "../floors/AddFloorDialog.tsx";
import { canManageFloor, floorSettingsOverlay } from "../floors/floorSettings.ts";
import { Panel } from "../Panel.tsx";

/**
 * Floors to list: the lobby always; a project floor once the REST list says
 * we may enter it (the BuildingRoom directory is office-wide). Until that
 * list has loaded, every floor from the directory is shown.
 */
export function visibleFloors(
  directory: Readonly<Record<string, FloorSummary>> | null,
  accessible: ReadonlySet<string> | null,
): FloorSummary[] {
  const floors = directory ? Object.values(directory) : [];
  return floors
    .filter((f) => f.floorId === LOBBY_FLOOR_ID || !accessible || accessible.has(f.floorId))
    .sort((a, b) => a.index - b.index);
}

export function ElevatorPanel() {
  // Select stable records and derive in memos: a selector returning a new
  // array each call would re-render forever under zustand's external store.
  const directory = useBuildingStore((s) => s.state?.floors ?? null);
  const restFloors = useFloorsStore((s) => s.floors);
  const accessible = useMemo(
    () => (restFloors ? new Set(restFloors.map((f) => f.floorId)) : null),
    [restFloors],
  );
  const floors = useMemo(() => visibleFloors(directory, accessible), [directory, accessible]);
  const currentFloor = useFloorStore((s) => s.floorId) ?? LOBBY_FLOOR_ID;
  const session = useSessionStore((s) => s.status);
  const user = useSessionStore((s) => s.user);
  const openOverlay = useUiStore((s) => s.openOverlay);
  return (
    <Panel as="nav" title="Elevator" aria-label="Elevator">
      {floors.length === 0 && <div className="rg-muted">No floors yet</div>}
      <ul className="rg-list">
        {floors.map((floor) => {
          const color = (paletteById(floor.paletteId) ?? PALETTES[0])?.floor;
          const badge = cloneBadge(restFloors?.find((f) => f.floorId === floor.floorId));
          return (
            <li key={floor.floorId} className="rg-elevator__row">
              <button
                type="button"
                className="rg-list__item"
                aria-current={floor.floorId === currentFloor ? "true" : undefined}
                onClick={() => void getOfficeClient().rideTo(floor.floorId)}
              >
                <span className="rg-chip">
                  <span className="rg-chip__dot" style={{ background: color }} aria-hidden />
                  {floor.index}. {floor.name}
                </span>
                <span className="rg-muted">
                  {badge ? (
                    <span className="rg-floor-badge" data-kind={badge}>
                      {badge === "cloning" ? "cloning" : "clone failed"}
                    </span>
                  ) : (
                    `${floor.robotsWorking}/${floor.robotsTotal} busy`
                  )}
                </span>
              </button>
              {canManageFloor(restFloors, floor.floorId) && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="rg-elevator__gear"
                  aria-haspopup="dialog"
                  aria-label={`Floor settings: ${floor.name}`}
                  title={`Floor settings: who can use ${floor.name}`}
                  icon={<GearIcon />}
                  onClick={() => openOverlay(floorSettingsOverlay(floor.floorId))}
                />
              )}
            </li>
          );
        })}
      </ul>
      {canManageOffice(user?.role) && (
        <div style={{ marginTop: 6 }}>
          <Button
            variant="secondary"
            size="sm"
            aria-haspopup="dialog"
            onClick={() => openOverlay(ADD_FLOOR_OVERLAY)}
          >
            Add floor…
          </Button>
        </div>
      )}
      <div className="rg-muted" style={{ fontSize: 12, marginTop: 6 }}>
        {session === "authenticated" && user ? `${user.displayName} (${user.role})` : session}
      </div>
    </Panel>
  );
}
