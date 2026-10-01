import { Stats } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { PerfProbe } from "./PerfProbe.tsx";
import { FpsCounter } from "./stats.ts";

function FpsProbe() {
  const counter = useRef(new FpsCounter());
  useFrame(() => {
    window.__regulusFps = counter.current.tick(performance.now());
  });
  return null;
}

/** drei's stats.js panel, the `window.__regulusFps` probe and the frame-time probe (#190). */
export function StatsOverlay() {
  return (
    <>
      {/* Bottom right, clear of the HUD's Rooms panel (#190; stats.js pins it top left inline). */}
      <Stats className="rg-stats-panel" />
      <FpsProbe />
      <PerfProbe />
    </>
  );
}
