import { useEffect } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { AvatarLayer } from "../../scene/avatars/AvatarLayer.tsx";
import { CompoundCanvas } from "../../scene/compound/CompoundCanvas.tsx";
import { useCompoundStore, useCompoundWorldSync } from "../../state/compound.ts";
import { useSessionStore } from "../../state/session.ts";
import { AvatarPickerHost } from "../avatar-picker/AvatarPickerHost.tsx";
import { useFloorListSync } from "../floors/useFloorListSync.ts";
import { Hud } from "../Hud.tsx";

/**
 * The office: the whole compound as one R3F scene (SPEC §9, #186), with the
 * local and remote humans, the live rooms nearby (robots, boards, laptops,
 * the merge gong) and the HUD on top. The scene waits for the compound
 * layout from the BuildingRoom.
 */
export function OfficePage() {
  const fetchSession = useSessionStore((s) => s.fetchSession);
  const world = useCompoundStore((s) => s.world);
  useFloorListSync();
  useCompoundWorldSync();

  useEffect(() => {
    void fetchSession();
    const client = getOfficeClient();
    void client.connect();
    return () => void client.disconnect();
  }, [fetchSession]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#141312" }}>
      {world && <CompoundCanvas world={world} avatars={<AvatarLayer />} />}
      <Hud />
      <AvatarPickerHost />
    </div>
  );
}
