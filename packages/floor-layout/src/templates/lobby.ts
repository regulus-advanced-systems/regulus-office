/**
 * Lobby (floor 0, SPEC §9.1): elevator bank, reception desk (PM robot home),
 * usage-tracker wall, lounge with TV, jukebox, building whiteboard, coffee
 * machine and plants. 14 x 11 m.
 */
import { HEADING } from "../geometry.ts";
import type { FloorTemplateInput } from "../types.ts";
import { loadTemplate } from "../validate.ts";
import { perimeter, plant, windows } from "./shared.ts";

const WIDTH = 14;
const DEPTH = 11;

export const lobbyTemplateInput: FloorTemplateInput = {
  id: "lobby",
  name: "Lobby",
  kind: "lobby",
  size: { width: WIDTH, depth: DEPTH },
  wallHeight: 3,
  stubHeight: 0.4,
  walls: perimeter(WIDTH, DEPTH, { north: windows([9.2, 12.2]), west: windows([0.4]) }),
  nameWallId: "south",
  elevator: {
    rect: { x: 5.5, z: 0, w: 3, d: 0.6 },
    wallId: "north",
    door: { x: 6.75, z: 1.25, heading: HEADING.south },
  },
  spawn: { x: 6.75, z: 1.25, heading: HEADING.south },
  wallAnchors: [
    { id: "whiteboard", kind: "whiteboard", wallId: "north", t: 3.25, y: 1.4, w: 2.4, h: 1.2 },
    { id: "usage-wall", kind: "usage_wall", wallId: "west", t: 3.75, y: 1.6, w: 3, h: 1.4 },
    { id: "lounge-tv", kind: "tv", wallId: "west", t: 7.25, y: 1.5, w: 1.8, h: 1 },
    { id: "picture-1", kind: "picture", wallId: "north", t: 11.3, y: 1.6, w: 0.8, h: 0.6 },
  ],
  obstacles: [
    {
      id: "reception-desk",
      kind: "reception_desk",
      rect: { x: 9, z: 2.4, w: 2.5, d: 0.9 },
      standAt: { x: 10.25, z: 3.75, heading: HEADING.north },
    },
    { id: "coffee-counter", kind: "counter", rect: { x: 12.4, z: 0.1, w: 1.5, d: 0.6 } },
    {
      id: "coffee-machine",
      kind: "coffee_machine",
      rect: { x: 13, z: 0.15, w: 0.5, d: 0.5 },
      standAt: { x: 13.25, z: 1.25, heading: HEADING.north },
    },
    /** Backrest and arms only; the cushions are the couch seats. */
    { id: "couch", kind: "couch", rect: { x: 2.5, z: 6.5, w: 0.4, d: 2 } },
    { id: "coffee-table", kind: "coffee_table", rect: { x: 1, z: 6.6, w: 0.6, d: 1.2 } },
    {
      id: "jukebox",
      kind: "jukebox",
      rect: { x: 0.1, z: 9.2, w: 0.8, d: 0.6 },
      standAt: { x: 1.25, z: 9.75, heading: HEADING.west },
    },
    plant("plant-nw", 0.2, 0.2),
    plant("plant-elevator-w", 4.3, 0.2),
    plant("plant-elevator-e", 8.7, 0.2),
    plant("plant-se", 13.3, 10.3),
  ],
  seats: [
    {
      id: "reception",
      kind: "reception",
      furnitureId: "reception-desk",
      pose: { x: 10.25, z: 1.75, heading: HEADING.south },
    },
    {
      id: "couch-1",
      kind: "couch",
      furnitureId: "couch",
      pose: { x: 2.25, z: 6.75, heading: HEADING.west },
    },
    {
      id: "couch-2",
      kind: "couch",
      furnitureId: "couch",
      pose: { x: 2.25, z: 7.75, heading: HEADING.west },
    },
  ],
};

export const lobbyTemplate = loadTemplate(lobbyTemplateInput);
