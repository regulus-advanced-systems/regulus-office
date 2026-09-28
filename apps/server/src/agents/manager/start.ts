/**
 * Starting an agent process (spawn, resume, boot relaunch): provision the
 * owner's runner, mount the floor repo, issue a hook token, resolve (decrypt)
 * the credential, build the SpawnPlan, then `Runner.exec` and/or `connect`
 * per the provider's launch profile (launch.ts).
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
  opts: { prompt?: string; resumeSessionId?: string; repoWorkdir: string },
): Promise<Started> {
  const adapter = deps.adapters.get(row.provider);
  const user: RunnerUser = { userId: row.ownerUserId };
  const handle = await deps.runner.provision(user);
  const mounted = await deps.runner.mountProject(user, {
    floorId: row.floorId,
    repoId: row.repoId,
    workdir: opts.repoWorkdir,
  });
  const workdir = row.workdir === opts.repoWorkdir ? mounted.workdir : row.workdir;
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
