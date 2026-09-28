import { lobbyTemplate } from "@regulus/floor-layout";
import { useEffect } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { AvatarLayer } from "../../scene/avatars/AvatarLayer.tsx";
import { MovementController } from "../../scene/movement/MovementController.tsx";
import { OfficeCanvas } from "../../scene/OfficeCanvas.tsx";
import { useSessionStore } from "../../state/session.ts";
import { Hud } from "../Hud.tsx";

/** The office: R3F scene with the local and remote humans, the HUD on top. */
export function OfficePage() {
  const fetchSession = useSessionStore((s) => s.fetchSession);

  useEffect(() => {
    void fetchSession();
    const client = getOfficeClient();
    void client.connect();
    return () => void client.disconnect();
  }, [fetchSession]);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <OfficeCanvas template={lobbyTemplate} avatars={<AvatarLayer />}>
        <MovementController template={lobbyTemplate} />
      </OfficeCanvas>
      <Hud />
    </div>
  );
}
