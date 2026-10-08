/**
 * The compound (SPEC §9.1, D21; #181): pure, deterministic placement rules,
 * corridor routing, special rooms, auto-placement and the compound nav grid.
 *
 * - grid.ts       tile rects, doors, door approach pose, tiles → rects
 * - special.ts    compound spec, lobby/conference/break room, main corridor, blast door
 * - routing.ts    2-tile corridors from every door to the lobby's network
 * - layout.ts     everything at once: `computeCompoundLayout(spec, rooms)`
 * - validate.ts   `checkPlacement` (bounds, overlap, gap, door, reachability), `layoutProblems`
 * - autoplace.ts  rows off the main corridor, nearest free spot, reconcile, migration
 * - nav.ts        `buildCompoundNavGrid` (rooms, corridors, doors, outside strip)
 * - seats.ts      where humans may sit: chairs and couches of every room (#49)
 * - reception.ts  the lobby's reception desk, the office PM's post (#60)
 * - state.ts     to and from the BuildingRoom's published shape
 */
export * from "./autoplace.ts";
export * from "./grid.ts";
export * from "./layout.ts";
export * from "./nav.ts";
export * from "./reception.ts";
export * from "./routing.ts";
export * from "./seats.ts";
export * from "./special.ts";
export * from "./state.ts";
export * from "./validate.ts";
