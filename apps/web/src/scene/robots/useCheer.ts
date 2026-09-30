/**
 * React side of cheer.ts: whether this robot cheers for the merge gong now
 * (#43). Re-renders the robot when a ring starts and once more when its
 * cheer is over; nothing per frame.
 */
import { useEffect, useState } from "react";
import { useGongStore } from "../gong/gongStore.ts";
import { cheerRemaining } from "../gong/timing.ts";
import { robotCheers } from "./cheer.ts";

export function useCheer(seated: boolean, reducedMotion: boolean): boolean {
  const ring = useGongStore((s) => s.ring);
  const [, rerender] = useState(0);
  const now = performance.now();
  const cheering = robotCheers({ seated }, ring, now, reducedMotion);
  const left = cheering ? cheerRemaining(ring, now) : null;
  useEffect(() => {
    if (left === null) return;
    const timer = setTimeout(() => rerender((n) => n + 1), left + 20);
    return () => clearTimeout(timer);
  }, [left]);
  return cheering;
}
