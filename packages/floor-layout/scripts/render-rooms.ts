/**
 * Writes top-down SVG renders of generated rooms (#182) for review:
 *   bun packages/floor-layout/scripts/render-rooms.ts [outDir]
 * Default outDir: docs/screenshots/182. One file per case below.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DecorStyle } from "@regulus/protocol";
import type { CompassDirection } from "../src/geometry.ts";
import { generateRoom, maxDeskCount, roomLayoutSvg } from "../src/room/index.ts";

const out = process.argv[2] ?? join(import.meta.dir, "../../../docs/screenshots/182");
mkdirSync(out, { recursive: true });

type Case = [number, number, CompassDirection, number | "max", DecorStyle];
const cases: Case[] = [
  [4, 4, "south", 1, "ops_room"],
  [6, 5, "east", 1, "ops_room"],
  [6, 6, "south", "max", "lab"],
  [8, 7, "south", 2, "ops_room"],
  [8, 7, "south", "max", "workshop"],
  [11, 7, "west", 3, "war_room"],
  [10, 10, "north", 5, "lab"],
  [12, 9, "east", 5, "workshop"],
  [12, 12, "south", "max", "war_room"],
  [12, 12, "south", "max", "ops_room"],
];

for (const [width, depth, doorSide, count, style] of cases) {
  const deskCount = count === "max" ? maxDeskCount(width, depth) : count;
  const layout = generateRoom({ width, depth, doorSide, deskCount, decorStyle: style });
  const title = `${width}×${depth} tiles, door ${doorSide}, ${deskCount}/${layout.room.maxDeskCount} desks, ${style}`;
  const file = `room-${width}x${depth}-${doorSide}-${deskCount}desks-${style}.svg`;
  writeFileSync(join(out, file), `${roomLayoutSvg(layout, title)}\n`);
  console.log(file);
}
