import { useEffect } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { OfficeCanvas } from "../../scene/OfficeCanvas.tsx";
import { useSessionStore } from "../../state/session.ts";
import { Hud } from "../Hud.tsx";

/** The office: R3F scene (placeholder until #14) with the HUD on top. */
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
      <OfficeCanvas />
      <Hud />
    </div>
  );
}
