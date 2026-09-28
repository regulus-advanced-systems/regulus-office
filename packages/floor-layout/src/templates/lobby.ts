/**
 * Lobby (floor 0, SPEC §9.1): elevator bank, reception desk (PM robot home),
 * usage-tracker wall, lounge with TV, jukebox, building whiteboard, coffee
 * machine and plants. 18 x 14 m.
 *
 * Zones (#118), read from the elevator in the middle of the north wall
 * (a welcome rug in front of its doors):
 * - notices, west of the entry: the building whiteboard on the north wall and
 *   the usage-tracker wall on the west wall;
 * - lounge, west: couch facing the TV, coffee table and jukebox on a rug;
 * - reception, east of the entry: the PM robot's desk facing the room;
 * - coffee corner, north-east: counter with the coffee machine and a bistro
 *   table on a rug.
 * The middle of the room stays open floor; every interactable opens onto a
 * lane of at least 1.5 m, and three large plants frame the space.
 */
import { HEADING } from "../geometry.ts";
import type { FloorTemplateInput } from "../types.ts";
import { loadTemplate } from "../validate.ts";
import { BIG_PLANT, perimeter, plant, rug, windows } from "./shared.ts";

const WIDTH = 18;
const DEPTH = 14;

export const lobbyTemplateInput: FloorTemplateInput = {
  id: "lobby",
  name: "Lobby",
  kind: "lobby",
  size: { width: WIDTH, depth: DEPTH },
  wallHeight: 3,
  stubHeight: 0.4,
  walls: perimeter(WIDTH, DEPTH, { north: windows([11.75, 14.25]), west: windows([0.4]) }),
  nameWallId: "south",
  elevator: {
    rect: { x: 7.75, z: 0, w: 3, d: 0.6 },
    wallId: "north",
    door: { x: 9.25, z: 1.25, heading: HEADING.south },
  },
  spawn: { x: 9.25, z: 1.25, heading: HEADING.south },
  wallAnchors: [
    { id: "whiteboard", kind: "whiteboard", wallId: "north", t: 4.25, y: 1.4, w: 2.4, h: 1.2 },
    { id: "usage-wall", kind: "usage_wall", wallId: "west", t: 4.25, y: 1.6, w: 3, h: 1.4 },
    { id: "lounge-tv", kind: "tv", wallId: "west", t: 8.25, y: 1.5, w: 1.8, h: 1 },
    { id: "picture-1", kind: "picture", wallId: "north", t: 13.75, y: 1.6, w: 0.8, h: 0.6 },
  ],
  obstacles: [
    {
      id: "reception-desk",
      kind: "reception_desk",
      rect: { x: 11, z: 3.4, w: 2.5, d: 0.9 },
      standAt: { x: 12.25, z: 4.75, heading: HEADING.north },
    },
    { id: "coffee-counter", kind: "counter", rect: { x: 16.2, z: 0.1, w: 1.5, d: 0.6 } },
    {
      id: "coffee-machine",
      kind: "coffee_machine",
      rect: { x: 16.5, z: 0.15, w: 0.5, d: 0.5 },
      standAt: { x: 16.75, z: 1.25, heading: HEADING.north },
    },
    { id: "bistro-table", kind: "bistro_table", rect: { x: 16.4, z: 2.9, w: 0.8, d: 0.8 } },
    /** Backrest and arms only; the cushions are the couch seats. */
    { id: "couch", kind: "couch", rect: { x: 3.5, z: 7.25, w: 0.4, d: 2 } },
    { id: "coffee-table", kind: "coffee_table", rect: { x: 1.9, z: 7.65, w: 0.6, d: 1.2 } },
    {
      id: "jukebox",
      kind: "jukebox",
      rect: { x: 0.1, z: 11.95, w: 0.8, d: 0.6 },
      standAt: { x: 1.25, z: 12.25, heading: HEADING.west },
    },
    plant("plant-elevator-w", 6.75, 0.15, BIG_PLANT),
    plant("plant-sw", 0.2, 13, BIG_PLANT),
    plant("plant-se", 17, 13, BIG_PLANT),
  ],
  rugs: [
    rug("welcome-rug", 7.75, 0.75, 3, 2, "alt"),
    rug("lounge-rug", 1.5, 6.75, 3, 3),
    rug("cafe-rug", 15, 2.25, 2.75, 3),
  ],
  seats: [
    {
      id: "reception",
      kind: "reception",
      furnitureId: "reception-desk",
      pose: { x: 12.25, z: 2.75, heading: HEADING.south },
    },
    {
      id: "bistro-1",
      kind: "chair",
      furnitureId: "bistro-table",
      pose: { x: 15.75, z: 3.25, heading: HEADING.east },
    },
    {
      id: "bistro-2",
      kind: "chair",
      furnitureId: "bistro-table",
      pose: { x: 16.75, z: 4.25, heading: HEADING.north },
    },
    {
      id: "couch-1",
      kind: "couch",
      furnitureId: "couch",
      pose: { x: 3.25, z: 7.75, heading: HEADING.west },
    },
    {
      id: "couch-2",
      kind: "couch",
      furnitureId: "couch",
      pose: { x: 3.25, z: 8.75, heading: HEADING.west },
    },
  ],
};

export const lobbyTemplate = loadTemplate(lobbyTemplateInput);
