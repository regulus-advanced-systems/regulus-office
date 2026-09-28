/**
 * Large office (20 desks, two pods). 28 x 18 m. A free-standing partition
 * splits the room into pod A (west) and pod B (east); the elevator opens at
 * its north end, between the pods.
 *
 * Zones (#118):
 * - pod A focus work, back-left: two shared tables and two solo desks;
 * - collaboration, front-left: issue board, PR board, whiteboard and queue
 *   clipboard on the west wall, the meeting table on a rug in front of them;
 * - pod B focus work, back-right: two shared tables, a solo desk and the CEO
 *   L-desk; the usage wall hangs on the north wall above them;
 * - break, front-right: counter with the coffee machine, water cooler and a
 *   bistro table on a rug.
 * Every desk cluster and interactable opens onto a lane of at least 1.5 m;
 * decoration is one cabinet and four large plants.
 */
import { HEADING } from "../geometry.ts";
import type { FloorTemplateInput, Seat, Wall } from "../types.ts";
import { loadTemplate } from "../validate.ts";
import {
  BIG_PLANT,
  cabinets,
  ceoDesk,
  furnish,
  perimeter,
  plant,
  rug,
  sharedTable,
  soloDesk,
  windows,
} from "./shared.ts";

const WIDTH = 28;
const DEPTH = 18;

/** Interior divider between the pods; anchors hang on its east (pod B) face. */
const partition: Wall = {
  id: "partition",
  from: { x: 14, z: 4 },
  to: { x: 14, z: 13 },
  height: "full",
  facing: "east",
  openings: [],
};

const furniture = furnish(
  [
    sharedTable("a-table-1", 3, 3.25),
    sharedTable("a-table-2", 8.5, 3.25),
    soloDesk("a-desk-1", 7.25, 8),
    soloDesk("a-desk-2", 10.75, 8),
    sharedTable("b-table-1", 16.5, 3.25),
    sharedTable("b-table-2", 22, 3.25),
    soloDesk("b-desk-1", 17.75, 8.5),
    ceoDesk("ceo", 21.5, 8.5),
  ],
  [
    cabinets("a-cabinets", 0.1, 0.1, 1.2, 0.5),
    { id: "meeting-table", kind: "meeting_table", rect: { x: 2.5, z: 12.5, w: 2.4, d: 1 } },
    { id: "kitchen-counter", kind: "counter", rect: { x: 27.3, z: 13.5, w: 0.6, d: 2.5 } },
    {
      id: "coffee-machine",
      kind: "coffee_machine",
      rect: { x: 27.35, z: 14, w: 0.5, d: 0.5 },
      standAt: { x: 26.75, z: 14.25, heading: HEADING.east },
    },
    { id: "water-cooler", kind: "water_cooler", rect: { x: 27.4, z: 12.9, w: 0.4, d: 0.4 } },
    { id: "bistro-table", kind: "bistro_table", rect: { x: 24.4, z: 14.4, w: 0.8, d: 0.8 } },
    plant("plant-entry", 12.25, 0.15, BIG_PLANT),
    plant("plant-partition", 13.6, 13.4, BIG_PLANT),
    plant("plant-sw", 0.2, 17, BIG_PLANT),
    plant("plant-ne", 27, 0.2, BIG_PLANT),
  ],
);

/** Three chairs along each long side of the meeting table, facing it. */
const meetingSide = (side: "n" | "s", z: number, heading: number): Seat[] =>
  [2.75, 3.75, 4.75].map((x, i) => ({
    id: `meeting-${side}${i + 1}`,
    kind: "chair",
    furnitureId: "meeting-table",
    pose: { x, z, heading },
  }));

export const largeTemplateInput: FloorTemplateInput = {
  id: "office-large",
  name: "Office L",
  kind: "large",
  size: { width: WIDTH, depth: DEPTH },
  wallHeight: 3,
  stubHeight: 0.4,
  walls: [
    ...perimeter(WIDTH, DEPTH, {
      north: windows([1.5, 4.5, 8.5, 17, 23]),
      west: [...windows([0.3], 0.9), ...windows([2.25, 5.5])],
    }),
    partition,
  ],
  nameWallId: "south",
  elevator: {
    rect: { x: 13.25, z: 0, w: 2, d: 0.6 },
    wallId: "north",
    door: { x: 14.25, z: 1.25, heading: HEADING.south },
  },
  spawn: { x: 14.25, z: 1.25, heading: HEADING.south },
  wallAnchors: [
    { id: "picture-w1", kind: "picture", wallId: "west", t: 4.75, y: 1.6, w: 0.9, h: 0.6 },
    { id: "picture-w2", kind: "picture", wallId: "west", t: 7.25, y: 1.6, w: 0.9, h: 0.6 },
    { id: "issue-board", kind: "issue_board", wallId: "west", t: 9.75, y: 1.5, w: 1.8, h: 1.2 },
    { id: "pr-board", kind: "pr_board", wallId: "west", t: 11.75, y: 1.5, w: 1.8, h: 1.2 },
    { id: "whiteboard", kind: "whiteboard", wallId: "west", t: 14.25, y: 1.4, w: 2.4, h: 1.2 },
    {
      id: "queue-clipboard",
      kind: "queue_clipboard",
      wallId: "west",
      t: 16.25,
      y: 1.5,
      w: 0.5,
      h: 0.7,
    },
    { id: "usage-wall", kind: "usage_wall", wallId: "north", t: 20.25, y: 1.7, w: 1.4, h: 0.9 },
    { id: "picture-n1", kind: "picture", wallId: "north", t: 26.25, y: 1.6, w: 0.9, h: 0.6 },
    { id: "picture-p1", kind: "picture", wallId: "partition", t: 4.75, y: 1.6, w: 0.9, h: 0.6 },
  ],
  obstacles: furniture.obstacles,
  rugs: [rug("collab-rug", 2, 11.25, 3.75, 3.5), rug("kitchen-rug", 23, 13.25, 4.25, 3.75, "alt")],
  seats: [
    ...furniture.seats,
    ...meetingSide("n", 12.25, HEADING.south),
    ...meetingSide("s", 13.75, HEADING.north),
    {
      id: "bistro-1",
      kind: "chair",
      furnitureId: "bistro-table",
      pose: { x: 23.75, z: 14.75, heading: HEADING.east },
    },
    {
      id: "bistro-2",
      kind: "chair",
      furnitureId: "bistro-table",
      pose: { x: 24.75, z: 15.75, heading: HEADING.north },
    },
  ],
};

export const largeTemplate = loadTemplate(largeTemplateInput);
