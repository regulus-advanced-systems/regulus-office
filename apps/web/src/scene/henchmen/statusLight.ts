/**
 * The status light (#281, SPEC §9.3): a short light bar on each shoulder, one
 * each side of the collar, so a bare-headed henchman shows its status to a
 * camera that looks down from any side: the head never hides both, and raised
 * arms pass outside them. One mesh (both bars in one geometry) on the Body
 * bone, drawn unlit in the status colour (avatar/statusBulb.ts). The dark
 * sockets under the bars are part of the body mesh.
 */
import { type BufferGeometry, CapsuleGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { box, type Part, part, type V3 } from "./shapes.ts";

/** Radius of a bar and half the length of its straight part, metres. */
export const LIGHT_RADIUS = 0.033;

/**
 * Per body build: the left bar's centre (the right one is its mirror in x), half its
 * straight length along the shoulder, and how far it tips down towards the arm (radians).
 */
export const LIGHT_BARS = {
  crew: { at: [0.152, 1.446, -0.004], half: 0.04, slope: 0.22 },
  secretary: { at: [0.132, 1.435, -0.004], half: 0.03, slope: 0.28 },
} as const satisfies Record<string, { at: V3; half: number; slope: number }>;
export type LightBuild = keyof typeof LIGHT_BARS;

/** The sockets the bars sit in. */
export function lightMounts(build: LightBuild): Part[] {
  const { at, half, slope } = LIGHT_BARS[build];
  const socket = (s: number) =>
    part(
      box([half * 2 + 0.05, 0.024, 0.07], {
        at: [at[0] * s, at[1] - 0.02, at[2]],
        rot: [0, 0, -slope * s],
      }),
      "hatDark",
      "Body",
    );
  return [socket(1), socket(-1)];
}

const geometries = new Map<LightBuild, BufferGeometry>();

/** Both bars as one geometry, centred between them (cached per build). */
export function lightGeometry(build: LightBuild): BufferGeometry {
  let g = geometries.get(build);
  if (!g) {
    const { at, half, slope } = LIGHT_BARS[build];
    const bar = (s: number) =>
      new CapsuleGeometry(LIGHT_RADIUS, half * 2, 2, 8)
        .rotateZ(Math.PI / 2 - slope * s)
        .translate(at[0] * s, 0, 0);
    g = mergeGeometries([bar(1), bar(-1)], false);
    if (!g) throw new Error("status light does not merge");
    g.computeBoundingSphere();
    geometries.set(build, g);
  }
  return g;
}

/** The point between the two bars, model space. */
export function lightCentre(build: LightBuild): V3 {
  const [, y, z] = LIGHT_BARS[build].at;
  return [0, y, z];
}

/** How much of the light a camera straight above sees, square metres (both bars). */
export function lightAreaFromAbove(build: LightBuild): number {
  const { half } = LIGHT_BARS[build];
  return 2 * (2 * LIGHT_RADIUS * 2 * half + Math.PI * LIGHT_RADIUS ** 2);
}
