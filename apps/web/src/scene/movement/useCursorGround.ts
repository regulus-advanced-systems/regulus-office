/**
 * Feeds the cursor tracker (cursorFacing.ts) from DOM pointer events. Only
 * a mouse or pen pointing into the 3D view counts: over a HUD panel or a
 * dialog the event target lies outside the canvas container, so the cursor
 * is dropped; leaving the window or losing focus drops it as well. Drei
 * <Html> screens rendered inside the canvas container still count as scene.
 */
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { type CursorTracker, createCursorTracker, pointerToNdc } from "./cursorFacing.ts";

export function useCursorGround(target: Window = window): CursorTracker {
  const canvas = useThree((s) => s.gl.domElement);
  const tracker = useMemo(() => createCursorTracker(), []);

  useEffect(() => {
    const container = canvas.parentElement ?? canvas;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const over = event.target instanceof Node && container.contains(event.target);
      tracker.move(
        pointerToNdc(event.clientX, event.clientY, canvas.getBoundingClientRect()),
        over,
      );
    };
    const onOut = (event: PointerEvent) => {
      if (event.relatedTarget === null) tracker.clear(); // left the window
    };
    const onBlur = () => tracker.clear();
    target.addEventListener("pointermove", onMove, { passive: true });
    target.addEventListener("pointerout", onOut, { passive: true });
    target.addEventListener("blur", onBlur);
    return () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerout", onOut);
      target.removeEventListener("blur", onBlur);
      tracker.clear();
    };
  }, [canvas, target, tracker]);

  return tracker;
}
