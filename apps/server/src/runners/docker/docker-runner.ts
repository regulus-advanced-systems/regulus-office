/**
 * `docker` runner backend (SPEC §8, D6; research 01 §10): one long-lived runner
 * container per human (see containers.ts), agents in that human's tmux server
 * inside it, every operation an Engine API exec as the runner's non-root uid.
 *
 * Secrets (SPEC §8 rule 2): a spawn's `SecretEnv` goes into a 0600 file on the
 * human's HOME volume, written through exec stdin (never argv), which the tmux
 * session sources and deletes before `exec`ing the agent. Piped processes get it
 * as exec-scoped `Env`, kept off the container config and `docker inspect`.
 *
 * Mounts: mounts.ts (the human's own area per floor) and `mountProject`.
 *
 * Sandboxes (D18, #169): with `sandboxes` set, `sandbox()` gives a robot its own
 * container (sandboxes.ts) and every call about that robot runs there
 * (exec-router.ts); the runner keeps login terminals and side processes.
 */
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { posix } from "node:path";
import type { PipedProcess, PlannedFile, SpawnPlan } from "@regulus/agent-adapters";
import type { SandboxSettings } from "../sandbox.ts";
import type {
  AgentRef,
  FloorRepoRef,
  MountedProject,
  Runner,
  RunnerHandle,
  RunnerUser,
  SandboxInfo,
  SandboxSpec,
  TmuxSessionRef,
} from "../types.ts";
import { type ContainerSettings, RunnerContainers } from "./containers.ts";
import { EngineClient } from "./engine.ts";
import type { Where } from "./exec-router.ts";
import { removeFloorAreas } from "./floor-cleanup.ts";
import type { RunnerLog } from "./heal.ts";
import { startPiped } from "./interactive.ts";
import {
  DEFAULT_FLOOR_ROOTS,
  humanMountTarget,
  isCovered,
  isOwnArea,
  toMountSpec,
  type VolumeMapping,
} from "./mounts.ts";
import { PipedTracker } from "./piped-tracker.ts";
import { type RefreshDeps, refreshIfDrifted } from "./refresh.ts";
import { type RemountDeps, remount } from "./remount.ts";
import { type DockerSandbox, DockerSandboxes } from "./sandboxes.ts";
import { DockerSessionOps, sessionOf, target } from "./session-ops.ts";
import { envFileContents, shellQuote, writeFileExec } from "./shell.ts";

export interface DockerRunnerOptions extends ContainerSettings {
  /** Defaults to a client for `DOCKER_HOST` / the local socket. */
  engine?: EngineClient;
  /** Roots whose `<root>/<floor>/<runner id>` dirs are mounted as a unit (see mounts.ts). */
  floorRoots?: readonly string[];
  volumeMap?: readonly VolumeMapping[];
  /** How long a recreate waits for piped side processes to finish (default 5 s). */
  pipedDrainMs?: number;
  /** Where runner recreates (#151) are logged, with a redacted reason. */
  logger?: RunnerLog;
  /** Per-agent sandboxes (#169); without it robots run in their human's runner. */
  sandboxes?: SandboxSettings;
}

export { DEFAULT_FLOOR_ROOTS, RunnerBusyError } from "./mounts.ts";
export { envFileContents, shellQuote } from "./shell.ts";

const sandboxInfo = (s: DockerSandbox): SandboxInfo => ({
  userId: s.userId,
  agentId: s.agentId,
  host: s.host,
  ports: s.ports,
  createdAt: s.createdAt,
});

export class DockerRunner extends DockerSessionOps implements Runner {
  readonly backend = "docker" as const;
  readonly #floorRoots: readonly string[];
  readonly #volumeMap: readonly VolumeMapping[];
  readonly #ids: Map<string, string>;
  readonly #piped: PipedTracker;
  readonly #refresh: RefreshDeps;
  readonly #remountDeps: RemountDeps;

  constructor(opts: DockerRunnerOptions) {
    const [uid, gid] = opts.user.split(":").map(Number);
    if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid === 0) {
      throw new Error(`docker runner user must be a numeric non-root uid:gid, got ${opts.user}`);
    }
    const engine = opts.engine ?? new EngineClient();
    const containers = new RunnerContainers(engine, opts, opts.logger);
    super(
      engine,
      containers,
      opts.sandboxes
        ? new DockerSandboxes(engine, containers, opts.sandboxes, opts.logger)
        : undefined,
    );
    this.#ids = this.router.ids;
    this.#floorRoots = opts.floorRoots ?? DEFAULT_FLOOR_ROOTS;
    this.#volumeMap = opts.volumeMap ?? [];
    this.#piped = new PipedTracker(opts.pipedDrainMs);
    this.#refresh = {
      containers: this.containers,
      piped: this.#piped,
      listSessions: (userId) =>
        this.router.tmux({ userId }, ["list-sessions", "-F", "#{session_name}"], false),
    };
    this.#remountDeps = {
      floorRoots: this.#floorRoots,
      volumeMap: this.#volumeMap,
      piped: this.#piped,
      // The runner's own sessions only: robots in sandboxes do not keep it busy.
      listSessions: (user) => this.runnerSessions(user),
      recreate: async (userId, mounts) => {
        this.#ids.set(userId, (await this.containers.recreate(userId, mounts)).id);
      },
    };
  }

  get home(): string {
    return this.containers.settings.home;
  }

  /**
   * The human's runner, created or started if needed (containers.ts replaces
   * a broken stopped one), and recreated from a rebuilt image when idle
   * (refresh.ts).
   */
  async provision(user: RunnerUser, opts: { refresh?: boolean } = {}): Promise<RunnerHandle> {
    let c = await this.containers.ensure(user.userId);
    if (opts.refresh !== false) c = await refreshIfDrifted(this.#refresh, c);
    this.#ids.set(user.userId, c.id);
    return this.#handle(user.userId, c.id);
  }

  /** Not part of `Runner`: a deleted floor's human areas, removed as the runner uid (#150). */
  removeFloorAreas(slug: string): Promise<void> {
    const { engine, containers } = this;
    const deps = { ...this.#remountDeps, engine, containers, settings: containers.settings };
    return removeFloorAreas(deps, slug);
  }

  /** Re-adopt runner containers after an office restart (starting stopped ones). */
  async recover(): Promise<RunnerHandle[]> {
    const found = await this.containers.list();
    for (const c of found) this.#ids.set(c.userId, c.id);
    return found.map((c) => this.#handle(c.userId, c.id));
  }

  /**
   * Remove the human's runner container and robot sandboxes and, with
   * `removeHome`, their credentials volume.
   */
  async deprovision(user: RunnerUser, opts: { removeHome?: boolean } = {}): Promise<void> {
    this.#ids.delete(user.userId);
    await this.sandboxes?.removeAll(user.userId);
    await this.containers.remove(user.userId, opts);
  }

  /**
   * The robot's own container (#169): HOME volume plus the human's area on the
   * robot's floor, nothing else. Idempotent; null when sandboxes are off.
   */
  async sandbox(agent: AgentRef, spec: SandboxSpec): Promise<SandboxInfo | null> {
    if (!this.sandboxes) return null;
    // The runner owns the HOME volume the sandbox mounts.
    await this.provision({ userId: agent.userId });
    const area = humanMountTarget(posix.normalize(spec.workdir), this.#floorRoots, agent.userId);
    await mkdir(area, { recursive: true }).catch(() => {});
    const mounts = [toMountSpec(area, this.#volumeMap)];
    return sandboxInfo(await this.sandboxes.ensure(agent.userId, agent.agentId, mounts));
  }

  async listSandboxes(): Promise<SandboxInfo[]> {
    return (await this.sandboxes?.list())?.map(sandboxInfo) ?? [];
  }

  /**
   * Docker cannot add a mount to a running container, so a new floor (area,
   * mounts.ts) means recreating the runner: HOME survives, tmux and every process
   * do not. So only an idle runner is recreated: no tmux sessions, and no piped
   * processes once they had `pipedDrainMs` to finish (e.g. the spawn dialog's
   * login check, #126); otherwise {@link RunnerBusyError}. Mounts that are not
   * this human's areas (pre-#114) go in the same recreate; one change at a time.
   */
  async mountProject(user: RunnerUser, repo: FloorRepoRef): Promise<MountedProject> {
    const workdir = posix.normalize(repo.workdir);
    const target = humanMountTarget(workdir, this.#floorRoots, user.userId);
    await this.#piped.hold(user.userId, async () => {
      const c = await this.containers.ensure(user.userId);
      this.#ids.set(user.userId, c.id);
      // Only the human's own areas count: a stale whole-floor mount covers the path but goes.
      const own = c.floorMounts.filter((m) => isOwnArea(m, this.#floorRoots, user.userId));
      const missing = isCovered(target, own) ? [] : [target];
      await remount(this.#remountDeps, user, c.floorMounts, missing, {
        running: true,
        strict: true,
      });
    });
    return { workdir };
  }

  /**
   * Drop mounts that are not this human's own areas (pre-#114 floor mounts),
   * recreating the runner if it is idle. Returns false when stale mounts
   * remain because the runner is busy (the next `mountProject` refuses it).
   */
  reconcileMounts(user: RunnerUser): Promise<boolean> {
    return this.#piped.hold(user.userId, async () => {
      const c = await this.containers.lookup(user.userId);
      if (!c) return true;
      this.#ids.set(user.userId, c.id);
      return remount(this.#remountDeps, user, c.floorMounts, [], {
        running: c.running,
        strict: false,
      });
    });
  }

  async exec(user: RunnerUser, plan: SpawnPlan): Promise<TmuxSessionRef> {
    const inSandbox: Where = { userId: user.userId, agentId: plan.agentId };
    if (await this.router.sandboxOf(inSandbox)) return this.#newSession(inSandbox, plan);
    await this.provision(user);
    // Counted as a session from here on, so no recreate slips in before tmux has it.
    return this.#piped.session(user.userId, plan.tmuxSession, () =>
      this.#newSession({ userId: user.userId }, plan),
    );
  }

  async #newSession(where: Where, plan: SpawnPlan): Promise<TmuxSessionRef> {
    await this.#writeFiles(where, plan.files);
    const envFile = `${this.home}/.office/run/env-${randomUUID()}`;
    await this.#writeFile(where, {
      path: envFile,
      contents: envFileContents(plan.env.reveal()),
      mode: 0o600,
    });
    const q = shellQuote(envFile);
    // umask 0002: files the agent makes stay group-writable for the office (#150).
    const command = `umask 0002; . ${q}; rm -f ${q}; exec ${plan.argv.map(shellQuote).join(" ")}`;
    const res = await this.router.tmux(where, [
      ...["new-session", "-d", "-s", plan.tmuxSession, "-x", "160", "-y", "45"],
      ...["-c", plan.cwd, command],
    ]);
    if (res.code !== 0) {
      await this.router.run(where, { cmd: ["rm", "-f", "--", envFile] });
      throw new Error(`tmux new-session failed: ${res.stderr.trim()}`);
    }
    return { userId: where.userId, name: plan.tmuxSession };
  }

  /** Counted as live from this call on; waits while a mount change runs (piped-tracker.ts). */
  async spawnPiped(user: RunnerUser, plan: SpawnPlan): Promise<PipedProcess> {
    const inSandbox: Where = { userId: user.userId, agentId: plan.agentId };
    const sandbox = await this.router.sandboxOf(inSandbox);
    if (sandbox) return this.#startPiped(inSandbox, sandbox, plan);
    // Image refresh first: under `track` it would count this process as busy.
    await this.provision(user);
    return this.#piped.track(user.userId, plan.argv, async () => {
      const { containerId } = await this.provision(user, { refresh: false });
      return this.#startPiped({ userId: user.userId }, containerId as string, plan);
    });
  }

  async #startPiped(where: Where, containerId: string, plan: SpawnPlan): Promise<PipedProcess> {
    await this.#writeFiles(where, plan.files);
    return startPiped(this.engine, {
      containerId,
      argv: plan.argv,
      env: Object.entries(plan.env.reveal()).map(([k, v]) => `${k}=${v}`),
      workdir: plan.cwd,
      signal: async (pid, signal) => {
        const cmd = ["kill", "-s", signal.replace(/^SIG/, ""), `${pid}`];
        await this.router.run(where, { cmd }, false);
      },
    });
  }

  /** Removes the robot's sandbox (and everything in it); else kills its runner session. */
  async kill(agent: AgentRef): Promise<void> {
    if (this.sandboxes && (await this.sandboxes.remove(agent.agentId))) return;
    const inRunner = { userId: agent.userId };
    const procs = await this.runnerProcesses(agent);
    await this.router.tmux(inRunner, ["kill-session", "-t", target(sessionOf(agent))], false);
    if (procs.length === 0) return;
    await this.router.run(inRunner, {
      cmd: ["sh", "-c", 'kill -9 "$@" 2>/dev/null; exit 0', "sh", ...procs.map((p) => `${p.pid}`)],
    });
  }

  #handle(userId: string, containerId: string): RunnerHandle {
    return {
      userId,
      backend: this.backend,
      home: this.home,
      tmuxSocket: this.containers.tmuxSocket(userId),
      containerId,
    };
  }

  async #writeFiles(where: Where, files: readonly PlannedFile[]): Promise<void> {
    for (const file of files) await this.#writeFile(where, file);
  }

  /** Write a file as the runner uid: contents on exec stdin (never argv), then a rename. */
  async #writeFile(where: Where, file: PlannedFile): Promise<void> {
    await writeFileExec(this.engine, await this.router.require(where), file);
  }
}
