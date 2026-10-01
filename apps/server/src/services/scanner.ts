/**
 * Services discovery loop (SPEC §9.4, research 01 §12, #39). Every 2.5 s it
 * lists the LISTEN sockets in each running henchman's sandbox (through the
 * runner, so inside the henchman's container or network namespace), turns them
 * into services (discovery.ts) and publishes each operation's list to its
 * OperationRoom and the `services` table. A henchman's services are that henchman's.
 *
 * New ports are titled once: the henchman's terminal is captured and the dev
 * server's banner above its printed URL names it (the fast path), then the
 * page `<title>` is fetched from the service itself, else the process name.
 * Henchmen whose ports have not changed for a while are scanned every 4th tick.
 */
import {
  AGENT_STATUSES,
  type AgentStatus,
  type ServiceState,
  servicesProxyPath,
} from "@regulus/protocol";
import { inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { agents } from "../db/schema/index.ts";
import type { Logger } from "../logging.ts";
import type { AgentRef, Runner } from "../runners/types.ts";
import {
  bannerTitle,
  type Listener,
  printedPorts,
  type ServiceTarget,
  serviceTitle,
  toListeners,
} from "./discovery.ts";
import type { KnownService, ServiceRegistry } from "./registry.ts";
import type { ServiceStore, StoredService } from "./store.ts";

export const SCAN_INTERVAL_MS = 2_500;
/** Unchanged scans after which a henchman is scanned every {@link QUIET_EVERY}th tick. */
export const QUIET_AFTER = 12;
export const QUIET_EVERY = 4;
/** `lastSeenAt` is written (and published) at most this often. */
export const LAST_SEEN_EVERY_MS = 60_000;
/** How many scans a still untitled service is retitled on. */
const TITLE_TRIES = 3;
const SCAN_CONCURRENCY = 4;

/** Henchmen whose sandbox may run dev servers: everything but down. */
export const SCANNED_STATUSES: readonly AgentStatus[] = AGENT_STATUSES.filter(
  (s) => s !== "exited" && s !== "offline" && s !== "error",
);

export interface ScannedHenchman {
  id: string;
  operationId: string;
  ownerUserId: string;
  tmuxSession: string;
}

export interface ScannerDeps {
  db: Db;
  runner: Runner;
  registry: ServiceRegistry;
  store: ServiceStore;
  /** Replace an operation's services in its OperationRoom. */
  publish(operationId: string, services: ServiceState[]): void;
  /** Whether other operation members may open this henchman's apps (app domain mode). */
  shared(agentId: string): boolean;
  /** A page title from the service itself (GET /), or null. */
  probeTitle?(target: ServiceTarget, port: number): Promise<string | null>;
  logger: Logger;
  now?: () => number;
  intervalMs?: number;
}

interface Tracked extends KnownService {
  titleTries: number;
  titled: boolean;
  persistedAt: number;
}

export class ServiceScanner {
  readonly #d: ScannerDeps;
  readonly #now: () => number;
  readonly #quiet = new Map<string, number>();
  #persisted = new Map<string, StoredService>();
  #timer: ReturnType<typeof setInterval> | undefined;
  #running: Promise<void> | undefined;
  #tick = 0;
  #booted = false;

  constructor(deps: ScannerDeps) {
    this.#d = deps;
    this.#now = deps.now ?? Date.now;
  }

  start(): void {
    if (this.#timer) return;
    this.#persisted = new Map(this.#d.store.all().map((s) => [`${s.agentId}:${s.port}`, s]));
    this.#timer = setInterval(() => void this.tick(), this.#d.intervalMs ?? SCAN_INTERVAL_MS);
    void this.tick();
  }

  async stop(): Promise<void> {
    clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#running;
  }

  /** One scan of every running henchman; overlapping calls share the running scan. */
  tick(): Promise<void> {
    this.#running ??= this.#scanAll().finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }

  /** Scan this henchman on the next tick even if it is quiet. */
  nudge(agentId: string): void {
    this.#quiet.delete(agentId);
  }

  async #scanAll(): Promise<void> {
    const tick = this.#tick++;
    const henchmen = this.#henchmen();
    const live = new Set(henchmen.map((r) => r.id));
    const changedOperations = new Set<string>();
    for (const agentId of this.#d.registry.agentIds()) {
      if (live.has(agentId)) continue;
      const gone = this.#d.registry.delete(agentId);
      this.#quiet.delete(agentId);
      if (gone && gone.services.size > 0) changedOperations.add(gone.operationId);
      this.#d.store.removeAgents([agentId]);
    }
    if (!this.#booted) this.#d.store.retainAgents([...live]);
    const due = henchmen.filter(
      (r) => (this.#quiet.get(r.id) ?? 0) < QUIET_AFTER || tick % QUIET_EVERY === 0,
    );
    const queue = [...due];
    const worker = async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        try {
          if (await this.#scanHenchman(r)) changedOperations.add(r.operationId);
        } catch (err) {
          this.#d.logger.warn({ agentId: r.id, err: String(err) }, "services scan failed");
        }
      }
    };
    await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));
    this.#booted = true;
    this.#persisted.clear();
    for (const operationId of changedOperations) {
      this.#d.publish(operationId, this.#d.registry.servicesOn(operationId, this.#d.shared));
    }
  }

  #henchmen(): ScannedHenchman[] {
    return this.#d.db
      .select({
        id: agents.id,
        operationId: agents.operationId,
        ownerUserId: agents.ownerUserId,
        tmuxSession: agents.tmuxSession,
      })
      .from(agents)
      .where(inArray(agents.status, [...SCANNED_STATUSES]))
      .all()
      .map((r) => ({ ...r, tmuxSession: r.tmuxSession ?? `agent-${r.id}` }));
  }

  async #target(agent: AgentRef): Promise<ServiceTarget | null> {
    const runner = this.#d.runner;
    const sandbox = runner.sandboxOf ? await runner.sandboxOf(agent) : null;
    if (sandbox) return { host: sandbox.host, sandboxed: true };
    // Without a sandbox, linux-user henchmen (and the local dev backend) share the office's
    // network namespace; a docker henchman then sits in its human's runner, which the office
    // does not address.
    return runner.backend === "linux-user" ? { host: "127.0.0.1", sandboxed: false } : null;
  }

  /** Scan one henchman; true when its operation's list changed. */
  async #scanHenchman(henchman: ScannedHenchman): Promise<boolean> {
    const runner = this.#d.runner;
    const agent = { userId: henchman.ownerUserId, agentId: henchman.id };
    const now = this.#now();
    const target = await this.#target(agent);
    const ports = await runner.listPorts(agent);
    const prev = this.#d.registry.get(henchman.id);
    const old = (port: number) => prev?.services.get(port) as Tracked | undefined;
    const fresh = ports.some((p) => !old(p.port));
    const processes = fresh ? await runner.listProcesses(agent).catch(() => []) : [];
    const listeners = toListeners(ports, processes, target);
    const screen = listeners.some((l) => needsTitle(old(l.port)))
      ? await this.#screen(henchman)
      : "";

    let changed =
      (prev?.services.size ?? 0) !== listeners.length || prev?.target?.host !== target?.host;
    const next = new Map<number, KnownService>();
    for (const l of listeners) {
      const before = old(l.port);
      const item: Tracked = before
        ? { ...before, pid: l.pid, address: l.address, localOnly: l.localOnly }
        : this.#fresh(henchman, l, now);
      if (l.command) item.command = l.command;
      let dirty =
        !before ||
        before.pid !== l.pid ||
        before.address !== l.address ||
        before.localOnly !== l.localOnly;
      if (needsTitle(before)) dirty = (await this.#title(item, target, screen)) || dirty;
      if (dirty || now - item.persistedAt >= LAST_SEEN_EVERY_MS) {
        item.lastSeenAt = now;
        item.persistedAt = now;
        this.#d.store.upsert({
          ...item,
          agentId: henchman.id,
          url: servicesProxyPath(henchman.operationId, henchman.id, item.port),
        });
        changed = true;
      }
      next.set(l.port, item);
    }
    for (const port of prev?.services.keys() ?? []) if (!next.has(port)) changed = true;
    this.#d.registry.set({
      agentId: henchman.id,
      operationId: henchman.operationId,
      ownerUserId: henchman.ownerUserId,
      target,
      services: next,
    });
    if (changed) this.#d.store.prune(henchman.id, [...next.keys()]);
    this.#quiet.set(henchman.id, changed ? 0 : (this.#quiet.get(henchman.id) ?? 0) + 1);
    return changed && (next.size > 0 || (prev?.services.size ?? 0) > 0);
  }

  #fresh(henchman: ScannedHenchman, l: Listener, now: number): Tracked {
    const stored = this.#persisted.get(`${henchman.id}:${l.port}`);
    return {
      ...l,
      id: stored?.id ?? crypto.randomUUID(),
      title: stored?.title || serviceTitle({ command: l.command, port: l.port }),
      firstSeenAt: stored?.firstSeenAt ?? now,
      lastSeenAt: now,
      titled: false,
      titleTries: 0,
      persistedAt: Number.NEGATIVE_INFINITY,
    };
  }

  /** Title from the terminal banner and the page; true when the title changed. */
  async #title(item: Tracked, target: ServiceTarget | null, screen: string): Promise<boolean> {
    item.titleTries++;
    const banner = bannerTitle(screen, item.port);
    const page = await this.#page(item, target);
    if (!banner && !page) return false;
    const title = serviceTitle({ banner, page, command: item.command, port: item.port });
    item.titled = true;
    if (title === item.title) return false;
    item.title = title;
    return true;
  }

  async #page(l: Listener, target: ServiceTarget | null): Promise<string | null> {
    if (!target || l.localOnly || !this.#d.probeTitle) return null;
    return this.#d.probeTitle(target, l.port).catch(() => null);
  }

  async #screen(henchman: ScannedHenchman): Promise<string> {
    try {
      const text = await this.#d.runner.capturePane(
        { userId: henchman.ownerUserId, name: henchman.tmuxSession },
        200,
      );
      return printedPorts(text).size > 0 ? text : "";
    } catch {
      return "";
    }
  }
}

const needsTitle = (s: Tracked | undefined): boolean =>
  !s || (!s.titled && s.titleTries < TITLE_TRIES);
