/**
 * The outside of the compound (SPEC §9.1 Outside, §12; #188), laid out from
 * the published blast door: a cove of beach in front of the lobby's blast
 * door, cut into the mountain's south face, with a wooden dock running out
 * into the sea, a moored boat, rocks and palms. Pure data in compound metres
 * (x east, z south; the compound's south edge at `edgeZ`), shared by the art,
 * the nav grid and the e2e probe, so what is drawn is what is walkable.
 *
 * The published outside strip (`outsideDepth` rows of beach) is walkable as
 * a whole in `buildCompoundNavGrid`; the nav grid here runs a few rows
 * further south for the dock, and blocks the sea, the headlands and the
 * props with obstacles.
 */
import type { Rect } from "@regulus/room-layout";
import { blastDoorButtons } from "@regulus/protocol";
import { mulberry32 } from "../../materials/grime.ts";
import type { Bounds } from "../placed.ts";
import type { CompoundWorld } from "../world.ts";

export type OutsideInput = Pick<
  CompoundWorld,
  "width" | "depth" | "outsideDepth" | "tileMetres" | "blastDoor"
>;

export interface Boulder {
  x: number;
  z: number;
  /** Radius, metres. */
  r: number;
  /** Height squash (1 = round). */
  h: number;
  seed: number;
}

export interface Palm {
  x: number;
  z: number;
  height: number;
  /** Direction the trunk leans toward, radians (yaw). */
  lean: number;
  seed: number;
}

export interface OutsideLayout {
  /** The compound's south edge (the mountain face), metres. */
  edgeZ: number;
  /** Compound width, metres. */
  widthM: number;
  /** The doorway: from `x0` to `x1` on the wall line; `centre` between them. */
  door: { x0: number; x1: number; centre: number };
  /** The cove's half width at the mountain face; it widens toward the sea. */
  coveHalf: number;
  /** The dock's deck (walkable), metres. */
  dock: Rect;
  boat: { x: number; z: number; heading: number };
  rocks: Boulder[];
  palms: Palm[];
  /** Deck chairs and a parasol on the sand (blocking). */
  lounge: Rect;
  /** The portal's pillars and the rock heaped round it (blocking). */
  pillars: Rect[];
  /** The inside button and outside keypad (protocol positions). */
  buttons: ReturnType<typeof blastDoorButtons>;
  /** Extra nav rows (tiles) south of the published strip, for the dock. */
  extraTiles: number;
  /** Where the nav grid ends (metres): the published strip plus `extraTiles`. */
  navEndZ: number;
  /** Everything outside, for culling (ground box). */
  bounds: Bounds;
}

/** Half width of the cove of beach at the mountain face, metres. */
export const COVE_HALF = 26;
/** How fast the cove widens toward the sea (metres of half width per metre south). */
const COVE_SPREAD = 0.8;
/** The flat walkable sand stops this far before the waterline. */
export const SHORE_MARGIN = 0.5;
/** Sea level, metres (the beach and the dock are at 0). */
export const SEA_LEVEL = -0.3;
const DOCK_W = 2.4;
const DOCK_LEN = 16;

/** Half width of the cove `s` metres south of the face. */
export function coveHalfAt(s: number): number {
  return COVE_HALF + Math.max(0, s) * COVE_SPREAD;
}

/** The waterline (metres, z) at `x`: a shallow bay, deepest in the middle of the cove. */
export function shoreZ(layout: Pick<OutsideLayout, "edgeZ" | "door">, x: number): number {
  const u = (x - layout.door.centre) / 30;
  return layout.edgeZ + 9.5 - 4 * u * u + 0.8 * Math.sin((x - layout.door.centre) * 0.21);
}

/** How far out the headlands reach past the face, at most (metres). */
export const HEADLAND_REACH = 22;

/** The headlands' waterline outside the cove (rock runs further out to sea, up to a point). */
export function rockShoreZ(layout: Pick<OutsideLayout, "edgeZ" | "door">, x: number): number {
  const off = Math.abs(x - layout.door.centre) - COVE_HALF;
  if (off <= 0) return shoreZ(layout, x);
  const edge = shoreZ(layout, layout.door.centre + Math.sign(x - layout.door.centre) * COVE_HALF);
  return Math.min(edge + off * 0.6, layout.edgeZ + HEADLAND_REACH);
}

/** Walkable sand at `(x, z)`: inside the cove, on the dry side of the waterline. */
export function onBeach(layout: OutsideLayout, x: number, z: number): boolean {
  const s = z - layout.edgeZ;
  if (s < 0) return false;
  if (Math.abs(x - layout.door.centre) > coveHalfAt(s) - 0.5) return false;
  return z < shoreZ(layout, x) - SHORE_MARGIN;
}

export function outsideLayout(world: OutsideInput): OutsideLayout | null {
  if (world.outsideDepth === 0 || world.blastDoor.width === 0) return null;
  const m = world.tileMetres;
  const edgeZ = world.depth * m;
  const x0 = world.blastDoor.x * m;
  const x1 = (world.blastDoor.x + world.blastDoor.width) * m;
  const centre = (x0 + x1) / 2;
  const door = { x0, x1, centre };
  const base = { edgeZ, door };
  // The dock starts on the sand east of the door and runs out past the waterline.
  const dockX = centre + 9;
  const dockZ = shoreZ(base, dockX + DOCK_W / 2) - 3.5;
  const dock: Rect = { x: dockX, z: dockZ, w: DOCK_W, d: DOCK_LEN };
  const stripEnd = edgeZ + world.outsideDepth * m;
  const extraTiles = Math.max(0, Math.ceil((dock.z + dock.d + 1 - stripEnd) / m));
  const navEndZ = stripEnd + extraTiles * m;
  const rand = mulberry32(world.blastDoor.x * 7919 + world.depth);

  const rocks: Boulder[] = [];
  // Rock spill at the foot of the face either side of the portal, and clusters at the cove's ends.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const along = 8 + i * 3.2 + rand() * 1.5;
      rocks.push({
        x: centre + side * along,
        z: edgeZ + 0.9 + rand() * 0.8,
        r: 0.9 + rand() * 0.9,
        h: 0.8 + rand() * 0.5,
        seed: rocks.length + 1,
      });
    }
    for (let i = 0; i < 6; i++) {
      const s = 1.5 + i * 1.4;
      rocks.push({
        x: centre + side * (coveHalfAt(s) - 1.2 - rand() * 1.5),
        z: edgeZ + s,
        r: 0.8 + rand() * 1.2,
        h: 0.7 + rand() * 0.6,
        seed: rocks.length + 1,
      });
    }
    // A few half-drowned rocks in the shallows, clear of the dock and the boat.
    for (let i = 0; i < 3; i++) {
      const x = centre + side * (side > 0 ? 19 + i * 3 : 12 + i * 5) + side * rand() * 2;
      rocks.push({
        x,
        z: shoreZ(base, x) + 1.5 + rand() * 4,
        r: 0.6 + rand() * 0.7,
        h: 0.6,
        seed: rocks.length + 1,
      });
    }
  }
  // Palms in two loose groups on the sand, clear of the door's approach and the dock.
  const palms: Palm[] = [];
  for (const [x, z] of [
    [centre - 15, edgeZ + 3.2],
    [centre - 18.5, edgeZ + 5.4],
    [centre - 21, edgeZ + 2.6],
    [centre - 11.5, edgeZ + 6],
    [centre + 15.5, edgeZ + 3],
    [centre + 19, edgeZ + 4.8],
    [centre + 22, edgeZ + 2.4],
  ] as const) {
    palms.push({
      x,
      z,
      height: 5.5 + rand() * 2.5,
      lean: Math.PI * (0.75 + rand() * 0.5) + (x < centre ? -0.4 : 0.4),
      seed: palms.length + 11,
    });
  }
  const pillars: Rect[] = [
    { x: x0 - 0.9, z: edgeZ + 0.3, w: 0.9, d: 0.8 },
    { x: x1, z: edgeZ + 0.3, w: 0.9, d: 0.8 },
    // Rock heaped against the face either side of the portal (portal.ts).
    { x: x0 - 6.6, z: edgeZ, w: 5.7, d: 3 },
    { x: x1 + 2.1, z: edgeZ, w: 4.8, d: 3 },
  ];
  return {
    edgeZ,
    widthM: world.width * m,
    door,
    coveHalf: COVE_HALF,
    dock,
    boat: { x: dock.x + dock.w + 1.9, z: dock.z + dock.d - 5, heading: 0.04 },
    rocks,
    palms,
    pillars,
    lounge: { x: centre - 17, z: edgeZ + 3.6, w: 3.2, d: 2 },
    buttons: blastDoorButtons({
      tileMetres: m,
      blastDoorX: world.blastDoor.x,
      blastDoorY: world.blastDoor.y,
      blastDoorWidth: world.blastDoor.width,
      width: world.width,
    }),
    extraTiles,
    navEndZ,
    bounds: {
      minX: centre - coveHalfAt(30) - 6,
      maxX: centre + coveHalfAt(30) + 6,
      minZ: edgeZ - 2,
      maxZ: edgeZ + 40,
    },
  };
}

const SLICE = 0.5;

/**
 * Nav obstacles outside (metres): beyond the cove and the waterline, except
 * the dock's deck; the boulders, palm trunks and the portal's pillars.
 */
export function outsideObstacles(layout: OutsideLayout): Rect[] {
  const out: Rect[] = [];
  const { edgeZ, navEndZ, dock, door } = layout;
  const depth = navEndZ - edgeZ;
  for (let x = 0; x < layout.widthM; x += SLICE) {
    const mid = x + SLICE / 2;
    const off = Math.abs(mid - door.centre) + SLICE / 2;
    // South of the face, the sand starts where the cove is wide enough here.
    const start = edgeZ + Math.max(0, (off + 0.5 - COVE_HALF) / COVE_SPREAD);
    const end = Math.min(
      shoreZ(layout, x) - SHORE_MARGIN,
      shoreZ(layout, x + SLICE) - SHORE_MARGIN,
      navEndZ,
    );
    const onDock = x >= dock.x - 1e-6 && x + SLICE <= dock.x + dock.w + 1e-6;
    if (start >= end) {
      if (!onDock) {
        out.push({ x, z: edgeZ, w: SLICE, d: depth });
        continue;
      }
      out.push({ x, z: edgeZ, w: SLICE, d: Math.max(0, dock.z - edgeZ) });
    } else if (start > edgeZ) {
      out.push({ x, z: edgeZ, w: SLICE, d: start - edgeZ });
    }
    if (onDock) {
      const after = dock.z + dock.d;
      if (after < navEndZ) out.push({ x, z: after, w: SLICE, d: navEndZ - after });
    } else if (end < navEndZ) {
      out.push({ x, z: end, w: SLICE, d: navEndZ - end });
    }
  }
  for (const r of layout.rocks) {
    const half = r.r * 0.75;
    out.push({ x: r.x - half, z: r.z - half, w: 2 * half, d: 2 * half });
  }
  for (const p of layout.palms) out.push({ x: p.x - 0.3, z: p.z - 0.3, w: 0.6, d: 0.6 });
  out.push(...layout.pillars, layout.lounge);
  return out.filter((r) => r.w > 0 && r.d > 0);
}

/** A point on the dock's deck, `t` from its root (0) to its end (1), for walking out. */
export function dockPoint(layout: OutsideLayout, t: number): { x: number; z: number } {
  const { dock } = layout;
  return { x: dock.x + dock.w / 2, z: dock.z + 0.6 + (dock.d - 1.2) * Math.min(1, Math.max(0, t)) };
}
