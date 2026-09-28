/**
 * Keeps the REST floor list (state/floors.ts) fresh: on mount, whenever the
 * BuildingRoom's floor directory changes (a floor was added or archived),
 * and every `pollMs` while a repo is still cloning.
 */
import { useEffect } from "react";
import { useBuildingStore } from "../../state/building.ts";
import { anyCloning, useFloorsStore } from "../../state/floors.ts";

export function useFloorListSync(pollMs = 2000): void {
  const refresh = useFloorsStore((s) => s.refresh);
  const directory = useBuildingStore((s) =>
    s.state ? Object.keys(s.state.floors).sort().join(",") : "",
  );
  const cloning = useFloorsStore((s) => anyCloning(s.floors));

  useEffect(() => {
    void refresh();
  }, [refresh, directory]);

  useEffect(() => {
    if (!cloning) return;
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [cloning, refresh, pollMs]);
}
