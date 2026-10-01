/**
 * The debug scene's rooms (#183), made by the room generator (#182): the
 * main ops room the screenshots look at, plus a gallery of the same small
 * layout in the other decor styles so they can be compared side by side.
 * The main room also gets lair-only extras the generator does not place yet
 * (a console bank, a tape mainframe, lockers and some clutter) in its free
 * wall space, and a laptop at every desk seat. Pure data.
 */
import { generateRoom, HEADING, type RoomLayout } from "@regulus/floor-layout";
import { DECOR_STYLES, type DecorStyle } from "@regulus/protocol";
import { lairModelScene } from "../components/LairModels.tsx";
import { TILE } from "../dimensions.ts";
import type { Vec3 } from "../geometry/builder.ts";
import type { PiecePlacement } from "../placements.ts";
import { type LairRoomScene, lairRoomScene } from "../roomScene.ts";

/** The main room: 10 x 8 tiles at the origin, three desks, door on the south side. */
export const ROOM = { w: 10, d: 8, desks: 3 } as const;

export function mainRoomLayout(style: DecorStyle = "ops_room"): RoomLayout {
  return generateRoom({
    width: ROOM.w,
    depth: ROOM.d,
    doorSide: "south",
    deskCount: ROOM.desks,
    decorStyle: style,
  });
}

const r = (x: number, z: number, w: number, d: number) => ({ x, z, w, d });

/** Extras along the free stretch of the north wall, the east stub wall and the west wall. */
const EXTRAS = [
  { id: "console", rect: r(10.1, 0.15, 1.8, 0.95), heading: HEADING.south },
  { id: "console", rect: r(12.1, 0.15, 1.8, 0.95), heading: HEADING.south },
  { id: "mainframe", rect: r(16.4, 0.15, 1.34, 0.8), heading: HEADING.south },
  { id: "lockers", rect: r(19.4, 6.2, 0.54, 1.3), heading: HEADING.west },
  { id: "crate_stack", rect: r(17.6, 13.4, 1.76, 0.95), heading: HEADING.north },
  { id: "barrel", rect: r(0.25, 8.6, 0.6, 0.6), heading: HEADING.east },
  { id: "barrel", rect: r(0.3, 9.3, 0.6, 0.6), heading: HEADING.east },
  { id: "crate", rect: r(0.25, 10.2, 0.83, 0.83), heading: HEADING.east },
] as const;

/** A laptop on the desk in front of every desk seat, its screen toward the sitter. */
export function deskLaptops(layout: RoomLayout, reach = 0.72, top = 0.76): PiecePlacement[] {
  return layout.seats
    .filter((s) => s.kind === "desk")
    .map((s) => {
      const h = s.pose.heading;
      return {
        piece: "laptop",
        position: [s.pose.x - Math.sin(h) * reach, top, s.pose.z - Math.cos(h) * reach],
        rotationY: h,
      };
    });
}

export function mainRoom(style: DecorStyle = "ops_room"): LairRoomScene {
  const layout = mainRoomLayout(style);
  const scene = lairRoomScene(layout);
  const extras = lairModelScene(EXTRAS);
  return {
    ...scene,
    pieces: [...scene.pieces, ...extras.pieces, ...deskLaptops(layout)],
    consoleLamps: [...scene.consoleLamps, ...extras.lamps],
  };
}

/** Move a whole room scene by (dx, dz). */
export function offsetScene(s: LairRoomScene, dx: number, dz: number): LairRoomScene {
  const at = (p: Vec3): Vec3 => [p[0] + dx, p[1], p[2] + dz];
  const move = <T extends { position: Vec3 }>(items: readonly T[]): T[] =>
    items.map((i) => ({ ...i, position: at(i.position) }));
  return {
    ...s,
    pieces: move(s.pieces),
    lamps: move(s.lamps),
    doors: move(s.doors),
    beacons: move(s.beacons),
    looks: move(s.looks),
    consoleLamps: s.consoleLamps.map((l) => ({ ...l, pos: at(l.pos) })),
    lights: s.lights.map((l) => ({ ...l, x: l.x + dx, z: l.z + dz })),
  };
}

/** The gallery: one 6 x 5 room per other decor style, in a row north of the main room. */
export const GALLERY = { w: 6, d: 5, z: -14, pitch: 15 } as const;

export function styleGallery(): LairRoomScene[] {
  return DECOR_STYLES.filter((s) => s !== "ops_room").map((decorStyle, i) => {
    const layout = generateRoom({
      width: GALLERY.w,
      depth: GALLERY.d,
      doorSide: "south",
      deskCount: 2,
      decorStyle,
    });
    const scene = lairRoomScene(layout);
    const withLaptops = { ...scene, pieces: [...scene.pieces, ...deskLaptops(layout)] };
    return offsetScene(withLaptops, i * GALLERY.pitch, GALLERY.z);
  });
}

/** Where the corridor junction starts: centred on the main room's door, outside its wall. */
export function corridorOrigin(scene: LairRoomScene, corridorWidth: number, wall: number): Vec3 {
  const xs = scene.doors.map((d) => d.position[0]);
  const centre = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : (ROOM.w * TILE) / 2;
  return [centre - corridorWidth / 2, 0, ROOM.d * TILE + wall];
}
