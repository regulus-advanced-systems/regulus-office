/**
 * @regulus/protocol: single source of truth for shared wire types
 * (docs/SPEC.md §5, §6, §7).
 *
 * - enums.ts           string-literal enums + type guards
 * - common.ts          shared zod primitives (ids, timestamps, positions)
 * - building-state.ts  BuildingRoom state shapes (zod + inferred types)
 * - floor-state.ts     FloorRoom state shapes (zod + inferred types)
 * - commands/          client→server command union (zod, discriminated on `type`)
 * - agent-events.ts    adapter→server AgentEvent union (zod, discriminated on `kind`)
 * - schema/            @colyseus/schema classes mirroring the state shapes
 */
export * from "./agent-events.ts";
export * from "./building-state.ts";
export * from "./commands/index.ts";
export * from "./common.ts";
export * from "./enums.ts";
export * from "./floor-state.ts";
export * from "./schema/index.ts";
