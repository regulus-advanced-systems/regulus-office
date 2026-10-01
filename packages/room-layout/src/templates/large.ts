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
 * - lounge nook, front-middle of pod B: two armchairs, coffee table and a
 *   floor lamp on a lighter floor patch; a bookshelf stands on the north wall
 *   of pod A.
 * Lived-in: rugs under every pod and desk row and the meeting table, a runner
 * from the elevator, planter boxes along the partition, a wood floor and a
 * fridge in the kitchen, mugs and fruit on the bistro table, plants on the
 * solo desks, plant groups at the zone edges, a clock, a corkboard and a
 * poster on the walls.
 * Every desk cluster and interactable opens onto a lane of at least 1.5 m.
 */
import { HEADING } from "../geometry.ts";
import type { RoomTemplateInput, Seat, Wall } from "../types.ts";
import { loadTemplate } from "../validate.ts";
import {
  bistroProps,
  bookshelf,
  deskPlant,
  loungeNook,
  patch,
  planter,
  plantGroup,
  prop,
  smallPlant,
  wallDecor,
} from "./decor.ts";
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

const nook = loungeNook("nook", 17.25, 14.75);

const furniture = furnish(
  [
    nook,
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
    { id: "meeting-table", kind: "meeting_table", rect: { x: 2.3, z: 12.5, w: 2.9, d: 1 } },
    { id: "kitchen-counter", kind: "counter", rect: { x: 27.3, z: 13.5, w: 0.6, d: 2.5 } },
    {
      id: "coffee-machine",
      kind: "coffee_machine",
      rect: { x: 27.35, z: 14, w: 0.5, d: 0.5 },
      standAt: { x: 26.75, z: 14.25, heading: HEADING.east },
    },
    { id: "water-cooler", kind: "water_cooler", rect: { x: 27.4, z: 12.9, w: 0.4, d: 0.4 } },
    { id: "bistro-table", kind: "bistro_table", rect: { x: 24.4, z: 14.4, w: 0.8, d: 0.8 } },
    { id: "fridge", kind: "fridge", rect: { x: 27.2, z: 16.2, w: 0.6, d: 0.6 } },
    bookshelf("bookshelf", 6.2, 0.1, 1.6),
    planter("partition-planter-1", 13.3, 5, 0.55, 2),
    planter("partition-planter-2", 13.3, 9.5, 0.55, 2),
    planter("partition-planter-3", 14.15, 11, 0.55, 1.8),
    smallPlant("plant-entry-2", 11.75, 0.35),
    plant("plant-divider", 6.25, 11.25, BIG_PLANT),
    smallPlant("plant-divider-2", 7.15, 11.6),
    plant("plant-entry", 12.25, 0.15, BIG_PLANT),
    plant("plant-partition", 13.6, 13.4, BIG_PLANT),
    ...plantGroup("plant-sw", 0.2, 17.8, 1, -1, true),
    ...plantGroup("plant-ne", 27.8, 0.2, -1, 1),
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

export const largeTemplateInput: RoomTemplateInput = {
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
    // The merge gong (#43) beside the usage wall.
    { id: "gong", kind: "gong", wallId: "north", t: 18.75, y: 1.25, w: 1, h: 1.5 },
    { id: "picture-n1", kind: "picture", wallId: "north", t: 24.75, y: 1.6, w: 0.9, h: 0.6 },
    { id: "picture-p1", kind: "picture", wallId: "partition", t: 4.75, y: 1.6, w: 0.9, h: 0.6 },
  ],
  obstacles: furniture.obstacles,
  rugs: [
    patch("kitchen-floor", 22.75, 12.5, 5.1, 5.3),
    patch("nook-floor", 16.25, 13.25, 4.5, 4.55, "light"),
    rug("collab-rug", 2, 11.25, 3.75, 3.5),
    rug("entry-runner", 13.5, 0.75, 1.5, 3, "alt"),
    rug("pod-a1-rug", 2.5, 2.25, 4.2, 4, "alt"),
    rug("pod-a2-rug", 8, 2.25, 4.2, 4, "alt"),
    rug("pod-b1-rug", 16, 2.25, 4.2, 4, "alt"),
    rug("pod-b2-rug", 21.5, 2.25, 4.2, 4, "alt"),
    rug("desk-row-a-rug", 5.95, 7.6, 6.1, 2.4, "alt"),
    rug("desk-row-b-rug", 16.45, 8.1, 7.95, 3.2, "alt"),
    rug("kitchen-rug", 23, 13.25, 4.25, 3.75),
  ],
  wallDecor: [
    wallDecor("clock", "clock", "north", 11.25, 2.3, 0.5, 0.5),
    wallDecor("corkboard", "corkboard", "north", 16, 1.7, 1, 0.8),
    wallDecor("poster", "poster", "north", 22, 1.7, 0.7, 0.9),
  ],
  decor: [
    deskPlant("a-desk-1", 7.25, 8),
    deskPlant("a-desk-2", 10.75, 8),
    deskPlant("b-desk-1", 17.75, 8.5),
    prop("ceo-books", "books", "ceo-main", 23.4, 8.75),
    ...bistroProps("bistro-table", 24.4, 14.4),
  ],
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
