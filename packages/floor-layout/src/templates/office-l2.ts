/**
 * "Office L2" (medium, 12 desks), modelled on GDT's second office (SPEC §9.1,
 * research 03 §4): two back walls with windows, two big shared tables, CEO
 * L-desk front-right, filing cabinets and palms left, kitchenette back-right
 * with water cooler and bistro table, meeting table right, coffee table
 * front-left. 16 x 12 m.
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

const WIDTH = 16;
const DEPTH = 12;

const furniture = furnish(
  [
    sharedTable("table-a", 3.5, 2.75),
    sharedTable("table-b", 8, 2.75),
    soloDesk("desk-1", 3.75, 8.5),
    soloDesk("desk-2", 5.75, 8.5),
    soloDesk("desk-3", 8.25, 8.5),
    ceoDesk("ceo", 12.5, 8),
  ],
  [
    cabinets("cabinets", 0.1, 0.1, 2, 0.5),
    { id: "meeting-table", kind: "meeting_table", rect: { x: 12.5, z: 4.5, w: 1, d: 2.4 } },
    { id: "kitchen-counter", kind: "counter", rect: { x: 13.4, z: 0.1, w: 2.5, d: 0.6 } },
    {
      id: "coffee-machine",
      kind: "coffee_machine",
      rect: { x: 14, z: 0.15, w: 0.5, d: 0.5 },
      standAt: { x: 14.25, z: 1.25, heading: HEADING.north },
    },
    { id: "fridge", kind: "fridge", rect: { x: 15.3, z: 0.7, w: 0.6, d: 0.6 } },
    { id: "water-cooler", kind: "water_cooler", rect: { x: 12.7, z: 0.1, w: 0.4, d: 0.4 } },
    { id: "bistro-table", kind: "bistro_table", rect: { x: 14.4, z: 1.9, w: 0.8, d: 0.8 } },
    { id: "coffee-table", kind: "coffee_table", rect: { x: 1, z: 10.4, w: 1.2, d: 0.6 } },
    plant("plant-nw", 0.3, 0.7),
    plant("plant-sw", 0.3, 11.2),
    plant("plant-se", 15.2, 11),
  ],
);

export const officeL2TemplateInput: FloorTemplateInput = {
  id: "office-l2",
  name: "Office L2",
  kind: "medium",
  size: { width: WIDTH, depth: DEPTH },
  wallHeight: 3,
  stubHeight: 0.4,
  walls: perimeter(WIDTH, DEPTH, { north: windows([1, 3.5, 6, 8.5]), west: windows([0.3], 0.9) }),
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
    { id: "whiteboard", kind: "whiteboard", wallId: "west", t: 7.25, y: 1.4, w: 2.2, h: 1.2 },
    { id: "usage-wall", kind: "usage_wall", wallId: "west", t: 9.25, y: 1.7, w: 1.4, h: 0.9 },
    { id: "picture-w1", kind: "picture", wallId: "west", t: 10.75, y: 1.6, w: 0.7, h: 0.5 },
    { id: "picture-n1", kind: "picture", wallId: "north", t: 2.75, y: 1.6, w: 0.9, h: 0.6 },
    { id: "picture-n2", kind: "picture", wallId: "north", t: 5.25, y: 1.6, w: 0.9, h: 0.6 },
    { id: "picture-n3", kind: "picture", wallId: "north", t: 7.75, y: 1.6, w: 0.9, h: 0.6 },
  ],
  obstacles: furniture.obstacles,
  seats: [
    ...furniture.seats,
    {
      id: "meeting-w1",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 11.75, z: 4.75, heading: HEADING.east },
    },
    {
      id: "meeting-w2",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 11.75, z: 5.75, heading: HEADING.east },
    },
    {
      id: "meeting-w3",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 11.75, z: 6.75, heading: HEADING.east },
    },
    {
      id: "meeting-e1",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 13.75, z: 4.75, heading: HEADING.west },
    },
    {
      id: "meeting-e2",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 13.75, z: 5.75, heading: HEADING.west },
    },
    {
      id: "meeting-e3",
      kind: "chair",
      furnitureId: "meeting-table",
      pose: { x: 13.75, z: 6.75, heading: HEADING.west },
    },
    {
      id: "bistro-1",
      kind: "chair",
      furnitureId: "bistro-table",
      pose: { x: 13.75, z: 2.25, heading: HEADING.east },
    },
    {
      id: "bistro-2",
      kind: "chair",
      furnitureId: "bistro-table",
      pose: { x: 14.75, z: 3.25, heading: HEADING.north },
    },
  ],
};

export const officeL2Template = loadTemplate(officeL2TemplateInput);
