/**
 * Shared lair kit measurements (SPEC §9.1: 1 tile = 2 m; corridors are two
 * tiles wide). Every structural piece is authored on this grid so pieces
 * snap together without gaps.
 *
 * Local-space conventions for every piece: metres, y up, the floor at
 * y = 0, centred on x/z, and the piece's front (a wall's room side, a
 * desk's sitter side, a console's operator side) toward +z, like the Kenney
 * models (`KENNEY_HEADING`), so `fitToFootprint` places both the same way.
 */

/** One compound grid tile, metres (SPEC §9.1). */
export const TILE = 2;
/** Room and corridor wall height (the room templates use 3 m). */
export const WALL_HEIGHT = 3;
/** Wall thickness; the room side is at z = +WALL_THICKNESS / 2. */
export const WALL_THICKNESS = 0.36;
/**
 * Height of the concrete plinth and its steel rail. Walls cut away by the
 * cutaway material keep everything below this, so the rail is the clean
 * edge a cut wall shows (the ceiling-edge trim of a cut wall).
 */
export const PLINTH_HEIGHT = 0.55;
/** Corridor width: two tiles. Corridor cells are square. */
export const CORRIDOR_WIDTH = 2 * TILE;
/** Clear opening of a room door, metres. */
export const DOOR_OPENING = { w: 1.5, h: 2.3 } as const;
/** Mounting height of wall lamps (centre of the bulb). */
export const WALL_LAMP_Y = 2.25;
/** Height of the pipe run along the top of a wall. */
export const PIPE_Y = 2.65;
