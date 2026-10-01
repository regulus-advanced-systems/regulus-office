/**
 * Spawn admission (SPEC §5, §8, D2): floor access `spawn`/`manage`, a cloned
 * repo on that floor, an installed provider, a credential profile the human
 * may use, and a free desk, then the `agents` row and desk claim in one
 * transaction. Nothing runs and nothing is decrypted here.
 */

import type { AdapterRegistry } from "@regulus/agent-adapters";
import { tmuxSessionName } from "@regulus/agent-adapters";
import {
  defaultPermissionMode,
  isPermissionModeFor,
  type SpawnAgentCommand,
} from "@regulus/protocol";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { AUDIT_ACTIONS } from "../../auth/audit.ts";
import type { Db } from "../../db/index.ts";
import { floorRepos } from "../../db/schema/index.ts";
import { type FloorActor, floorAccessFor } from "../../floors/access.ts";
import type { CredentialResolver } from "./credentials.ts";
import { AgentManagerError } from "./errors.ts";
import type { AgentStore } from "./store.ts";

export type SpawnInput = Omit<z.output<typeof SpawnAgentCommand>, "type">;

export interface AdmittedSpawn {
  agentId: string;
  seatId: string;
  taskTitle: string;
}

export function admitSpawn(
  deps: { db: Db; store: AgentStore; adapters: AdapterRegistry; credentials: CredentialResolver },
  actor: FloorActor,
  input: SpawnInput,
  now: number,
): AdmittedSpawn {
  const access = floorAccessFor(deps.db, actor, input.floorId);
  if (access !== "spawn" && access !== "manage") {
    throw new AgentManagerError("forbidden", "you may not spawn henchmen in this operation");
  }
  const repo = deps.db
    .select()
    .from(floorRepos)
    .where(and(eq(floorRepos.id, input.repoId), eq(floorRepos.floorId, input.floorId)))
    .get();
  if (!repo) throw new AgentManagerError("bad_request", "no such repo in this operation");
  if (repo.cloneStatus !== "ready") {
    throw new AgentManagerError("unavailable", "the repo is not cloned yet");
  }
  if (!deps.adapters.has(input.provider)) {
    throw new AgentManagerError("bad_request", `${input.provider} is not installed`);
  }
  if (input.permissionMode && !isPermissionModeFor(input.provider, input.permissionMode)) {
    throw new AgentManagerError(
      "bad_request",
      `${input.provider} has no permission mode ${input.permissionMode}`,
    );
  }
  // Stored resolved, so the panel shows it and a resume keeps it (#166).
  const permissionMode = input.permissionMode ?? defaultPermissionMode(input.provider) ?? null;
  const profileId = deps.credentials.check(actor.id, input.provider, input.profileId);

  const agentId = crypto.randomUUID();
  // An empty prompt is allowed: the robot starts idle and waits (#142).
  const issueTitle = input.issueNumber ? `Issue #${input.issueNumber}` : "";
  const taskTitle = (input.taskTitle || input.prompt.split("\n")[0] || issueTitle).slice(0, 200);
  const seatId = deps.store.insertWithDesk(
    {
      id: agentId,
      floorId: input.floorId,
      repoId: input.repoId,
      deskSeatId: "",
      ownerUserId: actor.id,
      provider: input.provider,
      model: input.model,
      effort: input.effort ?? null,
      permissionMode,
      profileId,
      status: "starting",
      tmuxSession: tmuxSessionName(agentId),
      workdir: repo.workdir,
      taskTitle,
      issueNumber: input.issueNumber ?? null,
      prNumber: input.prNumber ?? null,
      lastActivityAt: new Date(now),
      // The command minus anything credential-shaped (profileId is a reference).
      spawnArgsJson: JSON.stringify({
        seatId: input.seatId,
        model: input.model,
        effort: input.effort,
        permissionMode: input.permissionMode,
        prompt: input.prompt,
        taskTitle: input.taskTitle,
        issueNumber: input.issueNumber,
        prNumber: input.prNumber,
        autoWorktree: input.autoWorktree,
      }),
    },
    input.seatId,
  );
  deps.store.audit(actor.id, AUDIT_ACTIONS.agentSpawn, agentId, {
    floorId: input.floorId,
    repoId: input.repoId,
    seatId,
    provider: input.provider,
    model: input.model,
    permissionMode,
    profileId,
  });
  return { agentId, seatId, taskTitle };
}
