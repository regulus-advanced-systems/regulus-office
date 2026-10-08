/**
 * A managed Hermes as a container of the docker runner backend (SPEC §8, D18;
 * #57): one `<prefix>-hermes-<agentId>` container per agent, made from the
 * pinned Hermes image (hermes-runner/Dockerfile) with the hardening of a
 * henchman's sandbox (../../../runners/docker/sandboxes.ts): the non-root
 * runner uid, `CapDrop: ALL`, `no-new-privileges`, an init process, memory,
 * CPU and pids limits, no Docker socket, nothing published on the host.
 *
 * Its only mount is its own home volume `<prefix>-hermes-home-<agentId>`,
 * where Hermes keeps its state (sessions, memory, skills), so that survives
 * restarts. It gets no operation directory, no human's HOME volume and no
 * other agent's home: what it does in the office it does through the office
 * tools, with its own token.
 *
 * Keys never reach the container's configuration: the container itself only
 * sleeps, and the gateway is started in it by an exec whose environment
 * belongs to that exec alone (as `spawnPiped` does for henchmen), so `docker
 * inspect` shows no key. The office keeps that exec's stream: its end is how
 * a crash is noticed.
 *
 * Like a sandbox, the container is never healed in place: every start
 * removes what is there and makes a new one on the same home.
 */
import { posix } from "node:path";
import { safeReason } from "../../../agents/manager/failure.ts";
import {
  checkUserId,
  LABEL_PREFIX,
  LABEL_ROLE,
} from "../../../runners/docker/containers.ts";
import { DockerApiError, type EngineClient } from "../../../runners/docker/engine.ts";
import { isImageMissing, pullImage } from "../../../runners/docker/image.ts";
import { startPiped } from "../../../runners/docker/interactive.ts";
import { writeFileExec } from "../../../runners/docker/shell.ts";
import {
  HERMES_API_PORT,
  HERMES_ENV,
  HermesHostError,
  type HermesLaunch,
  type HermesProcess,
  type ManagedHermesHost,
  tailOf,
} from "./host.ts";

export const LABEL_HERMES_AGENT = "org.regulus.office.hermes-agent";
const ROLE = "hermes";

export interface DockerHermesSettings {
  /** The Hermes image (hermes-runner/Dockerfile), e.g. `regulus-office-hermes:0.21.5`. */
  image: string;
  /** The office's container name prefix, as for runners. */
  prefix: string;
  /** Numeric `uid:gid`, never root; the image's `hermes` user. */
  user: string;
  /** HOME in the image; the agent's volume is mounted here. */
  home: string;
  /** The runners network. Absent: the default bridge, reached by the container's address. */
  network?: string;
  memoryBytes: number;
  cpus: number;
  pids: number;
  /** How the gateway is started in the container. */
  command: readonly string[];
  labels?: Record<string, string>;
  /** Pull the image when it is missing (default true). */
  pull?: boolean;
}

export const DEFAULT_HERMES_LIMITS = {
  /** A gateway idles around 300 MB; tools it starts need room. */
  memoryBytes: 2 * 1024 ** 3,
  cpus: 1,
  pids: 512,
} as const;

interface ListRow {
  Id: string;
  Names: string[];
}

export class DockerHermesHost implements ManagedHermesHost {
  readonly #changes = new Map<string, Promise<unknown>>();

  constructor(
    private readonly engine: EngineClient,
    readonly settings: DockerHermesSettings,
  ) {}

  containerName(agentId: string): string {
    return `${this.settings.prefix}-hermes-${checkUserId(agentId)}`;
  }

  volumeName(agentId: string): string {
    return `${this.settings.prefix}-hermes-home-${checkUserId(agentId)}`;
  }

  /** Where Hermes keeps its own state, inside the volume. */
  get hermesHome(): string {
    return posix.join(this.settings.home, ".hermes");
  }

  launch(spec: HermesLaunch): Promise<HermesProcess> {
    return this.#serial(spec.agentId, async () => {
      const name = this.containerName(spec.agentId);
      await this.#remove(name);
      const id = await this.#create(spec.agentId);
      try {
        await this.engine.call("POST", `/containers/${id}/start`);
        for (const file of spec.files) {
          const path = posix.join(this.hermesHome, file.path);
          if (!path.startsWith(`${this.hermesHome}/`)) {
            throw new Error("file outside the Hermes home");
          }
          await writeFileExec(this.engine, id, { path, contents: file.contents, mode: 0o600 });
        }
        const env = {
          ...spec.env,
          [HERMES_ENV.home]: this.hermesHome,
          [HERMES_ENV.host]: "0.0.0.0",
          [HERMES_ENV.port]: `${HERMES_API_PORT}`,
        };
        const piped = await startPiped(this.engine, {
          containerId: id,
          argv: this.settings.command,
          env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
          workdir: this.settings.home,
          signal: async (pid, signal) => {
            const cmd = ["kill", "-s", signal.replace(/^SIG/, ""), `${pid}`];
            await this.engine.exec(id, { cmd });
          },
        });
        const out = tailOf(piped.stdout);
        const err = tailOf(piped.stderr);
        const host = this.settings.network ? name : await this.#address(id);
        let stopped: Promise<void> | undefined;
        return {
          url: `http://${host}:${HERMES_API_PORT}`,
          exited: piped.exited.then(
            (code) => ({ code, tail: err() || out() }),
            // The exec's stream was lost: the gateway may still run, but nobody watches it.
            () => ({ code: null, tail: err() || out() }),
          ),
          stop: () => {
            stopped ??= this.#serial(spec.agentId, async () => {
              await this.#remove(id);
            });
            return stopped;
          },
        };
      } catch (e) {
        await this.#remove(id).catch(() => {});
        throw e;
      }
    });
  }

  forget(agentId: string): Promise<void> {
    return this.#serial(agentId, async () => {
      await this.#remove(this.containerName(agentId));
      try {
        await this.engine.call("DELETE", `/volumes/${this.volumeName(agentId)}`);
      } catch (e) {
        if (!(e instanceof DockerApiError && e.status === 404)) throw e;
      }
    });
  }

  async reap(): Promise<void> {
    const rows = await this.engine.json<ListRow[]>("GET", "/containers/json", {
      query: {
        all: true,
        filters: JSON.stringify({
          label: [`${LABEL_ROLE}=${ROLE}`, `${LABEL_PREFIX}=${this.settings.prefix}`],
        }),
      },
    });
    const mine = `${this.settings.prefix}-hermes-`;
    for (const row of rows) {
      // The label filter is the daemon's word; the name is checked as well before anything is removed.
      if (row.Names.some((n) => n.replace(/^\//, "").startsWith(mine))) await this.#remove(row.Id);
    }
  }

  async #create(agentId: string): Promise<string> {
    const s = this.settings;
    const labels = {
      ...s.labels,
      [LABEL_ROLE]: ROLE,
      [LABEL_PREFIX]: s.prefix,
      [LABEL_HERMES_AGENT]: agentId,
    };
    await this.engine.call("POST", "/volumes/create", {
      json: { Name: this.volumeName(agentId), Labels: labels },
    });
    const body = {
      Image: s.image,
      User: s.user,
      // No key here: the gateway's environment belongs to its exec.
      Env: ["IS_SANDBOX=1", `HOME=${s.home}`, `${HERMES_ENV.home}=${this.hermesHome}`],
      Cmd: ["sleep", "infinity"],
      WorkingDir: s.home,
      Labels: labels,
      HostConfig: {
        Init: true,
        Mounts: [{ Type: "volume", Source: this.volumeName(agentId), Target: s.home }],
        RestartPolicy: { Name: "no" },
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        ...(s.network ? { NetworkMode: s.network } : {}),
        Memory: s.memoryBytes,
        MemorySwap: s.memoryBytes,
        NanoCpus: Math.round(s.cpus * 1e9),
        PidsLimit: s.pids,
      },
    };
    const create = () =>
      this.engine.json<{ Id: string }>("POST", "/containers/create", {
        query: { name: this.containerName(agentId) },
        json: body,
      });
    try {
      return (await create()).Id;
    } catch (e) {
      if (!isImageMissing(e)) throw e;
      const missing = new HermesHostError(
        `the Hermes image ${s.image} is not on the Docker host: the office operator has to build or pull it (see README, "Hermes run by the office")`,
      );
      if (s.pull === false) throw missing;
      try {
        await pullImage(this.engine, s.image);
      } catch {
        throw missing;
      }
      return (await create()).Id;
    }
  }

  async #address(id: string): Promise<string> {
    const info = await this.engine.json<{ NetworkSettings?: { IPAddress?: string } }>(
      "GET",
      `/containers/${id}/json`,
    );
    const address = info.NetworkSettings?.IPAddress;
    if (!address) throw new Error("the Hermes container has no address");
    return address;
  }

  /** Force-remove a container by id or name; false when it was already gone. */
  async #remove(ref: string): Promise<boolean> {
    try {
      await this.engine.call("DELETE", `/containers/${ref}`, { query: { force: true } });
      return true;
    } catch (e) {
      if (e instanceof DockerApiError && e.status === 404) return false;
      throw new Error(`removing a Hermes container failed: ${safeReason((e as Error).message)}`);
    }
  }

  /** One change at a time per agent (a restart and a concurrent stop). */
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
