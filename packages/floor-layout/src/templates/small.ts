/**
 * Small office (6 desks): the Office L2 layout shrunk to one shared table,
 * one solo desk and the CEO L-desk. 15 x 12 m.
 *
 * Zones (#118), read from the elevator on the north wall:
 * - collaboration, west: issue board, PR board, whiteboard and queue
 *   clipboard on the west wall, a four-seat meeting table on a rug in front;
 * - focus work, centre: the shared table, the solo desk behind it and the
 *   CEO L-desk front-right;
 * - break, north-east: counter with the coffee machine, water cooler and a
 *   bistro table on a rug.
 * Every desk cluster and interactable opens onto a lane of at least 1.5 m;
 * decoration is one cabinet and three large plants.
 */
import { HEADING } from "../geometry.ts";
import type { FloorTemplateInput } from "../types.ts";
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

const WIDTH = 15;
const DEPTH = 12;

const furniture = furnish(
  [sharedTable("table-a", 7.5, 4.25), soloDesk("desk-1", 8.25, 8.5), ceoDesk("ceo", 11, 8.5)],
  [
    cabinets("cabinets", 0.1, 0.1, 1, 0.5),
    { id: "meeting-table", kind: "meeting_table", rect: { x: 3, z: 5, w: 1.2, d: 1.2 } },
    { id: "water-cooler", kind: "water_cooler", rect: { x: 11.85, z: 0.1, w: 0.4, d: 0.4 } },
    { id: "kitchen-counter", kind: "counter", rect: { x: 12.4, z: 0.1, w: 2.5, d: 0.6 } },
    {
      id: "coffee-machine",
      kind: "coffee_machine",
      rect: { x: 13.5, z: 0.15, w: 0.5, d: 0.5 },
      standAt: { x: 13.75, z: 1.25, heading: HEADING.north },
    },
    { id: "bistro-table", kind: "bistro_table", rect: { x: 13.4, z: 3.4, w: 0.8, d: 0.8 } },
    plant("plant-entry", 4.4, 0.15, BIG_PLANT),
    plant("plant-sw", 0.2, 11, BIG_PLANT),
    plant("plant-se", 14, 11, BIG_PLANT),
  ],
);

export const smallTemplateInput: FloorTemplateInput = {
  id: "office-small",
  name: "Office S",
  kind: "small",
  size: { width: WIDTH, depth: DEPTH },
  wallHeight: 3,
  stubHeight: 0.4,
  walls: perimeter(WIDTH, DEPTH, { north: windows([1.25, 3.75]), west: windows([0.3], 0.9) }),
  nameWallId: "south",
  elevator: {
    rect: { x: 5.25, z: 0, w: 2, d: 0.6 },
    wallId: "north",
    door: { x: 6.25, z: 1.25, heading: HEADING.south },
  },
  spawn: { x: 6.25, z: 1.25, heading: HEADING.south },
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
    { id: "usage-wall", kind: "usage_wall", wallId: "north", t: 10.25, y: 1.7, w: 1.4, h: 0.9 },
    { id: "picture-n1", kind: "picture", wallId: "north", t: 3.25, y: 1.6, w: 0.9, h: 0.6 },
    { id: "picture-n2", kind: "picture", wallId: "north", t: 8.25, y: 1.6, w: 0.9, h: 0.6 },
  ],
  obstacles: furniture.obstacles,
  rugs: [rug("collab-rug", 2, 4, 3.25, 3.25), rug("kitchen-rug", 12, 2.25, 2.75, 3.5, "alt")],
  seats: [
    ...furniture.seats,
    {
      id: "meeting-w",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 2.25, z: 5.75, heading: HEADING.east },
    },
    {
      id: "meeting-e",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 4.75, z: 5.75, heading: HEADING.west },
    },
    {
      id: "meeting-n",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 3.75, z: 4.25, heading: HEADING.south },
    },
    {
      id: "meeting-s",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 3.75, z: 6.75, heading: HEADING.north },
    },
    {
      id: "bistro-1",
      kind: "chair",
      furnitureId: "bistro-table",
      pose: { x: 12.75, z: 3.75, heading: HEADING.east },
    },
    {
      id: "bistro-2",
      kind: "chair",
      furnitureId: "bistro-table",
      pose: { x: 13.75, z: 4.75, heading: HEADING.north },
    },
  ],
};

export const smallTemplate = loadTemplate(smallTemplateInput);
