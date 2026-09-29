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
 */
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { posix } from "node:path";
import {
  type PipedProcess,
  type PlannedFile,
  type SpawnPlan,
  tmuxSessionName,
} from "@regulus/agent-adapters";
import type { TerminalMode } from "@regulus/protocol";
import { PASTE_SCRIPT, pasteBufferName, pasteMode } from "../keys.ts";
import type {
  AgentRef,
  AttachStream,
  FloorRepoRef,
  MountedProject,
  PortInfo,
  ProcessInfo,
  Runner,
  RunnerHandle,
  RunnerUser,
  TmuxSessionRef,
} from "../types.ts";
import { type ContainerSettings, RunnerContainers } from "./containers.ts";
import { DockerApiError, EngineClient, type ExecOptions, type ExecResult } from "./engine.ts";
import { openTty, startPiped } from "./interactive.ts";
import {
  DEFAULT_FLOOR_ROOTS,
  humanMountTarget,
  isCovered,
  isOwnArea,
  type MountSpec,
  RunnerBusyError,
  toMountSpec,
  type VolumeMapping,
} from "./mounts.ts";
import { PipedTracker } from "./piped-tracker.ts";
import { PORT_SCRIPT, PROCESS_SCRIPT, parsePortOutput, parseProcessOutput } from "./procfs.ts";
import { envFileContents, shellQuote, WRITE_SCRIPT } from "./shell.ts";

export interface DockerRunnerOptions extends ContainerSettings {
  /** Defaults to a client for `DOCKER_HOST` / the local socket. */
  engine?: EngineClient;
  /** Roots whose `<root>/<floor>/<runner id>` dirs are mounted as a unit (see mounts.ts). */
  floorRoots?: readonly string[];
  volumeMap?: readonly VolumeMapping[];
  /** How long a recreate waits for piped side processes to finish (default 5 s). */
  pipedDrainMs?: number;
}

export { DEFAULT_FLOOR_ROOTS, RunnerBusyError } from "./mounts.ts";
export { envFileContents, shellQuote } from "./shell.ts";

const target = (s: TmuxSessionRef) => `=${s.name}`;
const paneTarget = (s: TmuxSessionRef) => `=${s.name}:`;
const sessionOf = (a: AgentRef): TmuxSessionRef => ({
  userId: a.userId,
  name: tmuxSessionName(a.agentId),
});

export class DockerRunner implements Runner {
  readonly backend = "docker" as const;
  readonly engine: EngineClient;
  readonly containers: RunnerContainers;
  readonly #floorRoots: readonly string[];
  readonly #volumeMap: readonly VolumeMapping[];
  readonly #ids = new Map<string, string>();
  readonly #piped: PipedTracker;

  constructor(opts: DockerRunnerOptions) {
    const [uid, gid] = opts.user.split(":").map(Number);
    if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid === 0) {
      throw new Error(`docker runner user must be a numeric non-root uid:gid, got ${opts.user}`);
    }
    this.engine = opts.engine ?? new EngineClient();
    this.containers = new RunnerContainers(this.engine, opts);
    this.#floorRoots = opts.floorRoots ?? DEFAULT_FLOOR_ROOTS;
    this.#volumeMap = opts.volumeMap ?? [];
    this.#piped = new PipedTracker(opts.pipedDrainMs);
  }

  get home(): string {
    return this.containers.settings.home;
  }

  async provision(user: RunnerUser): Promise<RunnerHandle> {
    const c = await this.containers.ensure(user.userId);
    this.#ids.set(user.userId, c.id);
    return this.#handle(user.userId, c.id);
  }

  /** Re-adopt runner containers after an office restart (starting stopped ones). */
  async recover(): Promise<RunnerHandle[]> {
    const found = await this.containers.list();
    for (const c of found) this.#ids.set(c.userId, c.id);
    return found.map((c) => this.#handle(c.userId, c.id));
  }

  /** Remove the human's runner container and, with `removeHome`, their credentials volume. */
  async deprovision(user: RunnerUser, opts: { removeHome?: boolean } = {}): Promise<void> {
    this.#ids.delete(user.userId);
    await this.containers.remove(user.userId, opts);
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
      await this.#remount(user, c.floorMounts, missing, { running: true, strict: true });
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
      return this.#remount(user, c.floorMounts, [], { running: c.running, strict: false });
    });
  }

  async #remount(
    user: RunnerUser,
    current: readonly MountSpec[],
    missing: readonly string[],
    /** `running`: false for a stopped container (nothing runs in it). `strict`: throw when busy. */
    opts: { running: boolean; strict: boolean },
  ): Promise<boolean> {
    const keep = current.filter((m) => isOwnArea(m, this.#floorRoots, user.userId));
    const stale = current.filter((m) => !keep.includes(m)).map((m) => m.Target);
    if (missing.length === 0 && stale.length === 0) return true;

    const list = () => (opts.running ? this.listSessions(user) : Promise.resolve([]));
    const { sessions, piped } = await this.#piped.busy(user.userId, list, opts.strict);
    if (sessions.length > 0 || piped.length > 0) {
      if (!opts.strict) return false;
      const changes = [...missing, ...stale.map((t) => `-${t}`)];
      throw new RunnerBusyError(user.userId, sessions, changes, piped);
    }
    // Mount sources must exist: create them as the office sees them (bind or volume subpath).
    for (const dir of missing) await mkdir(dir, { recursive: true }).catch(() => {});
    const mounts = [...keep, ...missing.map((t) => toMountSpec(t, this.#volumeMap))];
    const next = await this.containers.recreate(user.userId, mounts);
    this.#ids.set(user.userId, next.id);
    return true;
  }

  async exec(user: RunnerUser, plan: SpawnPlan): Promise<TmuxSessionRef> {
    await this.provision(user);
    await this.#writeFiles(user.userId, plan.files);
    const envFile = `${this.home}/.office/run/env-${randomUUID()}`;
    await this.#writeFile(user.userId, {
      path: envFile,
      contents: envFileContents(plan.env.reveal()),
      mode: 0o600,
    });
    const q = shellQuote(envFile);
    const command = `. ${q}; rm -f ${q}; exec ${plan.argv.map(shellQuote).join(" ")}`;
    const res = await this.#tmux(user.userId, [
      ...["new-session", "-d", "-s", plan.tmuxSession, "-x", "160", "-y", "45"],
      ...["-c", plan.cwd, command],
    ]);
    if (res.code !== 0) {
      await this.#run(user.userId, { cmd: ["rm", "-f", "--", envFile] });
      throw new Error(`tmux new-session failed: ${res.stderr.trim()}`);
    }
    return { userId: user.userId, name: plan.tmuxSession };
  }

  /** Counted as live from this call on; waits while a mount change runs (piped-tracker.ts). */
  spawnPiped(user: RunnerUser, plan: SpawnPlan): Promise<PipedProcess> {
    return this.#piped.track(user.userId, plan.argv, async () => {
      const { containerId } = await this.provision(user);
      await this.#writeFiles(user.userId, plan.files);
      return startPiped(this.engine, {
        containerId: containerId as string,
        argv: plan.argv,
        env: Object.entries(plan.env.reveal()).map(([k, v]) => `${k}=${v}`),
        workdir: plan.cwd,
        signal: async (pid, signal) => {
          const cmd = ["kill", "-s", signal.replace(/^SIG/, ""), `${pid}`];
          await this.#run(user.userId, { cmd });
        },
      });
    });
  }

  attach(session: TmuxSessionRef, mode: TerminalMode): AttachStream {
    const readOnly = mode === "watch" ? ["-r"] : [];
    const argv = [
      ...["tmux", "-S", this.containers.tmuxSocket(session.userId), "attach-session"],
      ...[...readOnly, "-t", target(session)],
    ];
    return {
      kind: "stream",
      open: async (size) => {
        const id = await this.#require(session.userId);
        return openTty(this.engine, { containerId: id, argv, size });
      },
    };
  }

  async capturePane(session: TmuxSessionRef, lines: number): Promise<string> {
    const res = await this.#tmuxOn(session, [
      ...["capture-pane", "-p", "-J", "-t", paneTarget(session), "-S", `-${lines}`],
    ]);
    if (res.code !== 0) throw new Error(`capture-pane failed: ${res.stderr.trim()}`);
    return res.stdout;
  }

  async paneTitle(session: TmuxSessionRef): Promise<string> {
    const res = await this.#tmuxOn(session, [
      ...["display-message", "-p", "-t", paneTarget(session), "#{pane_title}"],
    ]);
    return res.code === 0 ? res.stdout.trim() : "";
  }

  /** Buffer paste in one exec, input on its stdin; works while a watcher is attached (keys.ts). */
  async sendKeys(session: TmuxSessionRef, keys: string, opts?: { enter?: boolean }): Promise<void> {
    if (keys.length === 0 && !opts?.enter) return;
    const bytes = new TextEncoder().encode(keys);
    const socket = this.containers.tmuxSocket(session.userId);
    const args = [socket, pasteBufferName(), paneTarget(session), `${bytes.byteLength}`];
    const cmd = ["sh", "-c", PASTE_SCRIPT, "sh", ...args, pasteMode(keys), opts?.enter ? "1" : "0"];
    const res = await this.engine.execWithInput(
      await this.#require(session.userId),
      { cmd },
      bytes,
    );
    if (res.code !== 0) throw new Error(`paste into ${session.name} failed: ${res.stderr.trim()}`);
  }

  async sessionExists(session: TmuxSessionRef): Promise<boolean> {
    const res = await this.#tmux(session.userId, ["has-session", "-t", target(session)], false);
    return res?.code === 0;
  }

  async listSessions(user: RunnerUser): Promise<string[]> {
    const res = await this.#tmux(user.userId, ["list-sessions", "-F", "#{session_name}"], false);
    return res?.code === 0 ? res.stdout.split("\n").filter(Boolean) : [];
  }

  async listProcesses(agent: AgentRef): Promise<ProcessInfo[]> {
    const socket = this.containers.tmuxSocket(agent.userId);
    const res = await this.#run(
      agent.userId,
      { cmd: ["sh", "-c", PROCESS_SCRIPT, "sh", socket, paneTarget(sessionOf(agent))] },
      false,
    );
    return res?.code === 0 ? parseProcessOutput(res.stdout) : [];
  }

  async listPorts(agent: AgentRef): Promise<PortInfo[]> {
    const pids = (await this.listProcesses(agent)).map((p) => `${p.pid}`);
    if (pids.length === 0) return [];
    const res = await this.#run(agent.userId, { cmd: ["sh", "-c", PORT_SCRIPT, "sh", ...pids] });
    return res.code === 0 ? parsePortOutput(res.stdout) : [];
  }

  async kill(agent: AgentRef): Promise<void> {
    const procs = await this.listProcesses(agent);
    await this.#tmux(agent.userId, ["kill-session", "-t", target(sessionOf(agent))], false);
    if (procs.length === 0) return;
    await this.#run(agent.userId, {
      cmd: ["sh", "-c", 'kill -9 "$@" 2>/dev/null; exit 0', "sh", ...procs.map((p) => `${p.pid}`)],
    });
  }

  async readTextFile(user: RunnerUser, path: string): Promise<string | null> {
    const res = await this.#run(
      user.userId,
      { cmd: ["sh", "-c", '[ -f "$1" ] || exit 44; exec cat -- "$1"', "sh", path] },
      false,
    );
    if (!res || res.code === 44) return null;
    if (res.code !== 0) throw new Error(`read ${path} failed: ${res.stderr.trim()}`);
    return res.stdout;
  }

  async listDir(user: RunnerUser, path: string): Promise<string[]> {
    const res = await this.#run(user.userId, { cmd: ["ls", "-A1", "--", path] }, false);
    return res?.code === 0 ? res.stdout.split("\n").filter(Boolean).sort() : [];
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

  /** Container id for a human: cached, else looked up (and created when `create`). */
  async #resolve(userId: string, create: boolean): Promise<string | null> {
    const cached = this.#ids.get(userId);
    if (cached) return cached;
    const c = create
      ? await this.containers.ensure(userId)
      : await this.containers
          .lookup(userId)
          .then((found) => (found && !found.running ? this.containers.ensure(userId) : found));
    if (c) this.#ids.set(userId, c.id);
    return c?.id ?? null;
  }

  async #require(userId: string): Promise<string> {
    const id = await this.#resolve(userId, false);
    if (!id) throw new Error(`no runner container for user ${userId}`);
    return id;
  }

  /** Exec in the human's runner; retries once if the cached container vanished or stopped. */
  #run(userId: string, opts: ExecOptions): Promise<ExecResult>;
  #run(userId: string, opts: ExecOptions, create: false): Promise<ExecResult | null>;
  async #run(userId: string, opts: ExecOptions, create = true): Promise<ExecResult | null> {
    for (let attempt = 0; ; attempt++) {
      const id = await this.#resolve(userId, create);
      if (!id) {
        if (create) throw new Error(`no runner container for user ${userId}`);
        return null;
      }
      try {
        return await this.engine.exec(id, opts);
      } catch (e) {
        const stale = e instanceof DockerApiError && (e.status === 404 || e.status === 409);
        if (!stale || attempt > 0) throw e;
        this.#ids.delete(userId);
      }
    }
  }

  #tmux(userId: string, args: string[]): Promise<ExecResult>;
  #tmux(userId: string, args: string[], create: false): Promise<ExecResult | null>;
  #tmux(userId: string, args: string[], create = true): Promise<ExecResult | null> {
    const cmd = ["tmux", "-S", this.containers.tmuxSocket(userId), ...args];
    return create ? this.#run(userId, { cmd }) : this.#run(userId, { cmd }, false);
  }

  /** tmux against an existing runner; a missing runner is an error. */
  async #tmuxOn(session: TmuxSessionRef, args: string[]): Promise<ExecResult> {
    const res = await this.#tmux(session.userId, args, false);
    if (!res) throw new Error(`no runner container for user ${session.userId}`);
    return res;
  }

  async #writeFiles(userId: string, files: readonly PlannedFile[]): Promise<void> {
    for (const file of files) await this.#writeFile(userId, file);
  }

  /** Write a file as the runner uid: contents on exec stdin (never argv), then a rename. */
  async #writeFile(userId: string, file: PlannedFile): Promise<void> {
    const path = posix.normalize(file.path);
    if (!posix.isAbsolute(path)) throw new Error(`runner file path must be absolute: ${path}`);
    const contents = typeof file.contents === "string" ? file.contents : file.contents.reveal();
    const bytes = new TextEncoder().encode(contents);
    const mode = ((file.mode ?? 0o600) & 0o7777).toString(8);
    const id = await this.#require(userId);
    const res = await this.engine.execWithInput(
      id,
      { cmd: ["sh", "-c", WRITE_SCRIPT, "sh", path, `${bytes.byteLength}`, mode] },
      bytes,
    );
    if (res.code !== 0) throw new Error(`write ${path} failed: ${res.stderr.trim()}`);
  }
}
