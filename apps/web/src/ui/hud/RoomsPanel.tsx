/**
 * Left HUD panel since the compound (#186; replaces the elevator): where the
 * player is, quick travel (`F`), and for owners and admins "Add operation…",
 * which continues into build mode (#187). In a project room, its managers
 * get "Room settings…" (desks and decor, #187) and owners and admins
 * "Move room…" (build mode again). Operation settings live in the top bar (the
 * room you are in) and in quick travel (any room).
 */
import { useCompoundStore } from "../../state/compound.ts";
import { useOperationStore } from "../../state/operation.ts";
import { useOperationsStore } from "../../state/operations.ts";
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { buildFrame } from "../build-mode/logic.ts";
import { useBuildModeStore } from "../build-mode/store.ts";
import { Button } from "../components/Button.tsx";
import { MeetingRoomButton } from "../meetings/MeetingHost.tsx";
import { ADD_OPERATION_OVERLAY } from "../operations/AddOperationDialog.tsx";
import { canManageOperation } from "../operations/operationSettings.ts";
import { Panel } from "../Panel.tsx";
import { useRoomSettingsDock } from "../room-settings/RoomSettingsDock.tsx";
import { useLocationName } from "./operationName.ts";
import { QUICK_TRAVEL_OVERLAY } from "./QuickTravel.tsx";

export function RoomsPanel() {
  const session = useSessionStore((s) => s.status);
  const user = useSessionStore((s) => s.user);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const here = useLocationName();
  const operationId = useOperationStore((s) => s.operationId);
  const room = useCompoundStore((s) =>
    operationId
      ? s.world?.rooms.find((r) => r.id === operationId && r.kind === "project")
      : undefined,
  );
  const manages = useOperationsStore((s) => canManageOperation(s.operations, operationId));
  const officeManager = canManageOffice(user?.role);
  const move = () => {
    const world = useCompoundStore.getState().world;
    if (!world || !room) return;
    useBuildModeStore
      .getState()
      .start(world, { kind: "move", operationId: room.id, name: room.name }, buildFrame(world));
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
        {room && <MeetingRoomButton />}
        {officeManager && (
          <Button
            variant="secondary"
            size="sm"
            aria-haspopup="dialog"
            onClick={() => openOverlay(ADD_OPERATION_OVERLAY)}
          >
            New operation…
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
              title="Pick a new spot for this room (no henchmen may be running in it)"
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
