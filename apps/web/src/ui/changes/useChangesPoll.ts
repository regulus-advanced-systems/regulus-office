/**
 * Poll a henchman's changes every `CHANGES_POLL_MS` while the window is open
 * (#38). The next poll is scheduled after the previous answer, so a slow
 * runner never piles requests up, and polling pauses while the tab is
 * hidden. `refresh()` polls now (after a commit or discard).
 */
import { CHANGES_POLL_MS, type ChangesSnapshot } from "@regulus/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangesApi, ChangesFailure } from "./api.ts";

export interface ChangesPoll {
  snapshot: ChangesSnapshot | null;
  error: ChangesFailure | null;
  refresh: () => void;
}

export function useChangesPoll(api: ChangesApi, agentId: string, intervalMs = CHANGES_POLL_MS) {
  const [snapshot, setSnapshot] = useState<ChangesSnapshot | null>(null);
  const [error, setError] = useState<ChangesFailure | null>(null);
  const kick = useRef<() => void>(() => undefined);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    const tick = async () => {
      if (!alive || running) return;
      clearTimeout(timer);
      if (typeof document !== "undefined" && document.hidden) {
        timer = setTimeout(tick, intervalMs);
        return;
      }
      running = true;
      const res = await api.snapshot(agentId);
      running = false;
      if (!alive) return;
      if (res.ok) {
        setSnapshot(res.data);
        setError(null);
      } else {
        setError(res);
      }
      timer = setTimeout(tick, intervalMs);
    };
    kick.current = () => void tick();
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [api, agentId, intervalMs]);

  const refresh = useCallback(() => kick.current(), []);
  return { snapshot, error, refresh } satisfies ChangesPoll;
}
