/**
 * Names used by the linux-user backend (SPEC §4.4, §8), mirrored by the
 * helper's argument grammar (helper/office-runner-helper).
 *
 * Linux user names are at most 32 characters, and office user ids are UUIDs
 * (36), so `office-u-<userId>` does not fit. Each human gets a compact runner
 * id instead: short lowercase ids (<= 16 chars) are used as they are, anything
 * else becomes the first 23 hex chars of its SHA-256 (92 bits). The two forms
 * differ in length, so they cannot collide. The account is `office-u-<rid>`,
 * its group has the same name, and its tmux socket is `<tmux dir>/<rid>.sock`.
 */
import { createHash } from "node:crypto";
import { agentIdFromSession } from "@regulus/agent-adapters";

/** What the helper accepts as a runner id. */
export const RUNNER_ID = /^[a-z0-9]{1,23}$/;
const LITERAL_ID = /^[a-z0-9]{1,16}$/;
/** Same as `tmuxSessionName` in @regulus/agent-adapters. */
export const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function runnerId(userId: string): string {
  if (userId.length === 0) throw new Error("empty user id");
  if (LITERAL_ID.test(userId)) return userId;
  return createHash("sha256").update(userId).digest("hex").slice(0, 23);
}

export function runnerUserName(userId: string): string {
  return `office-u-${runnerId(userId)}`;
}

export function checkAgentId(agentId: string): string {
  if (!AGENT_ID.test(agentId)) throw new Error("invalid agent id");
  return agentId;
}

/** A session name the helper accepts (`agent-<agentId>`). */
export function checkSessionName(name: string): string {
  if (agentIdFromSession(name) === null) throw new Error("invalid tmux session name");
  return name;
}

/** Absolute path without control characters (the helper rejects anything else). */
export function checkRunnerPath(path: string): string {
  const control = [...path].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
  if (!path.startsWith("/") || path.length > 4096 || control) {
    throw new Error("invalid runner path");
  }
  return path;
}

/** The cgroup scopes of an agent: `agent-<id>.scope` (tmux) and `agent-<id>.io-<n>.scope` (piped). */
export function isAgentScope(dirName: string, agentId: string): boolean {
  return (
    dirName === `agent-${agentId}.scope` ||
    (dirName.startsWith(`agent-${agentId}.`) && dirName.endsWith(".scope"))
  );
}
