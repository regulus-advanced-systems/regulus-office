/**
 * The runtime half of the AgentManager: which agents are tracked, their
 * RobotState, and the event sink every source publishes into (structured
 * channels pumped here, the Claude hook routes, the heuristic rungs of the
 * status ladder). Persists events and status, publishes robots, refreshes
 * floor counters. The lifecycle commands live in manager.ts.
 */
import type { AdapterRegistry, AgentControl, RunnerContext } from "@regulus/agent-adapters";
import { tmuxSessionName } from "@regulus/agent-adapters";
import type { AgentEvent, AgentStatus, PendingPermission, ProviderId } from "@regulus/protocol";
import type { Db } from "../../db/index.ts";
import type { Logger } from "../../logging.ts";
import type { Runner } from "../../runners/types.ts";
import type { TerminalTarget } from "../../terminals/targets.ts";
import type { Workspaces } from "../../worktrees/types.ts";
import { WorkspaceError } from "../../worktrees/types.ts";
import type { AgentEventSink } from "../events.ts";
import { CredentialResolver } from "./credentials.ts";
import { AgentManagerError } from "./errors.ts";
import { type HeuristicRung, SessionWatcher } from "./ladder.ts";
import { closeQuietly, type LaunchProfile, launchProfile } from "./launch.ts";
import { DEFAULT_PERMISSION_TTL_MS, PendingPermissions } from "./permissions.ts";
import { type AgentView, applyEvent, robotState, setStatus, viewFromRow } from "./robot.ts";
import { type AgentRow, AgentStore, type RetentionPolicy } from "./store.ts";
import { DbAgentTokens } from "./tokens.ts";

/** Where robots are shown (FloorRooms satisfies this). */
export interface RobotPublisher {
  publishRobot(floorId: string, robot: ReturnType<typeof robotState>): void;
  removeRobot(floorId: string, agentId: string): void;
  /**
   * The robot's pending permission requests changed (empty = none left).
   * They carry what exactly would run, so they go to its controllers only.
   */
  publishPermissions?(
    floorId: string,
    agentId: string,
    ownerUserId: string,
    requests: PendingPermission[],
  ): void;
}

/** Worktree status and the one-click PR (#31 `createWorktrees`). */
export interface AgentWorktreeTools {
  status(agentId: string): Promise<{ branch: string; uncommitted: string[] }>;
  openPullRequest(
    agentId: string,
    options: { draft?: boolean; title?: string; body?: string; actorUserId?: string },
  ): Promise<{ number: number; url: string; draft: boolean; created: boolean; branch: string }>;
}

/** Scrollback snapshots of running agents (terminals `ScrollbackRecorder`). */
export interface ScrollbackTracker {
  track(target: TerminalTarget): () => void;
}

export interface AgentManagerOptions {
  db: Db;
  runner: Runner;
  adapters: AdapterRegistry;
  robots: RobotPublisher;
  /** Re-read BuildingRoom floor counters (`rooms.refreshFloors`). */
  refreshFloors?: () => Promise<void>;
  workspaces?: Workspaces;
  /** Worktree status and PRs for `agent.worktree` / `agent.pr`. */
  worktreeTools?: AgentWorktreeTools;
  /** How long an unanswered permission request stays answerable when the adapter does not say. */
  permissionTtlMs?: number;
  keyring?: ConstructorParameters<typeof CredentialResolver>[1];
  /** Office base URL as reachable from inside runners (hooks, statusline). */
  officeUrl: string;
  logger: Logger;
  retention?: RetentionPolicy;
  launchProfiles?: Parameters<typeof launchProfile>[1];
  scrollback?: ScrollbackTracker;
  /** Session liveness / heuristic polling interval. */
  pollIntervalMs?: number;
  idleAfterMs?: number;
  now?: () => number;
}

interface LiveAgent {
  view: AgentView;
  control?: AgentControl;
  ctx?: RunnerContext;
  profile: LaunchProfile;
  untrack?: () => void;
  /** The control reports each permission request's resolution (onPermissionResolved). */
  perRequestPermissions?: boolean;
  offResolved?: () => void;
}

export class AgentRuntime implements AgentEventSink {
  readonly store: AgentStore;
  readonly tokens: DbAgentTokens;
  readonly runner: Runner;
  readonly adapters: AdapterRegistry;
  readonly logger: Logger;
  readonly officeUrl: string;
  readonly credentials: CredentialResolver;
  readonly watcher: SessionWatcher;
  readonly permissions: PendingPermissions;
  protected readonly opts: AgentManagerOptions;
  protected readonly agents = new Map<string, LiveAgent>();
  protected countersTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: AgentManagerOptions) {
    this.opts = opts;
    this.runner = opts.runner;
    this.adapters = opts.adapters;
    this.officeUrl = opts.officeUrl;
    this.logger = opts.logger.child({ component: "agents" });
    this.store = new AgentStore(opts.db, opts.retention, this.now);
    this.tokens = new DbAgentTokens(opts.db);
    this.credentials = new CredentialResolver(opts.db, opts.keyring);
    this.permissions = new PendingPermissions({
      now: this.now,
      onChange: (agentId, requests) => {
        const view = this.agents.get(agentId)?.view;
        if (!view) return;
        this.opts.robots.publishPermissions?.(view.floorId, agentId, view.ownerUserId, requests);
      },
    });
    this.watcher = new SessionWatcher({
      intervalMs: opts.pollIntervalMs,
      idleAfterMs: opts.idleAfterMs,
      now: this.now,
      onGone: (agentId) => this.sessionGone(agentId),
      onStatus: (agentId, status, rung) => this.heuristic(agentId, status, rung),
      onError: (agentId, err) => this.logger.debug({ agentId, err }, "session poll failed"),
    });
  }

  readonly now = (): number => (this.opts.now ?? Date.now)();

  /** Pump a control's events and watch its tmux session (also used by adopt.ts). */
  attach(live: LiveAgent, control: AgentControl, heuristics: boolean): void {
    live.control = control;
    live.offResolved?.();
    const agentId = live.view.agentId;
    live.offResolved = control.onPermissionResolved?.((requestId) =>
      this.permissions.remove(agentId, requestId),
    );
    live.perRequestPermissions = live.offResolved !== undefined;
    void this.pump(live, control);
    if (live.profile.mode === "exec") {
      const session = { userId: live.view.ownerUserId, name: tmuxSessionName(live.view.agentId) };
      this.watcher.watch({ agentId: live.view.agentId, runner: this.runner, session, heuristics });
      live.untrack?.();
      live.untrack = this.opts.scrollback?.track({
        agentId: live.view.agentId,
        ownerUserId: live.view.ownerUserId,
        floorId: live.view.floorId,
        session,
        runner: this.runner,
      });
    }
  }

  protected async pump(live: LiveAgent, control: AgentControl): Promise<void> {
    try {
      for await (const event of control.events) {
        await this.publish(live.view.agentId, event);
        this.syncSessionId(live);
      }
    } catch (err) {
      this.logger.warn({ agentId: live.view.agentId, err }, "agent event stream failed");
    } finally {
      if (live.control === control) live.control = undefined;
    }
  }

  // ---- Event sink ----------------------------------------------------------

  /** `AgentEventSink`: persist, fold into the robot, publish. Events are schema-valid. */
  publish(agentId: string, event: AgentEvent): void {
    const live = this.agents.get(agentId);
    if (!live) return;
    if (!(event.kind === "message" && event.partial)) this.store.appendEvent(agentId, event);
    const result = applyEvent(live.view, event, this.now());
    if (result.refused) {
      this.logger.debug({ agentId, ...result.refused }, "status change refused");
    }
    if (event.kind === "permission_request" && live.view.status === "waiting_permission") {
      this.permissions.add(agentId, event, this.permissionTtl(live.view.provider));
    }
    if (
      result.statusChanged &&
      live.view.status !== "waiting_permission" &&
      !live.perRequestPermissions
    ) {
      // Fallback for adapters without a per-request signal: once the agent
      // stops waiting, nothing it asked for can be answered here any more.
      // Adapters with one (Codex, Claude) resolve requests individually, so
      // parallel approvals stay visible until each is resolved.
      this.permissions.clear(agentId);
    }
    if (result.statusChanged) {
      this.store.setStatus(agentId, live.view.status, this.now());
      this.countersChanged();
      if (live.view.status === "exited") this.processGone(live);
    }
    if (result.robotChanged) this.publishLive(live);
  }

  protected heuristic(agentId: string, status: AgentStatus, rung: HeuristicRung): void {
    this.publish(agentId, {
      kind: "status",
      ts: this.now(),
      status,
      reason: `derived from ${rung}`,
    });
  }

  protected sessionGone(agentId: string): void {
    this.publish(agentId, { kind: "exit", ts: this.now(), reason: "tmux session ended" });
  }

  /** Claude bounds how long a request is held; others use `permissionTtlMs`. */
  protected permissionTtl(provider: ProviderId): number {
    const adapter = this.adapters.find(provider) as { permissionHoldSeconds?: unknown } | undefined;
    const hold = adapter?.permissionHoldSeconds;
    if (typeof hold === "number" && hold > 0) return hold * 1000;
    return this.opts.permissionTtlMs ?? DEFAULT_PERMISSION_TTL_MS;
  }

  protected processGone(live: LiveAgent): void {
    live.offResolved?.();
    live.offResolved = undefined;
    live.perRequestPermissions = false;
    this.permissions.clear(live.view.agentId);
    this.watcher.unwatch(live.view.agentId);
    live.untrack?.();
    live.untrack = undefined;
    const control = live.control;
    live.control = undefined;
    void closeQuietly(control);
  }

  /** For the terminal bridge (#24): where an agent's tmux session lives. */
  resolveTerminalTarget(agentId: string): TerminalTarget | null {
    const row = this.store.get(agentId);
    if (!row?.tmuxSession) return null;
    return {
      agentId,
      ownerUserId: row.ownerUserId,
      floorId: row.floorId,
      session: { userId: row.ownerUserId, name: row.tmuxSession },
      runner: this.runner,
    };
  }

  /** Runner context of a running agent, for the hook routes' `ingest`. */
  contextFor(agentId: string): RunnerContext | undefined {
    return this.agents.get(agentId)?.ctx;
  }

  view(agentId: string): Readonly<AgentView> | undefined {
    return this.agents.get(agentId)?.view;
  }

  /** Detach from every agent without stopping any (office shutdown). */
  async close(): Promise<void> {
    this.watcher.stop();
    this.permissions.dispose();
    if (this.countersTimer) clearTimeout(this.countersTimer);
    // Forget them first so whatever a closing control still emits is dropped
    // instead of being recorded as the agent exiting.
    const all = [...this.agents.values()];
    this.agents.clear();
    for (const live of all) {
      live.untrack?.();
      await closeQuietly(live.control);
      live.control = undefined;
    }
  }

  // ---- Internals shared with adopt.ts ---------------------------------------

  track(row: AgentRow): LiveAgent {
    return this.trackRow(row);
  }

  publishRobot(live: LiveAgent): void {
    this.publishLive(live);
  }

  markOffline(live: LiveAgent): void {
    if (setStatus(live.view, "offline", this.now())) {
      this.store.setStatus(live.view.agentId, "offline", this.now());
    }
  }

  profileFor(row: AgentRow): LaunchProfile {
    return launchProfile(row.provider, this.opts.launchProfiles);
  }

  protected trackRow(row: AgentRow): LiveAgent {
    const live: LiveAgent = {
      view: viewFromRow(row, this.store.ownerName(row.ownerUserId)),
      profile: this.profileFor(row),
    };
    this.agents.set(row.id, live);
    return live;
  }

  protected row(agentId: string): AgentRow {
    const row = this.store.get(agentId);
    if (!row) throw new AgentManagerError("not_found", "no such agent");
    return row;
  }

  protected publishLive(live: LiveAgent): void {
    this.opts.robots.publishRobot(live.view.floorId, robotState(live.view));
  }

  protected failed(live: LiveAgent, err: unknown): void {
    const agentId = live.view.agentId;
    this.logger.error({ agentId, err: errorSummary(err) }, "agent launch failed");
    this.processGone(live);
    void this.runner.kill({ userId: live.view.ownerUserId, agentId }).catch(() => {});
    this.publish(agentId, {
      kind: "status",
      ts: this.now(),
      status: "error",
      reason: "failed to start",
    });
  }

  protected syncSessionId(live: LiveAgent): void {
    const id = live.control?.providerSessionId();
    if (!id) return;
    const row = this.store.get(live.view.agentId);
    if (row && row.providerSessionId !== id) {
      this.store.update(row.id, { providerSessionId: id });
    }
  }

  protected countersChanged(): void {
    const refresh = this.opts.refreshFloors;
    if (!refresh || this.countersTimer) return;
    this.countersTimer = setTimeout(() => {
      this.countersTimer = undefined;
      refresh().catch((err) => this.logger.warn({ err }, "floor counter refresh failed"));
    }, 100);
  }
}

/** Manager errors pass through; workspace errors carry client-safe messages. */
export function asManagerError(err: unknown, fallback: string): AgentManagerError {
  if (err instanceof AgentManagerError) return err;
  if (err instanceof WorkspaceError) {
    const code = err.status === 404 ? "not_found" : err.status === 409 ? "conflict" : "failed";
    return new AgentManagerError(code, err.message, err.files);
  }
  return new AgentManagerError("failed", fallback);
}

/** Error text for logs: message only, never objects that might carry env. */
export function errorSummary(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 500) : "unknown error";
}

export type { LiveAgent };
