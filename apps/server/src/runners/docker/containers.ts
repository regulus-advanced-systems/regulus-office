/**
 * Runner container lifecycle over the Engine API (SPEC §8 docker backend):
 * one long-lived `<prefix>-runner-<userId>` container per human, its HOME on
 * the named volume `<prefix>-home-<userId>`, tmux sockets on a tmpfs at
 * `/run/office/tmux` (SPEC §4.4), labelled so the office can find its runners
 * again after a restart.
 *
 * Hardening: non-root uid (config refuses uid 0), `IS_SANDBOX=1`, all
 * capabilities dropped, `no-new-privileges`, an init process to reap orphans,
 * optional memory/CPU/pids limits. The Docker socket is never mounted: the only
 * mounts are the HOME volume, the tmpfs and floor directories.
 */
import { DockerApiError, type EngineClient } from "./engine.ts";
import type { MountSpec } from "./mounts.ts";

export const TMUX_DIR = "/run/office/tmux";
export const LABEL_ROLE = "org.regulus.office.role";
export const LABEL_PREFIX = "org.regulus.office.prefix";
export const LABEL_USER = "org.regulus.office.user";

export interface ContainerSettings {
  image: string;
  /** Name prefix, e.g. `office` → `office-runner-<id>`, `office-home-<id>`. */
  prefix: string;
  /** Numeric `uid:gid`, never root. */
  user: string;
  home: string;
  network?: string;
  memoryBytes?: number;
  nanoCpus?: number;
  pidsLimit?: number;
  /** Extra labels on containers and volumes (tests use `regulus-test=1`). */
  labels?: Record<string, string>;
  /** Pull the image when it is missing (default true). */
  pull?: boolean;
}

export interface RunnerContainer {
  userId: string;
  id: string;
  running: boolean;
  /** Floor mounts (everything in `HostConfig.Mounts` except HOME). */
  floorMounts: MountSpec[];
}

interface InspectResult {
  Id: string;
  State: { Running: boolean };
  Config: { Labels: Record<string, string> | null };
  HostConfig: { Mounts?: MountSpec[] | null };
}

const USER_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;

export function checkUserId(userId: string): string {
  if (!USER_ID.test(userId)) throw new Error(`user id not usable in container names: ${userId}`);
  return userId;
}

export class RunnerContainers {
  constructor(
    private readonly engine: EngineClient,
    readonly settings: ContainerSettings,
  ) {}

  containerName(userId: string): string {
    return `${this.settings.prefix}-runner-${checkUserId(userId)}`;
  }

  volumeName(userId: string): string {
    return `${this.settings.prefix}-home-${checkUserId(userId)}`;
  }

  tmuxSocket(userId: string): string {
    return `${TMUX_DIR}/${checkUserId(userId)}.sock`;
  }

  /** The human's runner container, or null. Refuses same-named containers it does not own. */
  async lookup(userId: string): Promise<RunnerContainer | null> {
    let info: InspectResult;
    try {
      info = await this.engine.json<InspectResult>(
        "GET",
        `/containers/${this.containerName(userId)}/json`,
      );
    } catch (e) {
      if (e instanceof DockerApiError && e.status === 404) return null;
      throw e;
    }
    const labels = info.Config.Labels ?? {};
    if (labels[LABEL_ROLE] !== "runner" || labels[LABEL_USER] !== userId) {
      throw new Error(`container ${this.containerName(userId)} exists but is not an office runner`);
    }
    return {
      userId,
      id: info.Id,
      running: info.State.Running,
      floorMounts: (info.HostConfig.Mounts ?? []).filter((m) => m.Target !== this.settings.home),
    };
  }

  /** Create (if absent) and start the human's runner container. Idempotent. */
  async ensure(userId: string): Promise<RunnerContainer> {
    const found = await this.lookup(userId);
    if (found) return found.running ? found : this.#start(found);
    try {
      return await this.#start(await this.#create(userId, []));
    } catch (e) {
      // Lost a creation race with another caller: use theirs.
      if (e instanceof DockerApiError && e.status === 409) {
        const other = await this.lookup(userId);
        if (other) return other.running ? other : this.#start(other);
      }
      throw e;
    }
  }

  /**
   * Replace the container with one that has `floorMounts`. HOME survives (named
   * volume); anything running in the old container, tmux included, does not, so
   * callers only do this when the runner is idle.
   */
  async recreate(userId: string, floorMounts: MountSpec[]): Promise<RunnerContainer> {
    const found = await this.lookup(userId);
    if (found) await this.#remove(found.id);
    return this.#start(await this.#create(userId, floorMounts));
  }

  /** Runner containers created with this prefix (for recovery after an office restart). */
  async list(): Promise<RunnerContainer[]> {
    const rows = await this.engine.json<{ Names: string[]; Labels: Record<string, string> }[]>(
      "GET",
      "/containers/json",
      {
        query: {
          all: true,
          filters: JSON.stringify({
            label: [`${LABEL_ROLE}=runner`, `${LABEL_PREFIX}=${this.settings.prefix}`],
          }),
        },
      },
    );
    const found: RunnerContainer[] = [];
    for (const row of rows) {
      const userId = row.Labels[LABEL_USER];
      if (!userId || !USER_ID.test(userId)) continue;
      const container = await this.lookup(userId);
      if (container) found.push(container.running ? container : await this.#start(container));
    }
    return found;
  }

  /** Remove the container and, with `removeHome`, the credential volume too. */
  async remove(userId: string, opts: { removeHome?: boolean } = {}): Promise<void> {
    const found = await this.lookup(userId);
    if (found) await this.#remove(found.id);
    if (opts.removeHome) {
      try {
        await this.engine.call("DELETE", `/volumes/${this.volumeName(userId)}`);
      } catch (e) {
        if (!(e instanceof DockerApiError && e.status === 404)) throw e;
      }
    }
  }

  labels(userId: string): Record<string, string> {
    return {
      ...this.settings.labels,
      [LABEL_ROLE]: "runner",
      [LABEL_PREFIX]: this.settings.prefix,
      [LABEL_USER]: userId,
    };
  }

  async #create(userId: string, floorMounts: MountSpec[]): Promise<RunnerContainer> {
    const s = this.settings;
    const labels = this.labels(userId);
    const volume = this.volumeName(userId);
    await this.engine.call("POST", "/volumes/create", { json: { Name: volume, Labels: labels } });
    const [uid, gid] = s.user.split(":");
    const body = {
      Image: s.image,
      User: s.user,
      Env: ["IS_SANDBOX=1", `HOME=${s.home}`],
      Cmd: ["sleep", "infinity"],
      WorkingDir: s.home,
      Labels: labels,
      HostConfig: {
        Init: true,
        Mounts: [{ Type: "volume", Source: volume, Target: s.home }, ...floorMounts],
        Tmpfs: { [TMUX_DIR]: `rw,nosuid,nodev,noexec,mode=0700,uid=${uid},gid=${gid}` },
        RestartPolicy: { Name: "unless-stopped" },
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        ...(s.network ? { NetworkMode: s.network } : {}),
        ...(s.memoryBytes ? { Memory: s.memoryBytes } : {}),
        ...(s.nanoCpus ? { NanoCpus: s.nanoCpus } : {}),
        ...(s.pidsLimit ? { PidsLimit: s.pidsLimit } : {}),
      },
    };
    const create = () =>
      this.engine.json<{ Id: string }>("POST", "/containers/create", {
        query: { name: this.containerName(userId) },
        json: body,
      });
    let created: { Id: string };
    try {
      created = await create();
    } catch (e) {
      if (!(e instanceof DockerApiError && e.status === 404 && s.pull !== false)) throw e;
      await this.#pull(s.image);
      created = await create();
    }
    return { userId, id: created.Id, running: false, floorMounts };
  }

  async #start(container: RunnerContainer): Promise<RunnerContainer> {
    try {
      await this.engine.call("POST", `/containers/${container.id}/start`);
    } catch (e) {
      // 304: already running.
      if (!(e instanceof DockerApiError && e.status === 304)) throw e;
    }
    return { ...container, running: true };
  }

  async #remove(id: string): Promise<void> {
    try {
      await this.engine.call("DELETE", `/containers/${id}`, { query: { force: true } });
    } catch (e) {
      if (!(e instanceof DockerApiError && e.status === 404)) throw e;
    }
  }

  async #pull(image: string): Promise<void> {
    const res = await this.engine.request("POST", "/images/create", {
      query: { fromImage: image },
    });
    const text = await res.text();
    const failure = text
      .split("\n")
      .map((line) => {
        try {
          return (JSON.parse(line) as { error?: string }).error;
        } catch {
          return undefined;
        }
      })
      .find(Boolean);
    if (!res.ok || failure) {
      throw new DockerApiError(res.status, `pull ${image} failed: ${failure ?? res.status}`);
    }
  }
}
