/**
 * The OperationRooms one client is in (SPEC §9.1 presence, #186): the room the
 * player is in (the primary, whose state the HUD reads and to which operation
 * commands go) plus up to three nearby visible rooms. Joins missing rooms,
 * leaves rooms no longer wanted, re-joins lost rooms with backoff and gives
 * up on denied ones. Every room's state goes to `onState`; only the
 * primary's messages and rejections reach the listeners. Messages that say
 * what is open in a room (`HELD_TYPES`: the requests waiting for this person)
 * are kept while the room is only nearby and handed over when the player
 * walks in, since the server sends them once, when the room is joined. A room the server
 * closed because access was withdrawn (#244) is not asked for again; one whose
 * access changed is joined once more at once.
 */
import {
  type AccessCloseKind,
  AGENT_PERMISSIONS_MESSAGE,
  accessCloseKind,
  type CommandRejected,
  type OperationState,
} from "@regulus/protocol";
import { type BackoffOptions, backoffDelay } from "./backoff.ts";
import { recordJoin } from "./joinTimes.ts";
import {
  isConsentedClose,
  type RoomHandle,
  type RoomTransport,
  type Unsubscribe,
} from "./transport.ts";

/** At most this many OperationRooms besides the primary (SPEC §9.1). */
export const MAX_NEARBY_ROOMS = 3;

/**
 * Messages kept for a room that is joined but not the primary (#60). The server sends a
 * henchman's open permission requests when a room is joined and when they change; a client
 * joins nearby rooms before the player walks in, so without this an owner who comes to a
 * henchman that was already waiting would never be shown its request.
 */
export const HELD_TYPES: readonly string[] = [AGENT_PERMISSIONS_MESSAGE];
/** At most this many held messages per room; the oldest go first. */
const MAX_HELD = 200;

export type Scheduler = (fn: () => void, delayMs: number) => () => void;

export interface OperationLinksDeps {
  transport: RoomTransport;
  backoff: BackoffOptions;
  maxAttempts: number;
  schedule: Scheduler;
  random: () => number;
  /** A joined room's state (also on join). */
  onState: (operationId: string, state: OperationState) => void;
  /** A room was left or lost: its state is stale. */
  onGone: (operationId: string) => void;
  /** A join failed or was refused (the message goes to `lastError`). */
  onError: (message: string) => void;
  /** The server refused a room (no access); it is not asked for again while wanted. */
  onDenied: (operationId: string) => void;
  /** The server closed a joined room: access to it was withdrawn or changed (#244). */
  onAccessClosed?: (operationId: string, kind: AccessCloseKind) => void;
  /** The primary room's rejections. */
  onRejected: (notice: CommandRejected) => void;
  /** Whether the building connection is up (operation joins wait for it). */
  connected: () => boolean;
}

interface Link {
  operationId: string;
  handle: RoomHandle<OperationState> | null;
  joining: boolean;
  attempt: number;
  cancelRetry: (() => void) | null;
  subs: Unsubscribe[];
  messageSubs: Map<string, Unsubscribe>;
  /** `HELD_TYPES` messages that arrived while the room was not the primary, oldest first. */
  held: Array<{ type: string; payload: unknown }>;
}

function isDenied(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 401 || code === 403;
}

export class OperationLinks {
  private readonly links = new Map<string, Link>();
  private primaryId: string | null = null;
  private wanted = new Set<string>();
  /** Rooms the server refused; not asked for again until they leave the wanted set. */
  private readonly denied = new Set<string>();
  /** Message listeners by type; they follow the primary room. */
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  private closed = false;

  constructor(private readonly deps: OperationLinksDeps) {}

  get primary(): string | null {
    return this.primaryId;
  }

  /** The joined primary room's handle, if it is joined. */
  primaryHandle(): RoomHandle<OperationState> | null {
    return this.primaryId ? (this.links.get(this.primaryId)?.handle ?? null) : null;
  }

  /** Operation ids currently joined (handles held). */
  joined(): string[] {
    return [...this.links.values()].filter((l) => l.handle).map((l) => l.operationId);
  }

  /** Latest state of a joined room. */
  snapshot(operationId: string): OperationState | null {
    return this.links.get(operationId)?.handle?.snapshot() ?? null;
  }

  /** Want exactly `primary` plus `nearby` (capped); joins and leaves to match. */
  async set(primary: string | null, nearby: readonly string[]): Promise<void> {
    this.closed = false;
    const want = new Set<string>();
    if (primary) want.add(primary);
    for (const id of nearby) {
      if (want.size >= MAX_NEARBY_ROOMS + (primary ? 1 : 0)) break;
      want.add(id);
    }
    for (const id of this.denied) if (!want.has(id)) this.denied.delete(id);
    this.wanted = want;
    const before = this.primaryId;
    this.primaryId = primary;
    if (before !== primary) this.resubscribeMessages();
    const leaving = [...this.links.keys()].filter((id) => !want.has(id));
    await Promise.all([
      ...leaving.map((id) => this.drop(id, true)),
      ...[...want].map((id) => this.ensure(id)),
    ]);
  }

  /** Rejoin everything wanted (after the building connection came back). */
  async rejoin(): Promise<void> {
    await Promise.all([...this.wanted].map((id) => this.ensure(id)));
  }

  /** Forget every room handle without leaving (the building session died with them). */
  async dropAll(consented: boolean): Promise<void> {
    await Promise.all([...this.links.keys()].map((id) => this.drop(id, consented)));
  }

  close(): void {
    this.closed = true;
  }

  onMessage(type: string, listener: (payload: unknown) => void): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
    const link = this.primaryId ? this.links.get(this.primaryId) : undefined;
    if (link?.handle) this.subscribeMessage(link, type);
    return () => {
      set.delete(listener);
    };
  }

  private dispatch(type: string, payload: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(payload);
  }

  /** From the moment a room is joined: its `HELD_TYPES` go to the listeners, or wait. */
  private holdMessages(link: Link, handle: RoomHandle<OperationState>): Unsubscribe[] {
    return HELD_TYPES.map((type) =>
      handle.onMessage(type, (payload) => {
        if (link.operationId === this.primaryId) return this.dispatch(type, payload);
        link.held.push({ type, payload });
        if (link.held.length > MAX_HELD) link.held.shift();
      }),
    );
  }

  private subscribeMessage(link: Link, type: string): void {
    if (HELD_TYPES.includes(type)) return; // `holdMessages` listens from the join on
    if (!link.handle || link.messageSubs.has(type)) return;
    link.messageSubs.set(
      type,
      link.handle.onMessage(type, (payload) => {
        if (link.operationId !== this.primaryId) return;
        for (const listener of this.listeners.get(type) ?? []) listener(payload);
      }),
    );
  }

  /** Message subscriptions live on the primary room only. */
  private resubscribeMessages(): void {
    for (const link of this.links.values()) {
      if (link.operationId === this.primaryId) {
        for (const type of this.listeners.keys()) this.subscribeMessage(link, type);
        // The player walked in: what was said to this room meanwhile, in order.
        for (const { type, payload } of link.held.splice(0)) this.dispatch(type, payload);
      } else {
        for (const off of link.messageSubs.values()) off();
        link.messageSubs.clear();
      }
    }
  }

  private async ensure(operationId: string): Promise<void> {
    if (this.denied.has(operationId) || !this.deps.connected()) return;
    let link = this.links.get(operationId);
    if (link && (link.handle || link.joining || link.cancelRetry)) return;
    if (!link) {
      link = {
        operationId,
        handle: null,
        joining: false,
        attempt: 0,
        cancelRetry: null,
        subs: [],
        messageSubs: new Map(),
        held: [],
      };
      this.links.set(operationId, link);
    }
    await this.join(link);
  }

  private async join(link: Link): Promise<void> {
    link.cancelRetry?.();
    link.cancelRetry = null;
    link.joining = true;
    const started = typeof performance === "undefined" ? 0 : performance.now();
    let handle: RoomHandle<OperationState>;
    try {
      handle = await this.deps.transport.joinOperation({ operationId: link.operationId });
    } catch (err) {
      link.joining = false;
      this.failed(link, err);
      return;
    }
    link.joining = false;
    if (
      this.closed ||
      this.links.get(link.operationId) !== link ||
      !this.wanted.has(link.operationId)
    ) {
      await handle.leave(true).catch(() => undefined); // no longer wanted while joining
      return;
    }
    link.handle = handle;
    link.attempt = 0;
    this.deps.onState(link.operationId, handle.snapshot());
    if (started) recordJoin(link.operationId, performance.now() - started, performance.now());
    link.subs = [
      handle.onState((state) => this.deps.onState(link.operationId, state)),
      handle.onLeave((code, reason) => this.lost(link, code, reason)),
      handle.onRejected((notice) => {
        if (link.operationId === this.primaryId) this.deps.onRejected(notice);
      }),
      ...this.holdMessages(link, handle),
    ];
    if (link.operationId === this.primaryId)
      for (const type of this.listeners.keys()) this.subscribeMessage(link, type);
  }

  private failed(link: Link, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.deps.onError(message);
    if (this.closed || !this.wanted.has(link.operationId)) {
      this.forget(link);
      return;
    }
    if (isDenied(err)) {
      // No access (or the room is gone): retrying cannot help.
      this.denied.add(link.operationId);
      this.forget(link);
      this.deps.onDenied(link.operationId);
      return;
    }
    if (link.attempt >= this.deps.maxAttempts) {
      this.forget(link);
      return;
    }
    const delay = backoffDelay(link.attempt, this.deps.backoff, this.deps.random);
    link.attempt += 1;
    link.cancelRetry = this.deps.schedule(() => {
      link.cancelRetry = null;
      void this.join(link);
    }, delay);
  }

  private lost(link: Link, code: number, reason?: string): void {
    this.unbind(link);
    this.deps.onGone(link.operationId);
    if (this.closed || isConsentedClose(code) || !this.wanted.has(link.operationId)) {
      this.forget(link);
      return;
    }
    const access = accessCloseKind(code);
    if (access) {
      this.deps.onAccessClosed?.(link.operationId, access);
      if (access === "changed") {
        // Still allowed, differently: one fresh join, no backoff.
        link.attempt = 0;
        void this.join(link);
        return;
      }
      // Withdrawn: asking again cannot help while the room is wanted.
      this.denied.add(link.operationId);
      this.forget(link);
      this.deps.onDenied(link.operationId);
      return;
    }
    if (!this.deps.connected()) return; // the building retry brings it back
    this.failed(link, new Error(reason ?? `operation room closed (${code})`));
  }

  private unbind(link: Link): void {
    for (const off of link.subs) off();
    link.subs = [];
    for (const off of link.messageSubs.values()) off();
    link.messageSubs.clear();
    link.handle = null;
  }

  private forget(link: Link): void {
    if (this.links.get(link.operationId) === link) this.links.delete(link.operationId);
  }

  private async drop(operationId: string, consented: boolean): Promise<void> {
    const link = this.links.get(operationId);
    if (!link) return;
    link.cancelRetry?.();
    link.cancelRetry = null;
    const handle = link.handle;
    this.unbind(link);
    this.forget(link);
    this.deps.onGone(operationId);
    if (handle) await handle.leave(consented).catch(() => undefined);
  }
}
