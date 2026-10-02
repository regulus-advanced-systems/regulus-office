/**
 * @regulus/room-layout: data-driven room templates, palettes and the nav
 * grid (SPEC §9.1). Templates are validated when this module loads.
 *
 * - types.ts        zod schemas + inferred types (RoomTemplate, Seat, WallAnchor, ...)
 * - facing.ts       what each seat should face (its table, a coffee table, a TV)
 * - geometry.ts     axis / heading conventions and rect helpers
 * - palettes.ts     ordered GDT-style palettes that operations cycle through
 * - query.ts        read helpers: walls, anchor stand poses, interactables
 * - nav-grid.ts     NavGrid generated from walls and obstacles
 * - astar.ts        small A* over the grid
 * - validate.ts     parse + structural + navigation checks (`loadTemplate`)
 * - templates/      lobby, small, office-l2 (medium), large, tier registry
 * - wall-pictures.ts where a wall picture may hang (#46)
 * - compound/       the compound: placement rules, corridor routing, nav grid (#181)
 * - room/           generated room interiors: `generateRoom`, decor styles, stable seat ids (#182)
 */
export * from "./astar.ts";
export * from "./compound/index.ts";
export * from "./facing.ts";
export * from "./geometry.ts";
export * from "./nav-grid.ts";
export * from "./palettes.ts";
export * from "./query.ts";
export * from "./room/index.ts";
export { largeTemplate, largeTemplateInput } from "./templates/large.ts";
export { lobbyTemplate, lobbyTemplateInput } from "./templates/lobby.ts";
export { officeL2Template, officeL2TemplateInput } from "./templates/office-l2.ts";
export * from "./templates/shared.ts";
export { smallTemplate, smallTemplateInput } from "./templates/small.ts";
export * from "./templates/tiers.ts";
export * from "./types.ts";
export * from "./validate.ts";
export * from "./wall-pictures.ts";
