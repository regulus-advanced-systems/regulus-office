/**
 * Left HUD panel since the compound (#186; replaces the elevator): where the
 * player is, quick travel (`F`), and for owners and admins "Add floor…",
 * whose new room places itself on the compound map. Floor settings live
 * in the top bar (the room you are in) and in quick travel (any room).
 */
import { canManageOffice, useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { ADD_FLOOR_OVERLAY } from "../floors/AddFloorDialog.tsx";
import { Panel } from "../Panel.tsx";
import { useLocationName } from "./floorName.ts";
import { QUICK_TRAVEL_OVERLAY } from "./QuickTravel.tsx";

export function RoomsPanel() {
  const session = useSessionStore((s) => s.status);
  const user = useSessionStore((s) => s.user);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const here = useLocationName();
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
        {canManageOffice(user?.role) && (
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
      <div className="rg-muted" style={{ fontSize: 12, marginTop: 6 }}>
        {session === "authenticated" && user ? `${user.displayName} (${user.role})` : session}
      </div>
    </Panel>
  );
}
