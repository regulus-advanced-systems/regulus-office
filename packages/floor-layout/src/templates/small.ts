/**
 * Small office (6 desks): the Office L2 footprint shrunk to one shared table,
 * one solo desk and the CEO L-desk, with a compact meeting table and a
 * kitchenette along the east stub wall. 12 x 10 m.
 */
import { HEADING } from "../geometry.ts";
import type { FloorTemplateInput } from "../types.ts";
import { loadTemplate } from "../validate.ts";
import {
  cabinets,
  ceoDesk,
  furnish,
  perimeter,
  plant,
  sharedTable,
  soloDesk,
  windows,
} from "./shared.ts";

const WIDTH = 12;
const DEPTH = 10;

const furniture = furnish(
  [sharedTable("table-a", 3.5, 2.75), soloDesk("desk-1", 2.75, 7), ceoDesk("ceo", 8, 7)],
  [
    cabinets("cabinets", 0.1, 0.1, 2, 0.5),
    { id: "meeting-table", kind: "meeting_table", rect: { x: 8.5, z: 3, w: 1.2, d: 1.2 } },
    { id: "kitchen-counter", kind: "counter", rect: { x: 11.3, z: 6.5, w: 0.6, d: 2.5 } },
    {
      id: "coffee-machine",
      kind: "coffee_machine",
      rect: { x: 11.35, z: 7, w: 0.5, d: 0.5 },
      standAt: { x: 10.75, z: 7.25, heading: HEADING.east },
    },
    { id: "water-cooler", kind: "water_cooler", rect: { x: 11.4, z: 5.9, w: 0.4, d: 0.4 } },
    { id: "coffee-table", kind: "coffee_table", rect: { x: 1, z: 5, w: 1, d: 0.6 } },
    plant("plant-sw", 0.3, 9.2),
    plant("plant-ne", 11.2, 0.3),
  ],
);

export const smallTemplateInput: FloorTemplateInput = {
  id: "office-small",
  name: "Office S",
  kind: "small",
  size: { width: WIDTH, depth: DEPTH },
  wallHeight: 3,
  stubHeight: 0.4,
  walls: perimeter(WIDTH, DEPTH, { north: windows([1, 3.5]), west: windows([0.3], 0.9) }),
  nameWallId: "south",
  elevator: {
    rect: { x: 7.75, z: 0, w: 2, d: 0.6 },
    wallId: "north",
    door: { x: 8.75, z: 1.25, heading: HEADING.south },
  },
  spawn: { x: 8.75, z: 1.25, heading: HEADING.south },
  wallAnchors: [
    { id: "issue-board", kind: "issue_board", wallId: "west", t: 2.25, y: 1.5, w: 1.8, h: 1.2 },
    { id: "pr-board", kind: "pr_board", wallId: "west", t: 4.25, y: 1.5, w: 1.8, h: 1.2 },
    {
      id: "queue-clipboard",
      kind: "queue_clipboard",
      wallId: "west",
      t: 5.75,
      y: 1.5,
      w: 0.5,
      h: 0.7,
    },
    { id: "whiteboard", kind: "whiteboard", wallId: "west", t: 7.75, y: 1.4, w: 2.2, h: 1.2 },
    { id: "usage-wall", kind: "usage_wall", wallId: "north", t: 10.75, y: 1.7, w: 1.4, h: 0.9 },
    { id: "picture-n1", kind: "picture", wallId: "north", t: 2.75, y: 1.6, w: 0.9, h: 0.6 },
    { id: "picture-n2", kind: "picture", wallId: "north", t: 5.75, y: 1.6, w: 0.9, h: 0.6 },
  ],
  obstacles: furniture.obstacles,
  seats: [
    ...furniture.seats,
    {
      id: "meeting-w",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 7.75, z: 3.75, heading: HEADING.east },
    },
    {
      id: "meeting-e",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 10.25, z: 3.75, heading: HEADING.west },
    },
    {
      id: "meeting-n",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 9.25, z: 2.25, heading: HEADING.south },
    },
    {
      id: "meeting-s",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 9.25, z: 4.75, heading: HEADING.north },
    },
  ],
};

export const smallTemplate = loadTemplate(smallTemplateInput);
