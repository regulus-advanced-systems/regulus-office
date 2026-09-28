/**
 * Cream overlay that draws the view crossfade (SPEC §9.2, §12) and drives
 * the view store's clock from requestAnimationFrame, so the camera swaps at
 * the midpoint and the fade ends on time. Plain DOM above the canvas;
 * pointer events pass through. Reduced motion never starts a fade, so the
 * overlay simply stays at opacity 0.
 */
import { useEffect, useRef } from "react";
import { useViewStore } from "../../state/view.ts";
import { CREAM } from "../backdrop.ts";
import { crossfadeOpacity } from "./crossfade.ts";

export function ViewCrossfade({ store = useViewStore }: { store?: typeof useViewStore }) {
  const fade = store((s) => s.fade);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!fade) {
      el.style.opacity = "0";
      return;
    }
    let handle = 0;
    const frame = () => {
      const now = performance.now();
      el.style.opacity = String(crossfadeOpacity(now - fade.startedAt, fade.durationMs));
      store.getState().tick(now);
      if (store.getState().fade === fade) handle = requestAnimationFrame(frame);
    };
    handle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(handle);
  }, [fade, store]);

  return (
    <div
      ref={ref}
      aria-hidden
      data-testid="view-crossfade"
      style={{
        position: "absolute",
        inset: 0,
        background: CREAM,
        opacity: 0,
        pointerEvents: "none",
        zIndex: 1,
      }}
    />
  );
}
