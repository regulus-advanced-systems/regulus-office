/**
 * A usage screen hung on a `usage_wall` wall anchor (#40, SPEC §9.4): the
 * lobby's big tracker wall or the small screen of a room, picked by the
 * anchor's width. A small swappable component: WallAnchors only passes the
 * anchor size, so the compound restyle (M2.5) can re-home or re-skin it
 * without touching the data path. Clicking it opens the HUD usage panel.
 */
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { MeshBasicMaterial } from "three";
import { useBuildingStore } from "../../state/building.ts";
import { buildUsageModel } from "../../ui/usage/model.ts";
import { useMyUsageStore } from "../../ui/usage/usageStore.ts";
import { createToonMaterial } from "../materials/toon.ts";
import { UsageTexture, variantForAnchor } from "./usageTexture.ts";

const FRAME_COLOR = "#3A3F47";
const BEZEL = 0.06;

function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function UsageScreen({ w, h }: { w: number; h: number }) {
  const variant = variantForAnchor(w);
  const screen = useMemo(() => new UsageTexture(variant), [variant]);
  const material = useMemo(
    () => new MeshBasicMaterial({ map: screen.texture, toneMapped: false }),
    [screen],
  );
  const frame = useMemo(() => createToonMaterial(FRAME_COLOR), []);
  useEffect(
    () => () => {
      material.dispose();
      screen.dispose();
    },
    [material, screen],
  );
  useEffect(() => () => frame.dispose(), [frame]);

  const mine = useMyUsageStore((s) => s.mine);
  const office = useBuildingStore((s) => s.state?.usage ?? null);
  const openPanel = useMyUsageStore((s) => s.togglePanel);
  const now = useMinute();
  useEffect(() => {
    screen.update(buildUsageModel(mine, office, now));
  }, [screen, mine, office, now]);

  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    openPanel(true);
  };
  return (
    <group name={`usage-screen-${variant}`}>
      <mesh position={[0, 0, 0.025]} material={frame}>
        <boxGeometry args={[w + BEZEL * 2, h + BEZEL * 2, 0.05]} />
      </mesh>
      <mesh
        position={[0, 0, 0.052]}
        material={material}
        onClick={click}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        <planeGeometry args={[w, h]} />
      </mesh>
    </group>
  );
}
