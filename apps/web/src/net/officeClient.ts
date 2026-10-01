/**
 * Client-side session with the office: always in the BuildingRoom, and in
 * the FloorRooms of the room the player is in plus up to three nearby
 * visible rooms (SPEC §6, §9.1; #186, floorLinks.ts). Patches room state
 * into the zustand stores (the room the player is in also into the floor
 * store the HUD reads) and re-joins with exponential backoff when a room is
 * lost for a reason we did not consent to. Talks to the server only
 * through `RoomTransport`.
 */
import {
  type BuildingState,
  type ClientCommandPayload,
  type ClientCommandType,
  type CommandRejected,
  LOBBY_FLOOR_ID,
} from "@regulus/protocol";
import { useBuildingStore } from "../state/building.ts";
import { useConnectionStore } from "../state/connection.ts";
import { useFloorStore } from "../state/floor.ts";
import { useRoomsStore } from "../state/rooms.ts";
import { type BackoffOptions, backoffDelay, DEFAULT_BACKOFF } from "./backoff.ts";
import { roomForCommand } from "./commandRouting.ts";
import { FloorLinks } from "./floorLinks.ts";
import {
  isConsentedClose,
  type RoomHandle,
  type RoomTransport,
  type Unsubscribe,
} from "./transport.ts";

export type RejectionListener = (notice: CommandRejected) => void;
export type MessageListener = (payload: unknown) => void;

export type Scheduler = (fn: () => void, delayMs: number) => () => void;

const defaultScheduler: Scheduler = (fn, delayMs) => {
  const id = setTimeout(fn, delayMs);
  return () => clearTimeout(id);
};

export interface OfficeClientOptions {
  transport: RoomTransport;
  stores?: {
    building: typeof useBuildingStore;
    floor: typeof useFloorStore;
    connection: typeof useConnectionStore;
    rooms?: typeof useRoomsStore;
  };
  backoff?: BackoffOptions;
  /** Give up (status `failed`) after this many consecutive failed re-joins. */
  maxAttempts?: number;
  schedule?: Scheduler;
  random?: () => number;
}

export class OfficeClient {
  private readonly transport: RoomTransport;
  private readonly stores: NonNullable<OfficeClientOptions["stores"]>;
  private readonly backoff: BackoffOptions;
  private readonly maxAttempts: number;
  private readonly schedule: Scheduler;
  private readonly random: () => number;

  private building: RoomHandle<BuildingState> | null = null;
  private readonly floors: FloorLinks;
  private readonly rooms: typeof useRoomsStore;
  /** The room the player is in, as last told to the building (`floor.go`). */
  private announcedFloor: string | null = null;
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
      floor: useFloorStore,
      connection: useConnectionStore,
    };
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
    this.maxAttempts = options.maxAttempts ?? 10;
    this.schedule = options.schedule ?? defaultScheduler;
    this.random = options.random ?? Math.random;
    this.rooms = this.stores.rooms ?? useRoomsStore;
    this.floors = new FloorLinks({
      transport: this.transport,
      backoff: this.backoff,
      maxAttempts: this.maxAttempts,
      schedule: this.schedule,
      random: this.random,
      connected: () => this.building !== null,
      onState: (floorId, state) => {
        this.rooms.getState().apply(floorId, state);
        if (floorId === this.floors.primary) this.stores.floor.getState().apply(state);
      },
      onGone: (floorId) => {
        this.rooms.getState().drop(floorId);
        if (floorId === this.floors.primary) {
          const floor = this.stores.floor.getState();
          floor.clear();
          floor.setFloorId(floorId);
        }
      },
      onError: (message) => this.stores.connection.getState().set({ lastError: message }),
      onDenied: (floorId) => {
        if (floorId === this.floors.primary) this.stores.floor.getState().clear();
      },
      onRejected: this.emitRejected,
    });
  }

  get status() {
    return this.stores.connection.getState().status;
  }

  /** The room the player is in, once its FloorRoom is joined. */
  get currentFloorId(): string | null {
    return this.floors.primaryHandle() ? this.floors.primary : null;
  }

  /** Floor ids whose FloorRooms are joined now. */
  get joinedFloorIds(): string[] {
    return this.floors.joined();
  }

  /** Join the BuildingRoom (and the wanted FloorRooms). Safe to call again after `failed`. */
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
    this.announcedFloor = LOBBY_FLOOR_ID;
    if (this.floors.primary) this.announce(this.floors.primary, true);
    await this.floors.rejoin();
  }

  /** Leave everything on purpose; no reconnect is attempted. */
  async disconnect(): Promise<void> {
    this.closed = true;
    this.cancelBuildingRetry?.();
    this.cancelBuildingRetry = null;
    this.attempt = 0;
    this.floors.close();
    await this.floors.dropAll(true);
    this.rooms.getState().clear();
    this.stores.floor.getState().clear();
    const building = this.building;
    this.unbindBuilding();
    await building?.leave(true).catch(() => undefined);
    this.stores.connection.getState().set({ status: "disconnected", attempt: 0 });
  }

  /**
   * Be in the FloorRooms of `current` (the room the player is in; null in
   * the lobby, the corridors and the other special rooms) and of up to
   * three `nearby` rooms (SPEC §9.1); leave every other FloorRoom. The
   * building hears where the player is (`floor.go`) whenever `current` changes.
   */
  async setRooms(current: string | null, nearby: readonly string[] = []): Promise<void> {
    const before = this.floors.primary;
    const floor = this.stores.floor.getState();
    const promise = this.floors.set(current, nearby);
    if (before !== current) {
      // Already joined as a nearby room: the HUD switches at once.
      const joined = current ? this.floors.snapshot(current) : null;
      if (joined) floor.apply(joined);
      else {
        floor.clear();
        floor.setFloorId(current);
      }
      this.announce(current, false);
    }
    await promise;
  }

  /** Be in exactly one FloorRoom (tests and tools); `setRooms` is the general form. */
  async goToFloor(floorId: string): Promise<void> {
    await this.setRooms(floorId, []);
  }

  private announce(floorId: string | null, force: boolean): void {
    const id = floorId ?? LOBBY_FLOOR_ID;
    if (!this.building || (!force && id === this.announcedFloor)) return;
    this.announcedFloor = id;
    this.building.send("floor.go", { floorId: id, mode: "teleport" });
  }

  /** Send a typed command to the room that owns it. Throws when that room is not joined. */
  send<T extends ClientCommandType>(type: T, payload: ClientCommandPayload<T>): void {
    const target =
      roomForCommand(type) === "building" ? this.building : this.floors.primaryHandle();
    if (!target) throw new Error(`Cannot send "${type}": ${roomForCommand(type)} room not joined`);
    target.send(type, payload);
  }

  /** Listen for commands the server rejected, from whichever room we are in. */
  onRejected(listener: RejectionListener): Unsubscribe {
    this.rejectionListeners.add(listener);
    return () => this.rejectionListeners.delete(listener);
  }

  /**
   * Listen for a server→client FloorRoom message (e.g. `agent.permissions`)
   * from the room the player is in, now or later. Payloads are unvalidated.
   */
  onFloorMessage(type: string, listener: MessageListener): Unsubscribe {
    return this.floors.onMessage(type, listener);
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
    this.announcedFloor = null;
    // The floor seats die with the building session; rejoin them after backoff.
    void this.floors.dropAll(false);
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
