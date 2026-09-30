/**
 * One merge gong on its wall anchor (#43): placed from the room layout's
 * data-driven `gong` anchor, swung and lit from the last ring (timing.ts),
 * and clickable. Its look is a swappable component (BrassGongLook by
 * default). Swing and glow are written every frame straight onto the
 * objects, so a ring re-renders nothing but this component once.
 */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import type { Wall, WallAnchor } from "@regulus/floor-layout";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { anchorPlacement } from "../furniture/placement.ts";
import { BrassGongLook, GONG_DEPTH, type GongLook } from "./BrassGongLook.tsx";
import { useGongStore } from "./gongStore.ts";
import { glowAt, swingAngle } from "./timing.ts";

export interface GongObjectProps {
  wall: Wall;
  anchor: WallAnchor;
  /** The player stands in reach (`E` would bang it). */
  inReach: boolean;
  reducedMotion: boolean;
  onBang: () => void;
  look?: GongLook;
}

export function GongObject({
  wall,
  anchor,
  inReach,
  reducedMotion,
  onBang,
  look: Look = BrassGongLook,
}: GongObjectProps) {
  const p = anchorPlacement(wall, anchor);
  const ring = useGongStore((s) => s.ring);
  const strikes = useGongStore((s) => s.strikes);
  const swing = useRef<Group>(null);
  const glow = useMemo(() => ({ value: 0 }), []);
  const [hover, setHover] = useState(false);

  useLayoutEffect(() => {
    // Named for the e2e probes (tests/e2e/gongProbes.ts).
    if (swing.current) swing.current.name = "gong-swing";
  });
  useFrame(() => {
    const now = performance.now();
    if (swing.current) swing.current.rotation.x = swingAngle(ring, now, reducedMotion);
    glow.value = glowAt(ring, now);
  });

  const click = (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    onBang();
  };
  const tall = anchor.h / 2 + anchor.y;
  return (
    <group
      position={p.position}
      rotation-y={p.rotationY}
      name={`gong-${anchor.id}`}
      // Read by the e2e probes; plain data, no behaviour.
      userData={{ strikes, ringId: ring?.id ?? 0, cause: ring?.cause ?? null }}
    >
      <Look
        w={anchor.w}
        h={anchor.h}
        floor={anchor.y}
        highlighted={hover || inReach}
        swingRef={swing}
        glow={glow}
      />
      <mesh
        name={`gong-hotspot-${anchor.id}`}
        position={[0, anchor.h / 2 - tall / 2, GONG_DEPTH]}
        onClick={click}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = "";
        }}
      >
        <boxGeometry args={[anchor.w + 0.1, tall, GONG_DEPTH * 2]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  );
}
