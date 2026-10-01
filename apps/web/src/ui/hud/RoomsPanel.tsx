/**
 * Left HUD panel since the compound (#186; replaces the elevator): where the
 * player is, quick travel (`F`), and for owners and admins "Add floor…",
 * which continues into build mode (#187). In a project room, its managers
 * get "Room settings…" (desks and decor, #187) and owners and admins
 * "Move room…" (build mode again). Floor settings live in the top bar (the
 * room you are in) and in quick travel (any room).
 */
import { useCompoundStore } from "../../state/compound.ts";
import { useFloorStore } from "../../state/floor.ts";
import { useFloorsStore } from "../../state/floors.ts";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { buildFrame } from "../build-mode/logic.ts";
import { useBuildModeStore } from "../build-mode/store.ts";
import { Button } from "../components/Button.tsx";
import { ADD_FLOOR_OVERLAY } from "../floors/AddFloorDialog.tsx";
import { canManageFloor } from "../floors/floorSettings.ts";
import { Panel } from "../Panel.tsx";
import { useRoomSettingsDock } from "../room-settings/RoomSettingsDock.tsx";
import { useLocationName } from "./floorName.ts";
import { QUICK_TRAVEL_OVERLAY } from "./QuickTravel.tsx";

export function RoomsPanel() {
  const session = useSessionStore((s) => s.status);
  const user = useSessionStore((s) => s.user);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const here = useLocationName();
  const floorId = useFloorStore((s) => s.floorId);
  const room = useCompoundStore((s) =>
    floorId ? s.world?.rooms.find((r) => r.id === floorId && r.kind === "project") : undefined,
  );
  const manages = useFloorsStore((s) => canManageFloor(s.floors, floorId));
  const officeManager = canManageOffice(user?.role);
  const move = () => {
    const world = useCompoundStore.getState().world;
    if (!world || !room) return;
    useBuildModeStore
      .getState()
      .start(world, { kind: "move", floorId: room.id, name: room.name }, buildFrame(world));
  };
  return (
    <Panel as="nav" title="Rooms" aria-label="Rooms">
      <div className="rg-muted" style={{ fontSize: 12 }}>
        You are in <strong data-testid="location">{here}</strong>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        <Button
          variant="secondary"
          size="sm"
          aria-haspopup="dialog"
          title="Quick travel to a room's door (F)"
          onClick={() => openOverlay(QUICK_TRAVEL_OVERLAY)}
        >
          Quick travel (F)
        </Button>
        {officeManager && (
          <Button
            variant="secondary"
            size="sm"
            aria-haspopup="dialog"
            onClick={() => openOverlay(ADD_FLOOR_OVERLAY)}
          >
            Add floor…
          </Button>
        )}
      </div>
      {room && (manages || officeManager) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {manages && (
            <Button
              variant="secondary"
              size="sm"
              aria-haspopup="dialog"
              onClick={() => useRoomSettingsDock.getState().open(room.id)}
            >
              Room settings…
            </Button>
          )}
          {officeManager && (
            <Button
              variant="secondary"
              size="sm"
              aria-haspopup="dialog"
              title="Pick a new spot for this room (no robots may be running in it)"
              onClick={move}
            >
              Move room…
            </Button>
          )}
        </div>
      )}
      <div className="rg-muted" style={{ fontSize: 12, marginTop: 6 }}>
        {session === "authenticated" && user ? `${user.displayName} (${user.role})` : session}
      </div>
    </Panel>
  );
}
