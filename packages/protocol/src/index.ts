/**
 * @regulus/protocol: single source of truth for shared wire types
 * (docs/SPEC.md §5, §6, §7).
 *
 * - enums.ts           string-literal enums + type guards
 * - common.ts          shared zod primitives (ids, timestamps, positions)
 * - blast-door.ts      the lobby blast door: shared phases, buttons and timing (#188)
 * - building-state.ts  BuildingRoom state shapes (zod + inferred types)
 * - compound.ts        compound grid conventions, room placement, layout state and REST (#181)
 * - operation-state.ts     OperationRoom state shapes (zod + inferred types)
 * - genius.ts        genius avatar catalogue (archetypes, colours, accessories) and validator
 * - operations-api.ts      REST shapes for operations, repos and operation members
 * - boards-api.ts      REST shapes for the issue/PR board panel and its write actions (#36)
 * - changes-api.ts     REST shapes for a henchman's changes window: diff, commit, discard (#38)
 * - celebrations.ts    merge gong messages: `pr.merged`, `gong.ring` (#43)
 * - clock-sync.ts     four-timestamp clock sync for the jukebox (#47)
 * - jukebox.ts        jukebox limits, playhead maths, permissions, library REST (#47)
 * - github-api.ts      REST shapes for the office GitHub connection, its repo list and board sync
 * - notifications.ts   desktop/tab-badge messages, per-user prefs, team webhook channels
 * - credentials-api.ts read-only credential profile list (ids and labels only)
 * - provider-connect.ts "Connect providers": key profiles, key presets, CLI login flows
 * - commands/          client→server command union (zod, discriminated on `type`)
 * - agent-events.ts    adapter→server AgentEvent union (zod, discriminated on `kind`)
 * - agent-messages.ts  OperationRoom server→client henchman messages (permissions, results)
 * - acl.ts             who may control a henchman, who may emergency-stop it (D12)
 * - permission-modes.ts per-provider henchman permission modes (#166)
 * - queue-api.ts       room task queue: limits, results, who may queue/reorder/retry (#37)
 * - room-settings-api.ts room desk count and decor style (#182)
 * - search-api.ts     search across chat and terminal scrollback (#41)
 * - social.ts         seat keys, emote and chat limits, chat bubble timing (#49)
 * - skins.ts          henchman skins and the admin `skin_rules` that assign them (#184)
 * - schema/            @colyseus/schema classes mirroring the state shapes
 * - terminal.ts        terminal WebSocket control messages and constants
 * - terminal-screens.ts laptop screen feed (plain-text screens per operation)
 * - usage-api.ts      the viewer's own usage (plan limits, spend); office totals are in building-state
 * - whiteboard.ts     the shared whiteboard: Yjs endpoint, board ids, access, snapshot REST (#45)
 * - workflows.ts       GitHub workflow definitions (#155); workflows-api.ts their REST shapes
 */
export * from "./acl.ts";
export * from "./agent-events.ts";
export * from "./agent-messages.ts";
export * from "./blast-door.ts";
export * from "./boards-api.ts";
export * from "./building-state.ts";
export * from "./celebrations.ts";
export * from "./changes-api.ts";
export * from "./clock-sync.ts";
export * from "./commands/index.ts";
export * from "./common.ts";
export * from "./compound.ts";
export * from "./credentials-api.ts";
export * from "./enums.ts";
export * from "./genius.ts";
export * from "./github-api.ts";
export * from "./jukebox.ts";
export * from "./notifications.ts";
export * from "./operation-state.ts";
export * from "./operations-api.ts";
export * from "./permission-modes.ts";
export * from "./provider-connect.ts";
export * from "./queue-api.ts";
export * from "./room-settings-api.ts";
export * from "./rooms.ts";
export * from "./schema/index.ts";
export * from "./search-api.ts";
export * from "./skins.ts";
export * from "./social.ts";
export * from "./terminal.ts";
export * from "./terminal-screens.ts";
export * from "./usage-api.ts";
export * from "./whiteboard.ts";
export * from "./workflows.ts";
export * from "./workflows-api.ts";
