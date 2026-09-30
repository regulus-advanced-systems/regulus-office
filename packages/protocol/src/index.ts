/**
 * @regulus/protocol: single source of truth for shared wire types
 * (docs/SPEC.md §5, §6, §7).
 *
 * - enums.ts           string-literal enums + type guards
 * - common.ts          shared zod primitives (ids, timestamps, positions)
 * - building-state.ts  BuildingRoom state shapes (zod + inferred types)
 * - floor-state.ts     FloorRoom state shapes (zod + inferred types)
 * - floors-api.ts      REST shapes for floors, repos and floor members
 * - boards-api.ts      REST shapes for the issue/PR board panel and its write actions (#36)
 * - github-api.ts      REST shapes for the office GitHub connection, its repo list and board sync
 * - notifications.ts   desktop/tab-badge messages, per-user prefs, team webhook channels
 * - credentials-api.ts read-only credential profile list (ids and labels only)
 * - provider-connect.ts "Connect providers": key profiles, key presets, CLI login flows
 * - commands/          client→server command union (zod, discriminated on `type`)
 * - agent-events.ts    adapter→server AgentEvent union (zod, discriminated on `kind`)
 * - agent-messages.ts  FloorRoom server→client robot messages (permissions, results)
 * - acl.ts             who may control a robot, who may emergency-stop it (D12)
 * - permission-modes.ts per-provider robot permission modes (#166)
 * - schema/            @colyseus/schema classes mirroring the state shapes
 * - terminal.ts        terminal WebSocket control messages and constants
 * - terminal-screens.ts laptop screen feed (plain-text screens per floor)
 * - usage-api.ts      the viewer's own usage (plan limits, spend); office totals are in building-state
 * - workflows.ts       GitHub workflow definitions (#155); workflows-api.ts their REST shapes
 */
export * from "./acl.ts";
export * from "./agent-events.ts";
export * from "./agent-messages.ts";
export * from "./boards-api.ts";
export * from "./building-state.ts";
export * from "./commands/index.ts";
export * from "./common.ts";
export * from "./credentials-api.ts";
export * from "./enums.ts";
export * from "./floor-state.ts";
export * from "./floors-api.ts";
export * from "./github-api.ts";
export * from "./notifications.ts";
export * from "./permission-modes.ts";
export * from "./provider-connect.ts";
export * from "./rooms.ts";
export * from "./schema/index.ts";
export * from "./terminal.ts";
export * from "./terminal-screens.ts";
export * from "./usage-api.ts";
export * from "./workflows.ts";
export * from "./workflows-api.ts";
