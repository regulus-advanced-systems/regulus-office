/**
 * Lobby (operation 0, SPEC §9.1): elevator bank, reception desk (PM henchman home),
 * usage-tracker wall, lounge with TV, jukebox, building whiteboard, coffee
 * machine and plants. 18 x 14 m.
 *
 * Zones (#118), read from the elevator in the middle of the north wall
 * (a welcome rug in front of its doors):
 * - notices, west of the entry: the building whiteboard on the north wall and
 *   the usage-tracker wall on the west wall;
 * - lounge, west: couch facing the TV, coffee table and jukebox on a rug;
 * - reception, east of the entry: the PM henchman's desk facing the room;
 * - coffee corner, north-east: counter with the coffee machine and a bistro
 *   table on a rug.
 * - atrium, centre: a large rug with a planter island and two benches south of
 *   the middle, so the exact centre stays open floor; a runner leads there
 *   from the elevator.
 * Lived-in: wood floor under the lounge and cafe, armchairs, a floor lamp and
 * a bookshelf in the lounge, mugs and fruit on the bistro table, plant groups
 * in the corners, a clock, a corkboard, a poster and a shelf on the walls.
 * Every interactable opens onto a lane of at least 1.5 m.
 */
import { HEADING } from "../geometry.ts";
import type { RoomTemplateInput } from "../types.ts";
import { loadTemplate } from "../validate.ts";
import {
  armchair,
  bench,
  bistroProps,
  bookshelf,
  floorLamp,
  patch,
  planter,
  plantGroup,
  prop,
  seatsOf,
  smallPlant,
  wallDecor,
} from "./decor.ts";
import { BIG_PLANT, perimeter, plant, rug, windows } from "./shared.ts";

/** Lounge armchairs at both ends of the coffee table. */
const loungeChairs = [
  armchair("armchair-n", 2.25, 6.75, HEADING.south),
  armchair("armchair-s", 2.25, 9.75, HEADING.north),
];

const WIDTH = 18;
const DEPTH = 14;

export const lobbyTemplateInput: RoomTemplateInput = {
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
      rect: { x: 0.1, z: 11.45, w: 0.8, d: 0.6 },
      standAt: { x: 1.25, z: 11.75, heading: HEADING.west },
    },
    ...loungeChairs.flatMap((g) => g.obstacles),
    floorLamp("lounge-lamp", 3.65, 6.55),
    bookshelf("lounge-bookshelf", 0.25, 0.1),
    planter("atrium-planter", 8, 8.5, 2, 0.7),
    bench("atrium-bench-w", 6.6, 8.6),
    bench("atrium-bench-e", 10.2, 8.6),
    plant("plant-elevator-w", 6.75, 0.15, BIG_PLANT),
    smallPlant("plant-elevator-w2", 6.25, 0.35),
    smallPlant("plant-elevator-e", 11, 0.2),
    ...plantGroup("plant-sw", 0.2, 13.8, 1, -1),
    ...plantGroup("plant-se", 17.8, 13.8, -1, -1),
  ],
  rugs: [
    patch("lounge-floor", 0.2, 5.5, 5.3, 8.3),
    patch("cafe-floor", 14.25, 0.2, 3.55, 5.3),
    rug("entry-runner", 8.5, 0.75, 1.5, 3.75, "alt"),
    rug("atrium-rug", 5.75, 4.75, 7, 5.75, "alt"),
    rug("lounge-rug", 1.25, 6, 3.5, 4.5),
    rug("cafe-rug", 15, 2.25, 2.75, 3),
  ],
  wallDecor: [
    wallDecor("clock", "clock", "north", 6.4, 2.3, 0.5, 0.5),
    wallDecor("reception-corkboard", "corkboard", "north", 11.25, 1.7, 0.8, 0.8),
    wallDecor("cafe-shelf", "shelf", "north", 16.95, 1.85, 1.3, 0.3),
    wallDecor("lounge-poster", "poster", "west", 10.5, 1.7, 0.8, 1),
  ],
  decor: [
    ...bistroProps("bistro-table", 16.4, 2.9),
    prop("reception-plant", "desk_plant", "reception-desk", 11.3, 3.65),
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
    ...seatsOf(...loungeChairs),
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
