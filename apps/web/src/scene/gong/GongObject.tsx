/**
 * One merge gong on its wall anchor (#43): placed from the room layout's
 * data-driven `gong` anchor, swung and lit from the last ring (timing.ts),
 * and clickable. Its look is a swappable component (BrassGongLook by
 * default). Swing and glow are written every frame straight onto the
 * objects, so a ring re-renders nothing but this component once.
 */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import type { Wall, WallAnchor } from "@regulus/room-layout";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { anchorPlacement } from "../furniture/placement.ts";
import { scopedName, useRoomScope } from "../roomScope.ts";
import { BrassGongLook, GONG_DEPTH, type GongLook } from "./BrassGongLook.tsx";
import { useGongStore } from "./gongStore.ts";
import { glowAt, swingAngle, swingPeak } from "./timing.ts";

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
  const scope = useRoomScope();
  const p = anchorPlacement(wall, anchor, scope.wallDepth);
  // The gong store follows the room the player is in; other rooms' gongs hang still.
  const ring = useGongStore((s) => (scope.interactive ? s.ring : null));
  const strikes = useGongStore((s) => (scope.interactive ? s.strikes : 0));
  const swing = useRef<Group>(null);
  const glow = useMemo(() => ({ value: 0 }), []);
  const [hover, setHover] = useState(false);

  useLayoutEffect(() => {
    // Named for the e2e probes (tests/e2e/gongProbes.ts).
    if (swing.current) swing.current.name = scopedName(scope, "gong-swing");
  });
  // The animation the current ring plays (e2e probes read it rather than sampling frames).
  const peak = useMemo(() => swingPeak(ring, reducedMotion), [ring, reducedMotion]);
  const swung = useRef({ ringId: 0, frames: 0, last: 0 });
  useFrame(() => {
    const now = performance.now();
    const angle = swingAngle(ring, now, reducedMotion);
    if (swing.current) swing.current.rotation.x = angle;
    glow.value = glowAt(ring, now);
    // Frames drawn with the disc off centre for this ring, and the time of the last one.
    const id = ring?.id ?? 0;
    // Mutated in place: `userData.swung` holds this very object.
    if (swung.current.ringId !== id)
      Object.assign(swung.current, { ringId: id, frames: 0, last: 0 });
    if (angle !== 0) {
      swung.current.frames += 1;
      swung.current.last = now;
    }
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
      name={scopedName(scope, `gong-${anchor.id}`)}
      // Read by the e2e probes; plain data, no behaviour.
      userData={{
        strikes,
        ringId: ring?.id ?? 0,
        cause: ring?.cause ?? null,
        ringAt: ring?.at ?? 0,
        swingPeak: peak,
        swung: swung.current,
      }}
    >
      <Look
        w={anchor.w}
        h={anchor.h}
        floor={anchor.y}
        highlighted={hover || inReach}
        swingRef={swing}
        glow={glow}
      />
      {scope.interactive && (
        <mesh
          name={`gong-hotspot-${anchor.id}`}
          // Hit target only: invisible objects still take pointer events but cost no draw call.
          visible={false}
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
      )}
    </group>
  );
}
