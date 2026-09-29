/**
 * @regulus/floor-layout: data-driven floor templates, palettes and the nav
 * grid (SPEC §9.1). Templates are validated when this module loads.
 *
 * - types.ts        zod schemas + inferred types (FloorTemplate, Seat, WallAnchor, ...)
 * - facing.ts       what each seat should face (its table, a coffee table, a TV)
 * - geometry.ts     axis / heading conventions and rect helpers
 * - palettes.ts     ordered GDT-style palettes that floors cycle through
 * - query.ts        read helpers: walls, anchor stand poses, interactables
 * - nav-grid.ts     NavGrid generated from walls and obstacles
 * - astar.ts        small A* over the grid
 * - validate.ts     parse + structural + navigation checks (`loadTemplate`)
 * - templates/      lobby, small, office-l2 (medium), large, tier registry
 */
export * from "./astar.ts";
export * from "./facing.ts";
export * from "./geometry.ts";
export * from "./nav-grid.ts";
export * from "./palettes.ts";
export * from "./query.ts";
export { largeTemplate, largeTemplateInput } from "./templates/large.ts";
export { lobbyTemplate, lobbyTemplateInput } from "./templates/lobby.ts";
export { officeL2Template, officeL2TemplateInput } from "./templates/office-l2.ts";
export * from "./templates/shared.ts";
export { smallTemplate, smallTemplateInput } from "./templates/small.ts";
export * from "./templates/tiers.ts";
export * from "./types.ts";
export * from "./validate.ts";
