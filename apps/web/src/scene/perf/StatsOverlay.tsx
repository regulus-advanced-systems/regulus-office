import { Stats } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { FpsCounter } from "./stats.ts";

function FpsProbe() {
  const counter = useRef(new FpsCounter());
  useFrame(() => {
    window.__regulusFps = counter.current.tick(performance.now());
  });
  return null;
}

/** drei's stats.js panel plus the `window.__regulusFps` probe used by the perf check. */
export function StatsOverlay() {
  return (
    <>
      <Stats />
      <FpsProbe />
    </>
  );
}
