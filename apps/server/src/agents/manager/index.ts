/**
 * AgentManager (issue #26): agent lifecycle, persistence, re-adoption,
 * event log, RobotState publishing, status ladder.
 *
 * - manager.ts        AgentManager: spawn, prompt, respondPermission, interrupt,
 *                     stop, resume, sendHome, resolveTerminalTarget; the event sink
 * - state-machine.ts  allowed status transitions
 * - robot.ts          event → RobotState reducer (action, hand, bubbles)
 * - ladder.ts         heuristic status rungs and the session watcher
 * - adopt.ts          re-adoption on boot
 * - store.ts          agents / agent_events (retention) / desks / audit
 * - tokens.ts         hashed per-agent hook tokens (AgentTokenVerifier)
 * - credentials.ts    profile choice and spawn-time key decryption
 * - workspaces.ts     Workspaces seam shared with #31
 * - launch.ts         exec vs connect per provider
 * - runner-backend.ts OFFICE_RUNNER_BACKEND selection
 */
export * from "./commands.ts";
export * from "./credentials.ts";
export * from "./errors.ts";
export * from "./ladder.ts";
export * from "./launch.ts";
export * from "./manager.ts";
export * from "./robot.ts";
export * from "./runner-backend.ts";
export * from "./state-machine.ts";
export * from "./store.ts";
export * from "./tokens.ts";
export * from "./workspaces.ts";
