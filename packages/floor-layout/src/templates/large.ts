/**
 * Large office (20 desks, two pods). A free-standing partition splits the room
 * into pod A (west: two shared tables, two solo desks, meeting table) and pod B
 * (east: two shared tables, a solo desk, the CEO L-desk, kitchenette). 22 x 14 m.
 */
import { HEADING } from "../geometry.ts";
import type { FloorTemplateInput, Wall } from "../types.ts";
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

const WIDTH = 22;
const DEPTH = 14;

/** Interior divider between the pods; anchors hang on its east (pod B) face. */
const partition: Wall = {
  id: "partition",
  from: { x: 11, z: 3 },
  to: { x: 11, z: 10 },
  height: "full",
  facing: "east",
  openings: [],
};

const furniture = furnish(
  [
    sharedTable("a-table-1", 2.5, 2.75),
    sharedTable("a-table-2", 6.5, 2.75),
    soloDesk("a-desk-1", 2.75, 8.5),
    soloDesk("a-desk-2", 4.75, 8.5),
    sharedTable("b-table-1", 12.5, 2.75),
    sharedTable("b-table-2", 16.5, 2.75),
    soloDesk("b-desk-1", 13.25, 8.5),
    ceoDesk("ceo", 17.5, 8.5),
  ],
  [
    cabinets("a-cabinets", 0.1, 0.1, 2, 0.5),
    cabinets("b-cabinets", 11.4, 3.2, 0.5, 2),
    { id: "meeting-table", kind: "meeting_table", rect: { x: 6.5, z: 10, w: 2.4, d: 1 } },
    { id: "kitchen-counter", kind: "counter", rect: { x: 21.3, z: 11, w: 0.6, d: 2.5 } },
    {
      id: "coffee-machine",
      kind: "coffee_machine",
      rect: { x: 21.35, z: 11.5, w: 0.5, d: 0.5 },
      standAt: { x: 20.75, z: 11.75, heading: HEADING.east },
    },
    { id: "water-cooler", kind: "water_cooler", rect: { x: 21.4, z: 10.4, w: 0.4, d: 0.4 } },
    plant("plant-nw", 0.3, 0.3),
    plant("plant-ne", 21.2, 0.3),
    plant("plant-sw", 0.3, 13.2),
    plant("plant-partition", 10.75, 10.5),
  ],
);

export const largeTemplateInput: FloorTemplateInput = {
  id: "office-large",
  name: "Office L",
  kind: "large",
  size: { width: WIDTH, depth: DEPTH },
  wallHeight: 3,
  stubHeight: 0.4,
  walls: [
    ...perimeter(WIDTH, DEPTH, {
      north: windows([1, 3.5, 8.5, 13, 18]),
      west: [...windows([0.3], 0.9), ...windows([8.5, 11.5])],
    }),
    partition,
  ],
  nameWallId: "south",
  elevator: {
    rect: { x: 10.25, z: 0, w: 2, d: 0.6 },
    wallId: "north",
    door: { x: 11.25, z: 1.25, heading: HEADING.south },
  },
  spawn: { x: 11.25, z: 1.25, heading: HEADING.south },
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
    { id: "picture-w1", kind: "picture", wallId: "west", t: 7.25, y: 1.6, w: 0.9, h: 0.6 },
    { id: "picture-w2", kind: "picture", wallId: "west", t: 10.75, y: 1.6, w: 0.9, h: 0.6 },
    { id: "whiteboard", kind: "whiteboard", wallId: "north", t: 6.25, y: 1.4, w: 2.4, h: 1.2 },
    { id: "usage-wall", kind: "usage_wall", wallId: "north", t: 16.25, y: 1.7, w: 1.4, h: 0.9 },
    { id: "picture-n1", kind: "picture", wallId: "north", t: 20.25, y: 1.6, w: 0.9, h: 0.6 },
    { id: "picture-p1", kind: "picture", wallId: "partition", t: 4.75, y: 1.6, w: 0.9, h: 0.6 },
  ],
  obstacles: furniture.obstacles,
  seats: [
    ...furniture.seats,
    {
      id: "meeting-n1",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 6.75, z: 9.75, heading: HEADING.south },
    },
    {
      id: "meeting-n2",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 7.75, z: 9.75, heading: HEADING.south },
    },
    {
      id: "meeting-n3",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 8.75, z: 9.75, heading: HEADING.south },
    },
    {
      id: "meeting-s1",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 6.75, z: 11.25, heading: HEADING.north },
    },
    {
      id: "meeting-s2",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 7.75, z: 11.25, heading: HEADING.north },
    },
    {
      id: "meeting-s3",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 8.75, z: 11.25, heading: HEADING.north },
    },
  ],
};

export const largeTemplate = loadTemplate(largeTemplateInput);
