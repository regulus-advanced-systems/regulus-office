/**
 * How a provider's agent is started (research 04 "Integration strategy").
 *
 * - `exec`: the SpawnPlan runs in the human's tmux session via `Runner.exec`,
 *   then `connect` observes it (Claude Code: TUI in tmux, events via hooks).
 * - `connect`: `AgentAdapter.connect` starts the process itself through
 *   `RunnerOps.spawnPiped` (Codex app-server); the plan is not `exec`ed.
 *
 * `firstPrompt` says whether the task prompt goes into the SpawnRequest (the
 * adapter puts it on argv, as Claude Code does) or is sent with
 * `AgentControl.prompt` once connected (Codex, and anything else by default).
 */
import type { AgentControl, AgentRecord, SpawnPlan } from "@regulus/agent-adapters";
import { SecretEnv } from "@regulus/agent-adapters";
import type { ProviderId } from "@regulus/protocol";
import type { AgentRow } from "./store.ts";

export interface LaunchProfile {
  mode: "exec" | "connect";
  firstPrompt: "plan" | "control";
}

export const DEFAULT_LAUNCH_PROFILES: Readonly<Partial<Record<ProviderId, LaunchProfile>>> = {
  "claude-code": { mode: "exec", firstPrompt: "plan" },
  codex: { mode: "connect", firstPrompt: "control" },
};

export const FALLBACK_LAUNCH_PROFILE: LaunchProfile = { mode: "exec", firstPrompt: "control" };

export function launchProfile(
  provider: ProviderId,
  overrides: Partial<Record<ProviderId, LaunchProfile>> = {},
): LaunchProfile {
  return overrides[provider] ?? DEFAULT_LAUNCH_PROFILES[provider] ?? FALLBACK_LAUNCH_PROFILE;
}

/**
 * The plan an already-running tmux agent was started with, as far as
 * `connect` needs it when re-adopting after an office restart: identity,
 * session and provider session. No env and no files: nothing is re-run and
 * no secret is re-materialised.
 */
export function adoptionPlan(row: AgentRow): SpawnPlan {
  return {
    agentId: row.id,
    provider: row.provider,
    argv: [],
    env: SecretEnv.empty(),
    cwd: row.workdir,
    tmuxSession: row.tmuxSession ?? `agent-${row.id}`,
    files: [],
    providerSessionId: row.providerSessionId ?? undefined,
    permissionMode: row.permissionMode ?? undefined,
  };
}

export function agentRecord(row: AgentRow): AgentRecord {
  return {
    agentId: row.id,
    ownerUserId: row.ownerUserId,
    provider: row.provider,
    model: row.model || undefined,
    effort: row.effort ?? undefined,
    permissionMode: row.permissionMode ?? undefined,
    profileId: row.profileId,
    status: row.status,
    providerSessionId: row.providerSessionId ?? undefined,
    tmuxSession: row.tmuxSession ?? `agent-${row.id}`,
    workdir: row.workdir,
    worktreeBranch: row.worktreeBranch ?? undefined,
  };
}

/** Close a control without letting a failing close break the caller. */
export async function closeQuietly(control: AgentControl | undefined): Promise<void> {
  try {
    await control?.close();
  } catch {
    // already closed or the process is gone
  }
}
