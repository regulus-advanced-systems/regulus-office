/**
 * React side of animationSettle.ts: the animation a robot shows, following
 * the wanted one without flapping (#159). Re-renders the robot when a pending
 * change or a one-shot comes due.
 */
import type { AvatarAnimation } from "@regulus/protocol";
import { useEffect, useRef, useState } from "react";
import { type SettleState, settleDeadline, settleStart, settleStep } from "./animationSettle.ts";

export function useSettledAnimation(wanted: AvatarAnimation): AvatarAnimation {
  const state = useRef<SettleState | null>(null);
  const now = performance.now();
  state.current = state.current ? settleStep(state.current, wanted, now) : settleStart(wanted, now);
  const current = state.current;
  const due = settleDeadline(current, now);

  const [, rerender] = useState(0);
  useEffect(() => {
    if (due === null) return;
    const timer = setTimeout(() => rerender((n) => n + 1), due + 20);
    return () => clearTimeout(timer);
  }, [due, current.wanted, current.shown]);
  return current.shown;
}
