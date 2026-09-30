/**
 * AgentManager (issue #26; SPEC §5, §7, §8, §11): owns the agent lifecycle.
 *
 * spawn → starting → idle / working / waiting_* → done / error / exited, with
 * guarded transitions (state-machine.ts); persistence of `agents` and
 * `agent_events`; RobotState in the FloorRoom and floor counters in the
 * BuildingRoom; re-adoption of live tmux sessions on boot (adopt.ts).
 *
 * It is also the `AgentEventSink` every event source publishes into: the
 * structured channels it pumps, the Claude hook routes, and the heuristic
 * rungs of the status ladder (ladder.ts).
 *
 * Credentials (SPEC §8): keys are decrypted by `CredentialResolver.resolve`
 * right before `buildSpawn`, live only in that SpawnPlan's `SecretEnv`, and
 * are never written to a row, an event or a log. Agents run only in their
 * owner's runner: every runner call is bound to `ownerUserId`.
 */
import type { AgentControl } from "@regulus/agent-adapters";
import { mayControlRobot, mayEmergencyStop, type PermissionDecision } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { AUDIT_ACTIONS } from "../../auth/audit.ts";
import { floorRepos } from "../../db/schema/index.ts";
import type { FloorActor } from "../../floors/access.ts";
import { LEGACY_WORKSPACE_MESSAGE, type Workspaces } from "../../worktrees/types.ts";
import { adoptAll } from "./adopt.ts";
import { AgentManagerError } from "./errors.ts";
import { closeQuietly } from "./launch.ts";
import { setStatus } from "./robot.ts";
import {
  type AgentManagerOptions,
  AgentRuntime,
  type AgentWorktreeTools,
  asManagerError,
  errorSummary,
  type LiveAgent,
} from "./runtime.ts";
import { admitSpawn, type SpawnInput } from "./spawn.ts";
import { startAgent } from "./start.ts";
import { isLive, RESUMABLE_STATUSES } from "./state-machine.ts";
import type { AgentRow } from "./store.ts";
import { RepoWorkspaces, taskSlug } from "./workspaces.ts";

export type {
  AgentManagerOptions,
  AgentWorktreeTools,
  LiveAgent,
  RobotPublisher,
  ScrollbackTracker,
} from "./runtime.ts";
export type { SpawnInput } from "./spawn.ts";

export class AgentManager extends AgentRuntime {
  readonly #repoWorkspaces: RepoWorkspaces;

  constructor(opts: AgentManagerOptions) {
    super(opts);
    this.#repoWorkspaces = new RepoWorkspaces(opts.db);
  }

  // ---- Spawn ---------------------------------------------------------------

  /**
   * `hooks.onAdmitted` runs once the agent row and desk are claimed, before
   * anything starts (the task queue links its task to the robot, #37).
   */
  async spawn(
    actor: FloorActor,
    input: SpawnInput,
    hooks?: { onAdmitted?(agentId: string): void },
  ): Promise<{ agentId: string; seatId: string }> {
    const admitted = admitSpawn(
      {
        db: this.opts.db,
        store: this.store,
        adapters: this.adapters,
        credentials: this.credentials,
      },
      actor,
      input,
      this.now(),
    );
    const { agentId, seatId } = admitted;
    hooks?.onAdmitted?.(agentId);
    const live = this.trackRow(this.row(agentId));
    this.publishLive(live);
    this.countersChanged();
    try {
      const prepare = {
        agentId,
        floorId: input.floorId,
        repoId: input.repoId,
        slug: taskSlug({ taskTitle: admitted.taskTitle, issueNumber: input.issueNumber }),
        ownerUserId: actor.id,
      };
      // Without a worktree the agent works in its owner's own clone (#114).
      const clones = this.opts.clones;
      const workspace = input.autoWorktree
        ? await this.#workspaces().prepare(prepare)
        : clones
          ? await clones.prepareClone(prepare)
          : await this.#repoWorkspaces.prepare(prepare);
      this.store.update(agentId, { workdir: workspace.workdir, worktreeBranch: workspace.branch });
      live.view.worktreeBranch = workspace.branch;
      await this.#launch(live, { prompt: input.prompt });
    } catch (err) {
      this.failed(live, err);
      throw asManagerError(err, "the agent could not be started");
    }
    return { agentId, seatId };
  }

  async #launch(
    live: LiveAgent,
    opts: { prompt?: string; resumeSessionId?: string },
  ): Promise<void> {
    const row = this.row(live.view.agentId);
    const started = await startAgent(this, row, live.profile, {
      ...opts,
      clonePath: this.#clonePath(row),
    });
    live.ctx = started.ctx;
    this.store.update(row.id, {
      workdir: started.workdir,
      tmuxSession: started.tmuxSession,
      providerSessionId: started.providerSessionId ?? null,
    });
    const structured = this.adapters.get(row.provider).capabilities.structured;
    this.attach(live, started.control, !structured);
    if (opts.prompt && live.profile.firstPrompt === "control") {
      await started.control.prompt(opts.prompt);
    }
    this.syncSessionId(live);
  }
  // ---- Controls for #33 ----------------------------------------------------

  async prompt(actor: FloorActor, agentId: string, text: string): Promise<void> {
    const control = this.#controlFor(actor, agentId);
    await this.#adapterCall(agentId, "prompt", () => control.prompt(text));
  }

  /**
   * Answer a pending permission request. One the adapter no longer holds
   * (expired, or already answered in the terminal) is refused with a hint
   * and dropped from the controllers' list.
   */
  async respondPermission(
    actor: FloorActor,
    agentId: string,
    requestId: string,
    decision: PermissionDecision,
  ): Promise<void> {
    const control = this.#controlFor(actor, agentId);
    try {
      await control.respondPermission(requestId, decision);
    } catch (err) {
      this.permissions.remove(agentId, requestId);
      this.logger.info({ agentId, requestId, err: errorSummary(err) }, "permission answer refused");
      throw new AgentManagerError(
        "conflict",
        "that request is no longer pending; answer it in the robot's terminal",
      );
    }
    this.permissions.remove(agentId, requestId);
    this.store.audit(actor.id, AUDIT_ACTIONS.agentApprove, agentId, { requestId, decision });
  }

  async interrupt(actor: FloorActor, agentId: string): Promise<void> {
    const control = this.#controlFor(actor, agentId);
    await this.#adapterCall(agentId, "interrupt", () => control.interrupt());
  }

  /** Uncommitted files of the agent's worktree (send-home and PR dialogs). */
  async worktreeStatus(
    actor: FloorActor,
    agentId: string,
  ): Promise<{ branch: string; uncommitted: string[] }> {
    this.#authorize(actor, agentId);
    const tools = this.#worktreeTools();
    try {
      const status = await tools.status(agentId);
      return { branch: status.branch, uncommitted: status.uncommitted };
    } catch (err) {
      throw asManagerError(err, "the worktree could not be read");
    }
  }

  /**
   * One-click PR from the agent's branch (#31). A dirty worktree is refused
   * with its files; an already open PR is returned. The robot shows the number.
   */
  async openPullRequest(
    actor: FloorActor,
    agentId: string,
    opts: { draft: boolean; title?: string; body?: string },
  ) {
    const live = this.#authorize(actor, agentId);
    const tools = this.#worktreeTools();
    let pr: Awaited<ReturnType<AgentWorktreeTools["openPullRequest"]>>;
    try {
      pr = await tools.openPullRequest(agentId, { ...opts, actorUserId: actor.id });
    } catch (err) {
      throw asManagerError(err, "the pull request could not be opened");
    }
    if (live.view.prNumber !== pr.number) {
      live.view.prNumber = pr.number;
      this.publishLive(live);
    }
    this.observePullRequest(live, pr);
    return pr;
  }

  /** Stop the process (kill its session and processes). The robot stays at its desk. */
  async stop(actor: FloorActor, agentId: string): Promise<void> {
    const live = this.#authorize(actor, agentId);
    await this.#halt(live, "stopped");
    this.store.audit(actor.id, AUDIT_ACTIONS.agentStop, agentId);
  }

  /**
   * Office owner/admin escape hatch on anyone's robot (D12, #138): kill the
   * session like `stop`, keep the branch, the worktree and the desk, and
   * audit who did it to whose robot and why. Grants nothing else.
   */
  async emergencyStop(actor: FloorActor, agentId: string, reason?: string): Promise<void> {
    const live = this.agents.get(agentId);
    if (!live) throw new AgentManagerError("not_found", "no such agent");
    if (!mayEmergencyStop(actor)) {
      throw new AgentManagerError(
        "forbidden",
        "only an office owner or admin may emergency-stop a robot",
      );
    }
    await this.#halt(live, "emergency stop");
    this.store.audit(actor.id, AUDIT_ACTIONS.agentEmergencyStop, agentId, {
      ownerUserId: live.view.ownerUserId,
      ...(reason ? { reason } : {}),
    });
    this.logger.warn({ agentId, actorId: actor.id }, "agent emergency-stopped");
  }

  async #halt(live: LiveAgent, reason: string): Promise<void> {
    const { agentId, ownerUserId } = live.view;
    await closeQuietly(live.control);
    await this.runner.kill({ userId: ownerUserId, agentId });
    this.tokens.revoke(agentId);
    this.publish(agentId, { kind: "exit", ts: this.now(), reason });
  }

  /** Restart an exited / offline / failed agent, resuming its provider session when possible. */
  async resume(actor: FloorActor, agentId: string): Promise<void> {
    const live = this.#authorize(actor, agentId);
    if (!RESUMABLE_STATUSES.includes(live.view.status)) {
      throw new AgentManagerError("conflict", "the agent is still running");
    }
    await this.#halt(live, "restarting");
    await this.relaunch(live);
    this.store.audit(actor.id, AUDIT_ACTIONS.agentResume, agentId);
  }

  /** Back to `starting` and launch again with the stored provider session (adopt.ts too). */
  async relaunch(live: LiveAgent): Promise<void> {
    const row = this.row(live.view.agentId);
    const adapter = this.adapters.get(row.provider);
    if (setStatus(live.view, "starting", this.now())) {
      this.store.setStatus(row.id, "starting", this.now());
      this.publishLive(live);
      this.countersChanged();
    }
    try {
      await this.#launch(live, {
        resumeSessionId: adapter.capabilities.resume
          ? (row.providerSessionId ?? undefined)
          : undefined,
      });
    } catch (err) {
      this.failed(live, err);
      throw asManagerError(err, "the agent could not be restarted");
    }
  }

  /** Stop if needed, release the workspace, free the desk and remove the robot. */
  async sendHome(actor: FloorActor, agentId: string, opts: { keepBranch: boolean }): Promise<void> {
    await this.#sendHome(this.#authorize(actor, agentId), opts);
    this.store.audit(actor.id, AUDIT_ACTIONS.agentSendHome, agentId, {
      keepBranch: opts.keepBranch,
    });
  }

  /**
   * "Send all home" before an office owner/admin deletes a floor (#150): not
   * control (D12, #138), a floor-lifecycle step, so the branch is always kept
   * and the robot's owner is recorded in the audit entry.
   */
  async evacuate(actor: FloorActor, agentId: string): Promise<void> {
    const live = this.agents.get(agentId);
    if (!live) throw new AgentManagerError("not_found", "no such agent");
    if (!mayEmergencyStop(actor)) {
      throw new AgentManagerError("forbidden", "only an office owner or admin may clear a floor");
    }
    await this.#sendHome(live, { keepBranch: true });
    this.store.audit(actor.id, AUDIT_ACTIONS.agentSendHome, agentId, {
      keepBranch: true,
      floorEvacuation: true,
      ownerUserId: live.view.ownerUserId,
    });
  }

  async #sendHome(live: LiveAgent, opts: { keepBranch: boolean }): Promise<void> {
    const { agentId } = live.view;
    if (live.view.status !== "exited") await this.#halt(live, "sent home");
    this.processGone(live);
    await this.#workspaces().release({ agentId, keepBranch: opts.keepBranch });
    this.store.freeDesk(agentId);
    this.tokens.revoke(agentId);
    const adapter = this.adapters.find(live.view.provider) as { forget?(id: string): void };
    adapter?.forget?.(agentId);
    this.agents.delete(agentId);
    this.opts.robots.removeRobot(live.view.floorId, agentId);
    this.countersChanged();
  }

  /** Re-publish seated robots and re-adopt live sessions (boot). */
  async adopt(): Promise<void> {
    this.store.sweep();
    await adoptAll(this);
    this.countersChanged();
  }
  #authorize(actor: FloorActor, agentId: string): LiveAgent {
    const live = this.agents.get(agentId);
    if (!live) throw new AgentManagerError("not_found", "no such agent");
    if (!mayControlRobot(actor, live.view.ownerUserId)) {
      throw new AgentManagerError("forbidden", "only the robot's owner may control it");
    }
    return live;
  }

  #controlFor(actor: FloorActor, agentId: string): AgentControl {
    const live = this.#authorize(actor, agentId);
    if (!live.control || !isLive(live.view.status)) {
      throw new AgentManagerError("conflict", "the agent is not running");
    }
    return live.control;
  }

  #worktreeTools(): AgentWorktreeTools {
    const tools = this.opts.worktreeTools;
    if (!tools) throw new AgentManagerError("unavailable", "worktrees are not available");
    return tools;
  }

  /** Adapter failures become a safe message; the details stay in the server log. */
  async #adapterCall(agentId: string, what: string, call: () => Promise<void>): Promise<void> {
    try {
      await call();
    } catch (err) {
      this.logger.warn({ agentId, err: errorSummary(err) }, `agent ${what} failed`);
      throw new AgentManagerError("failed", `the agent did not accept the ${what}`);
    }
  }

  /**
   * The clone the agent's git uses: its owner's own clone (#114). A workspace
   * from before #114 lives in the floor's shared mirror, which runners can no
   * longer reach, so it is refused. Without `clones` (tests), the floor repo.
   */
  #clonePath(row: AgentRow): string {
    const clones = this.opts.clones;
    if (!clones) {
      const repo = this.opts.db
        .select({ workdir: floorRepos.workdir })
        .from(floorRepos)
        .where(eq(floorRepos.id, row.repoId))
        .get();
      return repo?.workdir ?? row.workdir;
    }
    const { clone, legacy } = clones.cloneFor(row);
    if (legacy) throw new AgentManagerError("conflict", LEGACY_WORKSPACE_MESSAGE);
    return clone;
  }

  /** A robot whose workspace predates per-human clones (#114): never started in a runner. */
  isLegacyWorkspace(row: AgentRow): boolean {
    const clones = this.opts.clones;
    if (!clones) return false;
    try {
      return clones.cloneFor(row).legacy;
    } catch {
      return false;
    }
  }

  #workspaces(): Workspaces {
    return this.opts.workspaces ?? this.#repoWorkspaces;
  }
}
