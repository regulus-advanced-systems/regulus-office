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
import { safeReason } from "../../agents/manager/failure.ts";
import { DockerApiError, type EngineClient } from "./engine.ts";
import { classifyStartFailure, isInspectBroken, type RunnerLog } from "./heal.ts";
import { ImageIds, isImageMissing, pullImage, RunnerImageMissingError } from "./image.ts";
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
  /** How long the image tag's id is trusted before a drift check asks again (default 10 s). */
  imageIdTtlMs?: number;
}

export interface RunnerContainer {
  userId: string;
  id: string;
  running: boolean;
  /** Floor mounts (everything in `HostConfig.Mounts` except HOME). */
  floorMounts: MountSpec[];
  /** Docker's state: `running`, `exited`, `created`, `dead`, … (unknown for fresh ones). */
  status?: string;
  /** Id of the image the container was created from. */
  imageId?: string;
}

interface InspectResult {
  Id: string;
  Image?: string;
  State: { Running: boolean; Status?: string };
  Config: { Labels: Record<string, string> | null };
  HostConfig: { Mounts?: MountSpec[] | null };
}

/** How long `ensure` waits for a container someone else is creating to show up. */
const CREATE_RACE_WAIT_MS = 10_000;

const USER_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;

export function checkUserId(userId: string): string {
  if (!USER_ID.test(userId)) throw new Error(`user id not usable in container names: ${userId}`);
  return userId;
}

export class RunnerContainers {
  /** Tail of each human's queue of container changes ({@link #serial}). */
  readonly #changes = new Map<string, Promise<unknown>>();
  readonly #images: ImageIds;

  constructor(
    private readonly engine: EngineClient,
    readonly settings: ContainerSettings,
    private readonly log?: RunnerLog,
  ) {
    this.#images = new ImageIds(engine, settings.imageIdTtlMs);
  }

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
      status: info.State.Status,
      imageId: info.Image,
      floorMounts: (info.HostConfig.Mounts ?? []).filter((m) => m.Target !== this.settings.home),
    };
  }

  /**
   * True when the runner image tag now points at another image than the one
   * `c` was created from (the image was rebuilt or pulled since): recreating
   * it gives the human the new CLIs. False when either id is unknown.
   */
  async imageChanged(c: RunnerContainer): Promise<boolean> {
    if (!c.imageId) return false;
    const current = await this.#images.current(this.settings.image);
    return current !== null && current !== c.imageId;
  }

  /**
   * Create (if absent) and start the human's runner container. Idempotent, and
   * safe to call concurrently: see {@link #serial}.
   */
  ensure(userId: string): Promise<RunnerContainer> {
    return this.#serial(userId, () => this.#ensure(userId));
  }

  async #ensure(userId: string): Promise<RunnerContainer> {
    let found: RunnerContainer | null;
    try {
      found = await this.lookup(userId);
    } catch (e) {
      if (!isInspectBroken(e)) throw e;
      return this.#healUninspectable(userId, e);
    }
    if (found) return this.#revive(found);
    try {
      return await this.#start(await this.#create(userId, []));
    } catch (e) {
      // Lost a creation race with someone outside this office process: use theirs.
      if (e instanceof DockerApiError && e.status === 409) {
        const other = await this.#awaitCreated(userId);
        if (other) return this.#revive(other);
      }
      throw e;
    }
  }

  /**
   * Start an existing container, or replace it when it cannot run any more
   * (heal.ts). Running containers are returned as they are: whatever runs in
   * them, tmux included, is never touched here.
   */
  async #revive(c: RunnerContainer): Promise<RunnerContainer> {
    if (c.running) return c;
    if (c.status === "dead") return this.#replace(c, "the container is in the dead state");
    if (await this.imageChanged(c)) return this.#replace(c, "the runner image changed");
    let failure: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.#start(c);
      } catch (e) {
        failure = e;
        const kind = classifyStartFailure(e);
        if (kind === "other") throw e;
        if (kind === "gone") return this.#start(await this.#create(c.userId, c.floorMounts));
        if (kind === "broken") break;
      }
    }
    return this.#replace(c, (failure as Error).message);
  }

  /** Inspect answers 5xx: replace the container only if the list says it is not running. */
  async #healUninspectable(userId: string, err: DockerApiError): Promise<RunnerContainer> {
    const row = await this.#listRow(userId);
    if (!row) throw err;
    if (row.State === "running") {
      this.log?.warn(
        { userId, reason: safeReason(err.message) },
        "runner container cannot be inspected but is running; left alone",
      );
      throw err;
    }
    // Floor mounts are unknown: `mountProject` adds the human's areas back on the next spawn.
    return this.#replace({ userId, id: row.Id, running: false, floorMounts: [] }, err.message);
  }

  /**
   * Remove a container that is not running and create it again from the current image,
   * with the same floor mounts and the same HOME volume (never removed here).
   */
  async #replace(c: RunnerContainer, reason: string): Promise<RunnerContainer> {
    // Last look before removing: a container that runs now is left alone.
    const now = await this.lookup(c.userId).catch(() => null);
    if (now?.running) return now;
    this.#logRecreate(c.userId, reason);
    await this.#remove(c.id);
    return this.#start(await this.#create(c.userId, c.floorMounts));
  }

  #logRecreate(userId: string, reason: string): void {
    this.log?.warn(
      { userId, reason: safeReason(reason) },
      "recreating runner container, HOME kept",
    );
  }

  /** The human's runner in the container list (works when inspect does not). */
  async #listRow(userId: string): Promise<{ Id: string; State: string } | null> {
    const rows = await this.engine.json<{ Id: string; State: string }[]>(
      "GET",
      "/containers/json",
      {
        query: {
          all: true,
          filters: JSON.stringify({
            name: [`^/${this.containerName(userId)}$`],
            label: [`${LABEL_ROLE}=runner`, `${LABEL_USER}=${userId}`],
          }),
        },
      },
    );
    return rows[0] ?? null;
  }

  /**
   * Replace the container with one that has `floorMounts`. HOME survives (named
   * volume); anything running in the old container, tmux included, does not, so
   * callers only do this when the runner is idle.
   */
  recreate(userId: string, floorMounts: MountSpec[], reason?: string): Promise<RunnerContainer> {
    return this.#serial(userId, async () => {
      const found = await this.lookup(userId);
      if (reason) this.#logRecreate(userId, reason);
      if (found) await this.#remove(found.id);
      return this.#start(await this.#create(userId, floorMounts));
    });
  }

  /**
   * Run container changes for one human one at a time (#130). The daemon reserves
   * a container name as soon as a create starts but answers 404 for it until the
   * create is done, which can take seconds on a busy host. Two overlapping
   * `ensure`s (the spawn dialog's login check and the spawn itself) used to both
   * create: the second got 409 "name already in use", found nothing to reuse and
   * failed the spawn. The same goes for an `ensure` between a recreate's remove
   * and create.
   */
  #serial<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const run = (this.#changes.get(userId) ?? Promise.resolve()).catch(() => {}).then(work);
    this.#changes.set(userId, run);
    const release = () => {
      if (this.#changes.get(userId) === run) this.#changes.delete(userId);
    };
    run.then(release, release);
    return run;
  }

  /** After a 409 from create: the other creator's container, once the daemon shows it. */
  async #awaitCreated(userId: string): Promise<RunnerContainer | null> {
    const deadline = Date.now() + CREATE_RACE_WAIT_MS;
    for (;;) {
      const found = await this.lookup(userId);
      if (found || Date.now() >= deadline) return found;
      await Bun.sleep(100);
    }
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
      // One broken runner must not keep the others (or the office) from coming back.
      try {
        found.push(await this.ensure(userId));
      } catch (e) {
        this.log?.warn(
          { userId, reason: safeReason((e as Error).message) },
          "runner container could not be recovered",
        );
      }
    }
    return found;
  }

  /** Remove the container and, with `removeHome`, the credential volume too. */
  async remove(userId: string, opts: { removeHome?: boolean } = {}): Promise<void> {
    await this.#serial(userId, async () => {
      const found = await this.lookup(userId);
      if (found) await this.#remove(found.id);
    });
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
      if (!isImageMissing(e)) throw e;
      if (s.pull === false) throw new RunnerImageMissingError(s.image, (e as Error).message);
      await pullImage(this.engine, s.image);
      this.#images.forget(s.image);
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
}
