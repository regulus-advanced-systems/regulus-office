/**
 * Per-agent sandbox containers for the docker backend (SPEC §8, D18, #169).
 *
 * Every coding henchman runs in its own `<prefix>-sbx-<agentId>` container, made
 * from the runner image with the same hardening as the human's runner
 * (containers.ts): the same non-root uid, `CapDrop: ALL`, `no-new-privileges`,
 * an init process, no Docker socket. What it shares with the runner is the
 * human's HOME volume (so CLI logins work) and nothing else: its only other
 * mount is the human's own area on the henchman's operation (#114/#122).
 *
 * Of its own it has: a network namespace on the runners network (the office
 * reaches its ports by container name, nothing is published on the host), a
 * pid namespace (it cannot see the runner's or another henchman's processes),
 * its own tmux server on its own tmpfs, memory/CPU/pids limits, and a port
 * range (`PORT`, ../sandbox.ts), recorded in a label so it survives office
 * restarts.
 *
 * A sandbox holds no state worth keeping (HOME and the worktree live in the
 * volume and the area), so it is never restarted or healed in place: one that
 * is not running is removed and made again, and `RestartPolicy` is `no`, so
 * after a daemon restart a sandbox stays down until the office reaps it.
 */
import { safeReason } from "../../agents/manager/failure.ts";
import {
  formatPorts,
  type PortRange,
  parsePorts,
  pickSlot,
  portRange,
  type SandboxSettings,
  sandboxEnv,
  slotOf,
} from "../sandbox.ts";
import {
  checkUserId,
  LABEL_PREFIX,
  LABEL_ROLE,
  LABEL_USER,
  type RunnerContainers,
  TMUX_DIR,
} from "./containers.ts";
import { DockerApiError, type EngineClient } from "./engine.ts";
import { classifyStartFailure, type RunnerLog } from "./heal.ts";
import { isImageMissing, pullImage, RunnerImageMissingError } from "./image.ts";
import { isCovered, type MountSpec } from "./mounts.ts";

export const LABEL_AGENT = "org.regulus.office.agent";
export const LABEL_PORTS = "org.regulus.office.ports";

export interface DockerSandbox {
  agentId: string;
  userId: string;
  /** Container id. */
  id: string;
  running: boolean;
  ports: PortRange;
  /** Container name: its DNS name on the runners network. */
  host: string;
  /** Mounts besides HOME (the human's area on the henchman's operation). */
  areaMounts: MountSpec[];
  createdAt?: number;
}

interface InspectResult {
  Id: string;
  Created?: string;
  State: { Running: boolean };
  Config: { Labels: Record<string, string> | null };
  HostConfig: { Mounts?: MountSpec[] | null };
}

interface ListRow {
  Id: string;
  Names: string[];
  Labels: Record<string, string>;
  State: string;
  Created?: number;
}

export class DockerSandboxes {
  /** Sandboxes by agent id; loaded from the daemon once, then kept in step. */
  readonly #routes = new Map<string, DockerSandbox>();
  #loaded: Promise<void> | undefined;
  readonly #changes = new Map<string, Promise<unknown>>();

  constructor(
    private readonly engine: EngineClient,
    private readonly containers: RunnerContainers,
    readonly settings: SandboxSettings,
    private readonly log?: RunnerLog,
  ) {}

  name(agentId: string): string {
    return `${this.containers.settings.prefix}-sbx-${checkUserId(agentId)}`;
  }

  /** The agent's sandbox, if it has one (containers of this office only). */
  async route(agentId: string): Promise<DockerSandbox | undefined> {
    await this.#load();
    return this.#routes.get(agentId);
  }

  /** Forget a sandbox whose container vanished or stopped (execs answered 404/409). */
  forget(agentId: string, id: string): void {
    if (this.#routes.get(agentId)?.id === id) this.#routes.delete(agentId);
  }

  /** Sandboxes of this office as the daemon lists them now; refreshes the routes. */
  async list(): Promise<DockerSandbox[]> {
    const rows = await this.engine.json<ListRow[]>("GET", "/containers/json", {
      query: {
        all: true,
        filters: JSON.stringify({
          label: [`${LABEL_ROLE}=sandbox`, `${LABEL_PREFIX}=${this.containers.settings.prefix}`],
        }),
      },
    });
    const found: DockerSandbox[] = [];
    for (const row of rows) {
      const agentId = row.Labels[LABEL_AGENT];
      const userId = row.Labels[LABEL_USER];
      const ports = parsePorts(row.Labels[LABEL_PORTS]);
      if (!agentId || !userId || !ports) continue;
      const name = row.Names[0]?.replace(/^\//, "") ?? "";
      if (name !== this.name(agentId)) continue;
      found.push({
        agentId,
        userId,
        id: row.Id,
        running: row.State === "running",
        ports,
        host: name,
        areaMounts: [],
        createdAt: row.Created === undefined ? undefined : row.Created * 1000,
      });
    }
    return found;
  }

  /** The user's sandboxes (from the routes). */
  async of(userId: string): Promise<DockerSandbox[]> {
    await this.#load();
    return [...this.#routes.values()].filter((s) => s.userId === userId);
  }

  /**
   * The agent's running sandbox with `areaMounts`, made if needed. A sandbox that
   * is not running, or lacks a mount, is replaced: it has nothing worth keeping.
   */
  ensure(userId: string, agentId: string, areaMounts: MountSpec[]): Promise<DockerSandbox> {
    return this.#serial(agentId, async () => {
      await this.#load();
      const found = await this.#lookup(agentId);
      if (found && found.userId !== userId) {
        throw new Error(`sandbox ${this.name(agentId)} belongs to another human`);
      }
      const covered = (s: DockerSandbox) =>
        areaMounts.every((m) => isCovered(m.Target, s.areaMounts));
      if (found?.running && covered(found)) {
        this.#routes.set(agentId, found);
        return found;
      }
      if (found) await this.#remove(found.id);
      this.#routes.delete(agentId);
      const created = await this.#createAndStart(userId, agentId, areaMounts);
      this.#routes.set(agentId, created);
      return created;
    });
  }

  /** Remove the agent's sandbox (kills everything in it). True when there was one. */
  remove(agentId: string): Promise<boolean> {
    return this.#serial(agentId, async () => {
      await this.#load();
      const known = this.#routes.get(agentId);
      this.#routes.delete(agentId);
      return this.#remove(known?.id ?? this.name(agentId));
    });
  }

  /** Remove every sandbox of a human (deprovision). */
  async removeAll(userId: string): Promise<void> {
    for (const s of await this.list()) if (s.userId === userId) await this.remove(s.agentId);
  }

  #load(): Promise<void> {
    this.#loaded ??= this.list().then(
      (all) => {
        for (const s of all) if (!this.#routes.has(s.agentId)) this.#routes.set(s.agentId, s);
      },
      (err) => {
        this.#loaded = undefined;
        throw err;
      },
    );
    return this.#loaded;
  }

  async #lookup(agentId: string): Promise<DockerSandbox | null> {
    let info: InspectResult;
    try {
      info = await this.engine.json<InspectResult>("GET", `/containers/${this.name(agentId)}/json`);
    } catch (e) {
      if (e instanceof DockerApiError && e.status === 404) return null;
      throw e;
    }
    const labels = info.Config.Labels ?? {};
    const ports = parsePorts(labels[LABEL_PORTS]);
    if (labels[LABEL_ROLE] !== "sandbox" || labels[LABEL_AGENT] !== agentId || !ports) {
      throw new Error(`container ${this.name(agentId)} exists but is not an office sandbox`);
    }
    const home = this.containers.settings.home;
    return {
      agentId,
      userId: labels[LABEL_USER] ?? "",
      id: info.Id,
      running: info.State.Running,
      ports,
      host: this.name(agentId),
      areaMounts: (info.HostConfig.Mounts ?? []).filter((m) => m.Target !== home),
      createdAt: info.Created ? Date.parse(info.Created) : undefined,
    };
  }

  async #createAndStart(
    userId: string,
    agentId: string,
    areaMounts: MountSpec[],
  ): Promise<DockerSandbox> {
    const taken = new Set<number>();
    for (const s of await this.list()) {
      const slot = slotOf(s.ports, this.settings);
      if (slot !== null && s.agentId !== agentId) taken.add(slot);
    }
    const ports = portRange(pickSlot(agentId, taken, this.settings), this.settings);
    for (let attempt = 0; ; attempt++) {
      const id = await this.#create(userId, agentId, areaMounts, ports);
      try {
        await this.engine.call("POST", `/containers/${id}/start`);
      } catch (e) {
        await this.#remove(id).catch(() => {});
        // A broken layer or image (#151) gets one fresh container; anything else is reported.
        if (attempt > 0 || classifyStartFailure(e) === "other") throw e;
        this.log?.warn(
          { agentId, reason: safeReason((e as Error).message) },
          "sandbox container did not start; creating it again",
        );
        continue;
      }
      const host = this.name(agentId);
      return { agentId, userId, id, running: true, ports, host, areaMounts, createdAt: Date.now() };
    }
  }

  async #create(
    userId: string,
    agentId: string,
    areaMounts: MountSpec[],
    ports: PortRange,
  ): Promise<string> {
    const r = this.containers.settings;
    const s = this.settings;
    const [uid, gid] = r.user.split(":");
    const labels = {
      ...r.labels,
      [LABEL_ROLE]: "sandbox",
      [LABEL_PREFIX]: r.prefix,
      [LABEL_USER]: userId,
      [LABEL_AGENT]: agentId,
      [LABEL_PORTS]: formatPorts(ports),
    };
    const env = Object.entries(sandboxEnv(ports)).map(([k, v]) => `${k}=${v}`);
    const body = {
      Image: r.image,
      User: r.user,
      Env: ["IS_SANDBOX=1", `HOME=${r.home}`, ...env],
      Cmd: ["sleep", "infinity"],
      WorkingDir: r.home,
      Labels: labels,
      HostConfig: {
        Init: true,
        Mounts: [
          { Type: "volume", Source: this.containers.volumeName(userId), Target: r.home },
          ...areaMounts,
        ],
        Tmpfs: { [TMUX_DIR]: `rw,nosuid,nodev,noexec,mode=0700,uid=${uid},gid=${gid}` },
        RestartPolicy: { Name: "no" },
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        ...(r.network ? { NetworkMode: r.network } : {}),
        Memory: s.memoryBytes,
        // No swap beyond the memory limit: a runaway henchman is OOM-killed, not the host.
        MemorySwap: s.memoryBytes,
        NanoCpus: Math.round(s.cpus * 1e9),
        PidsLimit: s.pids,
      },
    };
    const create = () =>
      this.engine.json<{ Id: string }>("POST", "/containers/create", {
        query: { name: this.name(agentId) },
        json: body,
      });
    try {
      return (await create()).Id;
    } catch (e) {
      if (!isImageMissing(e)) throw e;
      if (r.pull === false) throw new RunnerImageMissingError(r.image, (e as Error).message);
      await pullImage(this.engine, r.image);
      return (await create()).Id;
    }
  }

  /** Force-remove a container by id or name; false when it was already gone. */
  async #remove(ref: string): Promise<boolean> {
    try {
      await this.engine.call("DELETE", `/containers/${ref}`, { query: { force: true } });
      return true;
    } catch (e) {
      if (e instanceof DockerApiError && e.status === 404) return false;
      throw e;
    }
  }

  /** One change at a time per agent (a spawn's sandbox and a concurrent kill). */
  #serial<T>(agentId: string, work: () => Promise<T>): Promise<T> {
    const run = (this.#changes.get(agentId) ?? Promise.resolve()).catch(() => {}).then(work);
    this.#changes.set(agentId, run);
    const release = () => {
      if (this.#changes.get(agentId) === run) this.#changes.delete(agentId);
    };
    run.then(release, release);
    return run;
  }
}
