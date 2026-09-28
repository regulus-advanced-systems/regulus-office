import { LOBBY_FLOOR_ID } from "@regulus/protocol";
import { Suspense, useEffect } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { AvatarLayer } from "../../scene/avatars/AvatarLayer.tsx";
import { floorViewFor } from "../../scene/floorView.ts";
import { MovementController } from "../../scene/movement/MovementController.tsx";
import { OfficeCanvas } from "../../scene/OfficeCanvas.tsx";
import { RobotLayer } from "../../scene/robots/RobotLayer.tsx";
import { DepartingRobots } from "../../scene/robots/sendHome/DepartingRobots.tsx";
import { useBuildingStore } from "../../state/building.ts";
import { useFloorStore } from "../../state/floor.ts";
import { useFloorsStore } from "../../state/floors.ts";
import { useSessionStore } from "../../state/session.ts";
import { useFloorListSync } from "../floors/useFloorListSync.ts";
import { Hud } from "../Hud.tsx";

/**
 * The office: R3F scene for the floor we are on (the lobby, or a project
 * floor's own template, palette and painted name), the local and remote
 * humans, the robots at their desks (scene/robots), the HUD on top.
 */
export function OfficePage() {
  const fetchSession = useSessionStore((s) => s.fetchSession);
  const floorId = useFloorStore((s) => s.floorId);
  const floorState = useFloorStore((s) => s.state);
  const info = useFloorsStore((s) => s.floors?.find((f) => f.floorId === floorId));
  const directory = useBuildingStore((s) => s.state?.floors ?? null);
  useFloorListSync();

  useEffect(() => {
    void fetchSession();
    const client = getOfficeClient();
    void client.connect();
    return () => void client.disconnect();
  }, [fetchSession]);

  // The floor we are on was archived: take the elevator back to the lobby.
  useEffect(() => {
    if (floorId && directory && !directory[floorId]) {
      void getOfficeClient().rideTo(LOBBY_FLOOR_ID, "teleport");
    }
  }, [floorId, directory]);

  const view = floorViewFor(floorId, floorState, info);
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <OfficeCanvas
        template={view.template}
        palette={view.palette}
        floorName={view.floorName}
        avatars={<AvatarLayer />}
      >
        <MovementController template={view.template} floorKey={view.key} />
        <DepartingRobots template={view.template} />
        {floorId && view.key !== "lobby" && (
          <Suspense fallback={null}>
            <RobotLayer key={view.key} template={view.template} />
          </Suspense>
        )}
      </OfficeCanvas>
      <Hud />
    </div>
  );
}
