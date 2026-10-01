/**
 * Measures of generated room interiors (SPEC §9.1, D8; #182). Metres unless
 * named in tiles. Seats and stand points must land on 0.5 m nav cell
 * centres, which is why tables sit on a 0.5 m lattice (see `slots.ts`).
 */

import { COMPOUND_TILE_METRES } from "@regulus/protocol";

/** Edge of one compound grid tile, metres (room sizes, 4..12 tiles, are in protocol). */
export const TILE = COMPOUND_TILE_METRES;

/** `layoutTemplateId` of a floor whose interior comes from `generateRoom`. */
export const ROOM_LAYOUT_ID = "room";

/** Height of full walls and of the low front (stub) walls, metres. */
export const ROOM_WALL_HEIGHT = 3;
export const ROOM_STUB_HEIGHT = 0.4;

/** How far inside the door the player appears, metres. */
export const DOOR_APPROACH = 1.25;

/** A desk: one shared table with two chairs down each long side. */
export const TABLE_W = 3;
export const TABLE_D = 1.6;
/** Seat offsets from the table's north-west corner: along x, and in front of each long side. */
export const SEAT_X = [0.75, 2.25] as const;
export const SEAT_NORTH_Z = -0.5;
export const SEAT_SOUTH_Z = TABLE_D + 0.4;
/** A desk's footprint with its chairs (table plus the 0.7 m chair squares). */
export const POD_W = TABLE_W;
export const POD_D = 3.2;
/** Distance from the table's north edge to the top of the pod (north chairs). */
export const POD_TOP = 0.85;

/**
 * Clear floor between a wall and the nearest desk pod: room for a 1.5 m
 * lane plus the wall, and in front of the board wall for the stand points.
 */
export const WALL_BAND = 2;
/** Smallest pod pitch: a pod plus a lane of at least 1.8 m (z) and 2 m (x). */
export const POD_PITCH = 5;

/** Smallest share of the interior (inside the wall strip) that stays free floor. */
export const ROOM_MIN_FREE = 0.75;
