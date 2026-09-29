/**
 * "Office L2" (medium, 12 desks), modelled on GDT's second office (SPEC §9.1,
 * research 03 §4): two back walls with windows, two big shared tables, CEO
 * L-desk front-right, filing cabinet left, kitchenette back-right with water
 * cooler and bistro table, meeting table. 21 x 14 m.
 *
 * Zones (#118), read from the elevator on the north wall:
 * - collaboration, west: issue board, PR board, whiteboard and queue
 *   clipboard on the west wall, the meeting table on a rug in front of them;
 * - focus work, centre: two shared tables, a row of three solo desks behind
 *   them and the CEO L-desk front-right;
 * - break, north-east: counter, coffee machine, fridge, water cooler and a
 *   bistro table on a rug.
 * - lounge nook, south-west: two armchairs, coffee table and a floor lamp on
 *   a lighter floor patch; a bookshelf stands on the north wall by the boards.
 * Lived-in: rugs under both pods, the desk row and the meeting table, a
 * runner from the elevator, a wood floor in the kitchen, mugs and fruit on
 * the bistro table, plants on the solo desks, plant groups at the zone edges,
 * a clock, a corkboard and a shelf on the walls.
 * Every desk cluster and interactable opens onto a lane of at least 1.5 m.
 */
import { HEADING } from "../geometry.ts";
import type { FloorTemplateInput, Seat } from "../types.ts";
import { loadTemplate } from "../validate.ts";
import {
  bistroProps,
  bookshelf,
  deskPlant,
  loungeNook,
  patch,
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

const WIDTH = 21;
const DEPTH = 14;

const nook = loungeNook("nook", 2.25, 11.25);

const furniture = furnish(
  [
    nook,
    sharedTable("table-a", 8, 4.75),
    sharedTable("table-b", 13.5, 4.75),
    soloDesk("desk-1", 7.75, 9.5),
    soloDesk("desk-2", 11.25, 9.5),
    soloDesk("desk-3", 14.75, 9.5),
    ceoDesk("ceo", 17.5, 9.5),
  ],
  [
    cabinets("cabinets", 0.1, 0.1, 1.2, 0.5),
    { id: "meeting-table", kind: "meeting_table", rect: { x: 3.5, z: 4.3, w: 1, d: 2.9 } },
    { id: "water-cooler", kind: "water_cooler", rect: { x: 16.9, z: 0.1, w: 0.4, d: 0.4 } },
    { id: "kitchen-counter", kind: "counter", rect: { x: 17.5, z: 0.1, w: 2.6, d: 0.6 } },
    {
      id: "coffee-machine",
      kind: "coffee_machine",
      rect: { x: 18.5, z: 0.15, w: 0.5, d: 0.5 },
      standAt: { x: 18.75, z: 1.25, heading: HEADING.north },
    },
    { id: "fridge", kind: "fridge", rect: { x: 20.2, z: 0.1, w: 0.6, d: 0.6 } },
    { id: "bistro-table", kind: "bistro_table", rect: { x: 19.4, z: 2.4, w: 0.8, d: 0.8 } },
    bookshelf("bookshelf", 2.8, 0.1, 1.3),
    plant("plant-entry", 6.25, 0.15, BIG_PLANT),
    smallPlant("plant-entry-2", 5.75, 0.35),
    plant("plant-divider", 5.75, 7.9, BIG_PLANT),
    smallPlant("plant-divider-2", 5.95, 8.85),
    ...plantGroup("plant-sw", 0.2, 13.8, 1, -1, true),
    ...plantGroup("plant-se", 20.8, 13.8, -1, -1),
  ],
);

/** Three chairs down each long side of the meeting table, facing it. */
const meetingSide = (side: "w" | "e", x: number, heading: number): Seat[] =>
  [4.75, 5.75, 6.75].map((z, i) => ({
    id: `meeting-${side}${i + 1}`,
    kind: "chair",
    furnitureId: "meeting-table",
    pose: { x, z, heading },
  }));

export const officeL2TemplateInput: FloorTemplateInput = {
  id: "office-l2",
  name: "Office L2",
  kind: "medium",
  size: { width: WIDTH, depth: DEPTH },
  wallHeight: 3,
  stubHeight: 0.4,
  walls: perimeter(WIDTH, DEPTH, {
    north: windows([1.5, 10, 12.5, 15]),
    west: windows([0.3], 0.9),
  }),
  nameWallId: "south",
  elevator: {
    rect: { x: 7.25, z: 0, w: 2, d: 0.6 },
    wallId: "north",
    door: { x: 8.25, z: 1.25, heading: HEADING.south },
  },
  spawn: { x: 8.25, z: 1.25, heading: HEADING.south },
  wallAnchors: [
    { id: "issue-board", kind: "issue_board", wallId: "west", t: 2.25, y: 1.5, w: 1.8, h: 1.2 },
    { id: "pr-board", kind: "pr_board", wallId: "west", t: 4.25, y: 1.5, w: 1.8, h: 1.2 },
    { id: "whiteboard", kind: "whiteboard", wallId: "west", t: 6.75, y: 1.4, w: 2.2, h: 1.2 },
    {
      id: "queue-clipboard",
      kind: "queue_clipboard",
      wallId: "west",
      t: 8.75,
      y: 1.5,
      w: 0.5,
      h: 0.7,
    },
    { id: "usage-wall", kind: "usage_wall", wallId: "west", t: 10.75, y: 1.7, w: 1.4, h: 0.9 },
    { id: "picture-w1", kind: "picture", wallId: "west", t: 12.75, y: 1.6, w: 0.7, h: 0.5 },
    { id: "picture-n1", kind: "picture", wallId: "north", t: 4.75, y: 1.6, w: 0.9, h: 0.6 },
    { id: "picture-n2", kind: "picture", wallId: "north", t: 11.75, y: 1.6, w: 0.9, h: 0.6 },
    { id: "picture-n3", kind: "picture", wallId: "north", t: 14.25, y: 1.6, w: 0.9, h: 0.6 },
  ],
  obstacles: furniture.obstacles,
  rugs: [
    patch("kitchen-floor", 16.6, 0.2, 4.2, 4.8),
    patch("nook-floor", 1.75, 10, 4.25, 3.8, "light"),
    rug("collab-rug", 2, 3.75, 3.5, 4),
    rug("entry-runner", 7.5, 0.75, 1.5, 2.5, "alt"),
    rug("pod-a-rug", 7.5, 3.5, 4.2, 4, "alt"),
    rug("pod-b-rug", 13, 3.5, 4.2, 4, "alt"),
    rug("desk-row-rug", 6.5, 9.25, 9.25, 2.25, "alt"),
    rug("kitchen-rug", 17.75, 1.75, 3, 3),
  ],
  wallDecor: [
    wallDecor("clock", "clock", "north", 5.75, 2.3, 0.5, 0.5),
    wallDecor("kitchen-corkboard", "corkboard", "north", 16.7, 1.7, 0.8, 0.8),
    wallDecor("kitchen-shelf", "shelf", "north", 18.75, 1.85, 1.6, 0.3),
  ],
  decor: [
    deskPlant("desk-1", 7.75, 9.5),
    deskPlant("desk-2", 11.25, 9.5),
    deskPlant("desk-3", 14.75, 9.5),
    prop("ceo-books", "books", "ceo-main", 19.4, 9.75),
    ...bistroProps("bistro-table", 19.4, 2.4),
  ],
  seats: [
    ...furniture.seats,
    ...meetingSide("w", 2.75, HEADING.east),
    ...meetingSide("e", 4.75, HEADING.west),
    {
      id: "bistro-1",
      kind: "chair",
      furnitureId: "bistro-table",
      pose: { x: 18.75, z: 2.75, heading: HEADING.east },
    },
    {
      id: "bistro-2",
      kind: "chair",
      furnitureId: "bistro-table",
      pose: { x: 19.75, z: 3.75, heading: HEADING.north },
    },
  ],
};

export const officeL2Template = loadTemplate(officeL2TemplateInput);
