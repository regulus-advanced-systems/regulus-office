/**
 * Sparks and dust for the build phase (#183): each is one `Points` draw
 * with an additive soft sprite, stepped by sim.ts. Mount them while a room
 * is `building` (#187); they cost nothing once unmounted.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  LinearFilter,
  PointsMaterial,
  RGBAFormat,
} from "three";
import { mulberry32 } from "../../materials/grime.ts";
import type { Vec3 } from "../geometry/builder.ts";
import {
  createPool,
  type DustBox,
  dustAlpha,
  lifeFraction,
  seedDust,
  softDotPixels,
  sparkColor,
  stepDust,
  stepSparks,
} from "./sim.ts";

function useSprite(): DataTexture {
  const tex = useMemo(() => {
    const t = new DataTexture(softDotPixels(32), 32, 32, RGBAFormat);
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.needsUpdate = true;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

function usePoints(count: number, size: number, sprite: DataTexture) {
  const geo = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(count * 3), 3));
    return g;
  }, [count]);
  const mat = useMemo(
    () =>
      new PointsMaterial({
        size,
        map: sprite,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [size, sprite],
  );
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  return { geo, mat };
}

/** Welding sparks bursting from `origin`. */
export function Sparks({
  origin,
  count = 90,
  seed = 1,
}: {
  origin: Vec3;
  count?: number;
  seed?: number;
}) {
  const sprite = useSprite();
  const { geo, mat } = usePoints(count, 0.07, sprite);
  const pool = useMemo(() => createPool(count), [count]);
  const rand = useMemo(() => mulberry32(seed), [seed]);
  const rgb: [number, number, number] = [0, 0, 0];
  useFrame((_, dt) => {
    stepSparks(pool, Math.min(dt, 0.05), rand, origin);
    const p = geo.getAttribute("position") as BufferAttribute;
    const c = geo.getAttribute("color") as BufferAttribute;
    (p.array as Float32Array).set(pool.pos);
    for (let i = 0; i < count; i++) {
      sparkColor(lifeFraction(pool, i), rgb);
      const alive = (pool.life[i] ?? 0) > 0 ? 1 : 0;
      c.setXYZ(i, rgb[0] * alive, rgb[1] * alive, rgb[2] * alive);
    }
    p.needsUpdate = true;
    c.needsUpdate = true;
  });
  return <points geometry={geo} material={mat} frustumCulled={false} name="lair:sparks" />;
}

const DUST_RGB = [0.55, 0.47, 0.36] as const;

/** Dust drifting up through `box` (a building site, a lamp's light pool). */
export function Dust({
  box,
  count = 60,
  size = 0.3,
  seed = 2,
}: {
  box: DustBox;
  count?: number;
  size?: number;
  seed?: number;
}) {
  const sprite = useSprite();
  const { geo, mat } = usePoints(count, size, sprite);
  const rand = useMemo(() => mulberry32(seed), [seed]);
  const pool = useMemo(() => {
    const p = createPool(count);
    seedDust(p, rand, box);
    return p;
  }, [count, rand, box]);
  useFrame(({ clock }, dt) => {
    stepDust(pool, Math.min(dt, 0.05), clock.elapsedTime, rand, box);
    const p = geo.getAttribute("position") as BufferAttribute;
    const c = geo.getAttribute("color") as BufferAttribute;
    (p.array as Float32Array).set(pool.pos);
    for (let i = 0; i < count; i++) {
      const a = dustAlpha(lifeFraction(pool, i)) * 0.5;
      c.setXYZ(i, DUST_RGB[0] * a, DUST_RGB[1] * a, DUST_RGB[2] * a);
    }
    p.needsUpdate = true;
    c.needsUpdate = true;
  });
  return <points geometry={geo} material={mat} frustumCulled={false} name="lair:dust" />;
}
