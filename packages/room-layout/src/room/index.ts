/**
 * Generated room interiors (#182, SPEC §9.1 "Room interiors", D8):
 *
 * - generate.ts  `generateRoom`, `maxDeskCount`, `RoomGenerationError`
 * - types.ts     `RoomLayout` (a RoomTemplate plus `room`), inputs, lights
 * - seat-ids.ts  stable `d<desk>s<seat>` ids
 * - slots.ts     the desk pod grid and fill order
 * - shell.ts     walls, door and spawn
 * - anchors.ts   the board wall (every anchor kind) and wall decor
 * - props.ts     corner and wall props; pods.ts desks, clutter, the nook
 * - styles.ts    lair decor styles: palette, materials, lighting, model ids
 * - lighting.ts  pooled lights; measure.ts free floor, overlaps, facing
 * - legacy.ts    seat-id map for operations migrated from the fixed templates
 * - debug-svg.ts top-down SVG of a layout for reviews
 */
export { BOARD_LIKE, GONG_CLEARANCE } from "./anchors.ts";
export * from "./constants.ts";
export { roomLayoutSvg } from "./debug-svg.ts";
export { generateRoom, maxDeskCount, RoomGenerationError } from "./generate.ts";
export * from "./legacy.ts";
export { facingProblems, overlapProblems, roomFreeFraction, roomProblems } from "./measure.ts";
export * from "./seat-ids.ts";
export { DOOR_WALL_ID, doorSpan } from "./shell.ts";
export { type PodSlot, podSlots, type SlotGrid } from "./slots.ts";
export { DECOR_STYLE_SPECS, type DecorStyleSpec, decorStyleSpec } from "./styles.ts";
export type * from "./types.ts";
