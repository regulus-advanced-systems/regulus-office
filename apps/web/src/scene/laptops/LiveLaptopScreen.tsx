/**
 * The focused desk's laptop shows the robot's live terminal (SPEC §9.4):
 * xterm.js in a drei `<Html transform occlude="blending">` sized to the
 * screen, watch-only and not interactive (clicking the laptop opens the
 * modal). One of the ≤ 2 live DOM panels; the caller only mounts it once
 * the panel budget granted a slot.
 */
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useState } from "react";
import { defaultTerminalDeps, type TerminalDeps } from "../../ui/terminal/host.ts";
import { useTerminal } from "../../ui/terminal/useTerminal.ts";
import { LAPTOP_DIMENSIONS } from "./Laptop.tsx";

/** CSS size of the live panel; drei maps it onto the screen plane. */
export const LIVE_PANEL_PX = {
  width: 640,
  height: Math.round((640 * LAPTOP_DIMENSIONS.screenH) / LAPTOP_DIMENSIONS.screenW),
} as const;

/** drei transform mode: 1 CSS px = distanceFactor / 400 world units. */
export const LIVE_DISTANCE_FACTOR = (LAPTOP_DIMENSIONS.screenW * 400) / LIVE_PANEL_PX.width;

function LiveTerminal({ agentId, deps }: { agentId: string; deps: TerminalDeps }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useTerminal({ agentId, mode: "watch", element, deps });
  return (
    <div
      ref={setElement}
      data-testid="laptop-live-terminal"
      style={{
        width: LIVE_PANEL_PX.width,
        height: LIVE_PANEL_PX.height,
        background: "#16161D",
        overflow: "hidden",
      }}
    />
  );
}

export function LiveLaptopScreen({
  agentId,
  deps = defaultTerminalDeps,
}: {
  agentId: string;
  deps?: TerminalDeps;
}) {
  const gl = useThree((s) => s.gl);
  // occlude="blending" turns canvas pointer events off; the scene (wheel zoom, pointer
  // lock, click-to-walk) needs them and the live panel is display-only anyway.
  useLayoutEffect(() => {
    gl.domElement.style.pointerEvents = "auto";
  }, [gl]);
  return (
    <Html
      transform
      occlude="blending"
      distanceFactor={LIVE_DISTANCE_FACTOR}
      pointerEvents="none"
      zIndexRange={[20, 0]}
    >
      <LiveTerminal agentId={agentId} deps={deps} />
    </Html>
  );
}
