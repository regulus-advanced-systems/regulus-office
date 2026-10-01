/**
 * Keeps the REST operation list (state/operations.ts) fresh: on mount, whenever the
 * BuildingRoom's operation directory changes (an operation was added or archived),
 * and every `pollMs` while a repo is still cloning.
 */
import { useEffect } from "react";
import { useBuildingStore } from "../../state/building.ts";
import { anyCloning, useOperationsStore } from "../../state/operations.ts";

export function useOperationListSync(pollMs = 2000): void {
  const refresh = useOperationsStore((s) => s.refresh);
  const directory = useBuildingStore((s) =>
    s.state ? Object.keys(s.state.operations).sort().join(",") : "",
  );
  const cloning = useOperationsStore((s) => anyCloning(s.operations));

  useEffect(() => {
    void refresh();
  }, [refresh, directory]);

  useEffect(() => {
    if (!cloning) return;
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [cloning, refresh, pollMs]);
}
