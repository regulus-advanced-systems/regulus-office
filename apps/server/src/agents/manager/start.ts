/**
 * Starting an agent process (spawn, resume, boot relaunch): provision the
 * owner's runner, mount the owner's own clone and the agent's workdir (#114:
 * never the operation mirror or anything of another human), give the henchman its own
 * sandbox when the backend has them (D18, #169), issue a hook token, resolve
 * (decrypt) the credential, build the SpawnPlan, then `Runner.exec` and/or
 * `connect` per the provider's launch profile (launch.ts).
 *
 * SPEC §8: every runner call is bound to the agent's owner; the decrypted
 * key exists only inside the returned plan's `SecretEnv` (and the adapter's
 * control that holds the plan), never in a row, event or log.
 */
import {
  type AdapterRegistry,
  type AgentControl,
  type RunnerContext,
  Secret,
  SecretEnv,
} from "@regulus/agent-adapters";
import type { Logger } from "../../logging.ts";
import { bindRunnerOps, type Runner, type RunnerUser } from "../../runners/types.ts";
import { agentGitEnv } from "../../worktrees/index.ts";
import type { CredentialResolver } from "./credentials.ts";
import type { LaunchProfile } from "./launch.ts";
import type { AgentRow } from "./store.ts";
import type { DbAgentTokens } from "./tokens.ts";

export interface StartDeps {
  runner: Runner;
  adapters: AdapterRegistry;
  tokens: DbAgentTokens;
  credentials: CredentialResolver;
  officeUrl: string;
  now: () => number;
  logger?: Logger;
}

export interface Started {
  control: AgentControl;
  ctx: RunnerContext;
  workdir: string;
  tmuxSession: string;
  providerSessionId: string | undefined;
}

export async function startAgent(
  deps: StartDeps,
  row: AgentRow,
  profile: LaunchProfile,
  /** `clonePath`: the owner's own clone, which the agent's worktree (if any) belongs to. */
  opts: { prompt?: string; resumeSessionId?: string; clonePath: string },
): Promise<Started> {
  const adapter = deps.adapters.get(row.provider);
  const user: RunnerUser = { userId: row.ownerUserId };
  const handle = await deps.runner.provision(user);
  const repo = { operationId: row.operationId, repoId: row.repoId };
  const mounted = await deps.runner.mountProject(user, { ...repo, workdir: opts.clonePath });
  const workdir =
    row.workdir === opts.clonePath
      ? mounted.workdir
      : (await deps.runner.mountProject(user, { ...repo, workdir: row.workdir })).workdir;
  // Its own processes, ports and limits (D18); `exec`/`connect` below then run in it.
  const sandbox = await deps.runner.sandbox?.(
    { userId: row.ownerUserId, agentId: row.id },
    { workdir },
  );
  if (sandbox) {
    deps.logger?.info(
      {
        agentId: row.id,
        host: sandbox.host,
        ports: `${sandbox.ports.first}-${sandbox.ports.last}`,
      },
      "agent sandbox ready",
    );
  }
  const ctx: RunnerContext = {
    backend: deps.runner.backend,
    userId: row.ownerUserId,
    home: handle.home,
    runner: bindRunnerOps(deps.runner, user),
    officeUrl: deps.officeUrl,
    agentToken: Secret.of(deps.tokens.issue(row.id)),
    now: deps.now,
  };
  const { credential } = deps.credentials.resolve(row.ownerUserId, row.provider, row.profileId);
  const built = adapter.buildSpawn(
    {
      agentId: row.id,
      provider: row.provider,
      model: row.model || undefined,
      effort: row.effort ?? undefined,
      permissionMode: row.permissionMode ?? undefined,
      workdir,
      prompt: profile.firstPrompt === "plan" ? opts.prompt : undefined,
      resumeSessionId: opts.resumeSessionId,
      credential,
    },
    ctx,
  );
  // The checkout belongs to the office account; let the agent's git use it.
  const plan = {
    ...built,
    env: SecretEnv.of(agentGitEnv(workdir, mounted.workdir)).merge(built.env),
  };
  // The CLI's own first-run state (Claude: onboarding done, trust for the
  // henchman's own worktree only, never its owner's clone; #158).
  const worktree = row.workdir === opts.clonePath ? undefined : workdir;
  const prepared = await adapter.prepareSpawn?.(plan, ctx, { worktree });
  if (prepared) {
    deps.logger?.info({ agentId: row.id, ...prepared }, "agent CLI first-run state prepared");
  }
  if (profile.mode === "exec") await deps.runner.exec(user, plan);
  const control = adapter.connect(plan, ctx);
  return {
    control,
    ctx,
    workdir,
    tmuxSession: plan.tmuxSession,
    providerSessionId: plan.providerSessionId ?? control.providerSessionId(),
  };
}
