/**
 * Client-side session with the office: always in the BuildingRoom, and in
 * the OperationRooms of the room the player is in plus up to three nearby
 * visible rooms (SPEC §6, §9.1; #186, operationLinks.ts). Patches room state
 * into the zustand stores (the room the player is in also into the operation
 * store the HUD reads) and re-joins with exponential backoff when a room is
 * lost for a reason we did not consent to. Talks to the server only
 * through `RoomTransport`.
 */
import {
  type AccessCloseKind,
  accessCloseKind,
  accessCloseMessage,
  type BuildingState,
  type ClientCommandPayload,
  type ClientCommandType,
  type CommandRejected,
  LOBBY_OPERATION_ID,
} from "@regulus/protocol";
import { useBuildingStore } from "../state/building.ts";
import { useConnectionStore } from "../state/connection.ts";
import { useOperationStore } from "../state/operation.ts";
import { useRoomsStore } from "../state/rooms.ts";
import { type BackoffOptions, backoffDelay, DEFAULT_BACKOFF } from "./backoff.ts";
import { roomForCommand } from "./commandRouting.ts";
import { OperationLinks } from "./operationLinks.ts";
import {
  isConsentedClose,
  type RoomHandle,
  type RoomTransport,
  type Unsubscribe,
} from "./transport.ts";

export type RejectionListener = (notice: CommandRejected) => void;
export type MessageListener = (payload: unknown) => void;

export type Scheduler = (fn: () => void, delayMs: number) => () => void;

/** The server ended a room because access was withdrawn or changed (#244). */
export interface AccessNotice {
  kind: AccessCloseKind;
  /** The operation whose room closed; absent for the office itself. */
  operationId?: string;
  /** Plain text for the human. */
  message: string;
}

const defaultScheduler: Scheduler = (fn, delayMs) => {
  const id = setTimeout(fn, delayMs);
  return () => clearTimeout(id);
};

export interface OfficeClientOptions {
  transport: RoomTransport;
  stores?: {
    building: typeof useBuildingStore;
    operation: typeof useOperationStore;
    connection: typeof useConnectionStore;
    rooms?: typeof useRoomsStore;
  };
  backoff?: BackoffOptions;
  /** Give up (status `failed`) after this many consecutive failed re-joins. */
  maxAttempts?: number;
  schedule?: Scheduler;
  random?: () => number;
  /** Tell the human a room was closed on them (a toast; sign-out also re-checks the session). */
  onAccess?: (notice: AccessNotice) => void;
}

export class OfficeClient {
  private readonly transport: RoomTransport;
  private readonly stores: NonNullable<OfficeClientOptions["stores"]>;
  private readonly backoff: BackoffOptions;
  private readonly maxAttempts: number;
  private readonly schedule: Scheduler;
  private readonly random: () => number;
  private readonly onAccess: (notice: AccessNotice) => void;

  private building: RoomHandle<BuildingState> | null = null;
  private readonly operations: OperationLinks;
  private readonly rooms: typeof useRoomsStore;
  /** The room the player is in, as last told to the building (`operation.go`). */
  private announcedOperation: string | null = null;
  private closed = false;
  private attempt = 0;
  private cancelBuildingRetry: (() => void) | null = null;
  private buildingSubs: Unsubscribe[] = [];
  private readonly rejectionListeners = new Set<RejectionListener>();
  /** BuildingRoom message listeners by type; they survive re-joins. */
  private readonly buildingListeners = new Map<string, Set<MessageListener>>();
  private buildingMessageSubs = new Map<string, Unsubscribe>();
  private readonly emitRejected: RejectionListener = (notice) => {
    for (const listener of this.rejectionListeners) listener(notice);
  };

  constructor(options: OfficeClientOptions) {
    this.transport = options.transport;
    this.stores = options.stores ?? {
      building: useBuildingStore,
      operation: useOperationStore,
      connection: useConnectionStore,
    };
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
    this.maxAttempts = options.maxAttempts ?? 10;
    this.schedule = options.schedule ?? defaultScheduler;
    this.random = options.random ?? Math.random;
    this.onAccess = options.onAccess ?? (() => {});
    this.rooms = this.stores.rooms ?? useRoomsStore;
    this.operations = new OperationLinks({
      transport: this.transport,
      backoff: this.backoff,
      maxAttempts: this.maxAttempts,
      schedule: this.schedule,
      random: this.random,
      connected: () => this.building !== null,
      onState: (operationId, state) => {
        this.rooms.getState().apply(operationId, state);
        if (operationId === this.operations.primary) this.stores.operation.getState().apply(state);
      },
      onGone: (operationId) => {
        this.rooms.getState().drop(operationId);
        if (operationId === this.operations.primary) {
          const operation = this.stores.operation.getState();
          operation.clear();
          operation.setOperationId(operationId);
        }
      },
      onError: (message) => this.stores.connection.getState().set({ lastError: message }),
      onDenied: (operationId) => {
        if (operationId === this.operations.primary) this.stores.operation.getState().clear();
      },
      onRejected: this.emitRejected,
      onAccessClosed: (operationId, kind) => {
        // A changed access rejoins by itself; only a withdrawn one needs words.
        if (kind === "changed" || operationId !== this.operations.primary) return;
        this.onAccess({ kind, operationId, message: accessCloseMessage(kind, "room") });
      },
    });
  }

  get status() {
    return this.stores.connection.getState().status;
  }

  /** The room the player is in, once its OperationRoom is joined. */
  get currentOperationId(): string | null {
    return this.operations.primaryHandle() ? this.operations.primary : null;
  }

  /** Operation ids whose OperationRooms are joined now. */
  get joinedOperationIds(): string[] {
    return this.operations.joined();
  }

  /** Join the BuildingRoom (and the wanted OperationRooms). Safe to call again after `failed`. */
  async connect(): Promise<void> {
    this.closed = false;
    if (this.building) return;
    this.cancelBuildingRetry?.();
    this.cancelBuildingRetry = null;
    this.stores.connection
      .getState()
      .set({ status: this.attempt === 0 ? "connecting" : "reconnecting" });
    let handle: RoomHandle<BuildingState>;
    try {
      handle = await this.transport.joinBuilding();
    } catch (err) {
      this.scheduleBuildingRetry(err);
      return;
    }
    if (this.closed) {
      await handle.leave(true).catch(() => undefined);
      return;
    }
    this.bindBuilding(handle);
    // A new building session starts in the lobby; tell it if we are in a room.
    this.announcedOperation = LOBBY_OPERATION_ID;
    if (this.operations.primary) this.announce(this.operations.primary, true);
    await this.operations.rejoin();
  }

  /** Leave everything on purpose; no reconnect is attempted. */
  async disconnect(): Promise<void> {
    this.closed = true;
    this.cancelBuildingRetry?.();
    this.cancelBuildingRetry = null;
    this.attempt = 0;
    this.operations.close();
    await this.operations.dropAll(true);
    this.rooms.getState().clear();
    this.stores.operation.getState().clear();
    const building = this.building;
    this.unbindBuilding();
    await building?.leave(true).catch(() => undefined);
    this.stores.connection.getState().set({ status: "disconnected", attempt: 0 });
  }

  /**
   * Be in the OperationRooms of `current` (the room the player is in; null in
   * the lobby, the corridors and the other special rooms) and of up to
   * three `nearby` rooms (SPEC §9.1); leave every other OperationRoom. The
   * building hears where the player is (`operation.go`) whenever `current` changes.
   */
  async setRooms(current: string | null, nearby: readonly string[] = []): Promise<void> {
    const before = this.operations.primary;
    const operation = this.stores.operation.getState();
    const promise = this.operations.set(current, nearby);
    if (before !== current) {
      // Already joined as a nearby room: the HUD switches at once.
      const joined = current ? this.operations.snapshot(current) : null;
      if (joined) operation.apply(joined);
      else {
        operation.clear();
        operation.setOperationId(current);
      }
      this.announce(current, false);
    }
    await promise;
  }

  /** Be in exactly one OperationRoom (tests and tools); `setRooms` is the general form. */
  async goToOperation(operationId: string): Promise<void> {
    await this.setRooms(operationId, []);
  }

  private announce(operationId: string | null, force: boolean): void {
    const id = operationId ?? LOBBY_OPERATION_ID;
    if (!this.building || (!force && id === this.announcedOperation)) return;
    this.announcedOperation = id;
    this.building.send("operation.go", { operationId: id, mode: "teleport" });
  }

  /** Send a typed command to the room that owns it. Throws when that room is not joined. */
  send<T extends ClientCommandType>(type: T, payload: ClientCommandPayload<T>): void {
    const target =
      roomForCommand(type) === "building" ? this.building : this.operations.primaryHandle();
    if (!target) throw new Error(`Cannot send "${type}": ${roomForCommand(type)} room not joined`);
    target.send(type, payload);
  }

  /** Listen for commands the server rejected, from whichever room we are in. */
  onRejected(listener: RejectionListener): Unsubscribe {
    this.rejectionListeners.add(listener);
    return () => this.rejectionListeners.delete(listener);
  }

  /**
   * Listen for a server→client OperationRoom message (e.g. `agent.permissions`)
   * from the room the player is in, now or later. Payloads are unvalidated.
   */
  onOperationMessage(type: string, listener: MessageListener): Unsubscribe {
    return this.operations.onMessage(type, listener);
  }

  /**
   * Listen for a server→client BuildingRoom message (e.g. `notify.event`),
   * now and after re-joins. Payloads are unvalidated.
   */
  onBuildingMessage(type: string, listener: MessageListener): Unsubscribe {
    let set = this.buildingListeners.get(type);
    if (!set) {
      set = new Set();
      this.buildingListeners.set(type, set);
    }
    set.add(listener);
    if (this.building) this.subscribeBuildingMessage(this.building, type);
    return () => {
      set.delete(listener);
    };
  }

  private subscribeBuildingMessage(handle: RoomHandle<BuildingState>, type: string) {
    if (this.buildingMessageSubs.has(type)) return;
    this.buildingMessageSubs.set(
      type,
      handle.onMessage(type, (payload) => {
        for (const listener of this.buildingListeners.get(type) ?? []) listener(payload);
      }),
    );
  }

  private bindBuilding(handle: RoomHandle<BuildingState>) {
    this.building = handle;
    this.attempt = 0;
    const building = this.stores.building.getState();
    const connection = this.stores.connection.getState();
    building.setSessionId(handle.sessionId);
    building.apply(handle.snapshot());
    connection.set({ status: "connected", attempt: 0, lastError: null });
    this.buildingSubs = [
      handle.onState((state) => building.apply(state)),
      handle.onDrop((code, reason) =>
        connection.set({ status: "reconnecting", lastError: reason ?? `dropped (${code})` }),
      ),
      handle.onReconnect(() => connection.set({ status: "connected", lastError: null })),
      handle.onError((code, message) => connection.set({ lastError: message ?? `error ${code}` })),
      handle.onLeave((code, reason) => this.onBuildingLeft(code, reason)),
      handle.onRejected(this.emitRejected),
    ];
    for (const type of this.buildingListeners.keys()) this.subscribeBuildingMessage(handle, type);
  }

  private unbindBuilding() {
    for (const off of this.buildingSubs) off();
    this.buildingSubs = [];
    for (const off of this.buildingMessageSubs.values()) off();
    this.buildingMessageSubs.clear();
    this.building = null;
    this.stores.building.getState().clear();
  }

  private onBuildingLeft(code: number, reason?: string) {
    this.unbindBuilding();
    this.announcedOperation = null;
    // The operation seats die with the building session; rejoin them after backoff.
    void this.operations.dropAll(false);
    const access = accessCloseKind(code);
    if (access === "signedOut" || access === "revoked") {
      // Not a dropped connection: retrying would only be refused again.
      const message = accessCloseMessage(access, "office");
      this.stores.connection.getState().set({ status: "disconnected", lastError: message });
      if (!this.closed) this.onAccess({ kind: access, message });
      return;
    }
    if (access === "changed" && !this.closed) {
      // The office role changed: come back at once with the new one.
      this.attempt = 0;
      this.stores.connection.getState().set({ status: "reconnecting", attempt: 0 });
      void this.connect();
      return;
    }
    if (this.closed || isConsentedClose(code)) {
      this.stores.connection.getState().set({ status: "disconnected", lastError: reason ?? null });
      return;
    }
    this.scheduleBuildingRetry(new Error(reason ?? `building room closed (${code})`));
  }

  private scheduleBuildingRetry(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (this.closed) return;
    if (this.attempt >= this.maxAttempts) {
      this.stores.connection.getState().set({ status: "failed", lastError: message });
      return;
    }
    const delay = backoffDelay(this.attempt, this.backoff, this.random);
    this.attempt += 1;
    this.stores.connection.getState().set({
      status: "reconnecting",
      attempt: this.attempt,
      lastError: message,
    });
    this.cancelBuildingRetry = this.schedule(() => void this.connect(), delay);
  }
}
