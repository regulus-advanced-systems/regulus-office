/**
 * Client-side session with the office: always in the BuildingRoom, in at most
 * one FloorRoom (SPEC §6). Patches room state into the zustand stores and
 * re-joins with exponential backoff when a room is lost for a reason we did
 * not consent to. Talks to the server only through `RoomTransport`.
 */
import {
  type BuildingState,
  type ClientCommandPayload,
  type ClientCommandType,
  type CommandRejected,
  type FloorState,
  LOBBY_FLOOR_ID,
} from "@regulus/protocol";
import { useBuildingStore } from "../state/building.ts";
import { useConnectionStore } from "../state/connection.ts";
import { useFloorStore } from "../state/floor.ts";
import { type BackoffOptions, backoffDelay, DEFAULT_BACKOFF } from "./backoff.ts";
import { roomForCommand } from "./commandRouting.ts";
import {
  isConsentedClose,
  type RoomHandle,
  type RoomTransport,
  type Unsubscribe,
} from "./transport.ts";

/** Matchmaking refused the join for authorisation reasons (Colyseus `ServerError.code`). */
function isDenied(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 401 || code === 403;
}

export type RejectionListener = (notice: CommandRejected) => void;

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
  private floor: RoomHandle<FloorState> | null = null;
  private floorHandleId: string | null = null;
  private desiredFloorId: string | null = null;
  private closed = false;
  private attempt = 0;
  private floorAttempt = 0;
  private cancelBuildingRetry: (() => void) | null = null;
  private cancelFloorRetry: (() => void) | null = null;
  private buildingSubs: Unsubscribe[] = [];
  private floorSubs: Unsubscribe[] = [];
  private readonly rejectionListeners = new Set<RejectionListener>();
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
  }

  get status() {
    return this.stores.connection.getState().status;
  }

  get currentFloorId(): string | null {
    return this.floorHandleId;
  }

  /** Join the BuildingRoom (and the desired floor, if any). Safe to call again after `failed`. */
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
    if (this.desiredFloorId) await this.joinFloorNow(this.desiredFloorId);
  }

  /** Leave everything on purpose; no reconnect is attempted. */
  async disconnect(): Promise<void> {
    this.closed = true;
    this.cancelBuildingRetry?.();
    this.cancelFloorRetry?.();
    this.cancelBuildingRetry = this.cancelFloorRetry = null;
    this.attempt = this.floorAttempt = 0;
    await this.dropFloor(true);
    const building = this.building;
    this.unbindBuilding();
    await building?.leave(true).catch(() => undefined);
    this.stores.connection.getState().set({ status: "disconnected", attempt: 0 });
  }

  /** Switch to `floorId`, leaving the previous floor first (exactly one FloorRoom at a time). */
  async goToFloor(floorId: string): Promise<void> {
    this.desiredFloorId = floorId;
    if (this.floorHandleId === floorId) return;
    await this.dropFloor(true);
    this.stores.floor.getState().setFloorId(floorId);
    if (!this.building) return; // joined once the building connection is back
    await this.joinFloorNow(floorId);
  }

  async leaveFloor(): Promise<void> {
    this.desiredFloorId = null;
    await this.dropFloor(true);
  }

  /**
   * Take the elevator (SPEC §9.1): tell the BuildingRoom where we are
   * (`floor.go`, so presence and counters follow) and switch FloorRoom. The
   * lobby is not a FloorRoom; going there just leaves the current floor.
   */
  async rideTo(floorId: string, mode: "ride" | "teleport" = "ride"): Promise<void> {
    if (this.building) this.building.send("floor.go", { floorId, mode });
    if (floorId === LOBBY_FLOOR_ID) await this.leaveFloor();
    else await this.goToFloor(floorId);
  }

  /** Send a typed command to the room that owns it. Throws when that room is not joined. */
  send<T extends ClientCommandType>(type: T, payload: ClientCommandPayload<T>): void {
    const target = roomForCommand(type) === "building" ? this.building : this.floor;
    if (!target) throw new Error(`Cannot send "${type}": ${roomForCommand(type)} room not joined`);
    target.send(type, payload);
  }

  /** Listen for commands the server rejected, from whichever room we are in. */
  onRejected(listener: RejectionListener): Unsubscribe {
    this.rejectionListeners.add(listener);
    return () => this.rejectionListeners.delete(listener);
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
  }

  private unbindBuilding() {
    for (const off of this.buildingSubs) off();
    this.buildingSubs = [];
    this.building = null;
    this.stores.building.getState().clear();
  }

  private onBuildingLeft(code: number, reason?: string) {
    this.unbindBuilding();
    // The floor seat dies with the building session; rejoin both after backoff.
    void this.dropFloor(false);
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

  private async joinFloorNow(floorId: string): Promise<void> {
    this.cancelFloorRetry?.();
    this.cancelFloorRetry = null;
    let handle: RoomHandle<FloorState>;
    try {
      handle = await this.transport.joinFloor({ floorId });
    } catch (err) {
      this.scheduleFloorRetry(floorId, err);
      return;
    }
    if (this.closed || this.desiredFloorId !== floorId || this.floor) {
      await handle.leave(true).catch(() => undefined); // superseded while joining
      return;
    }
    this.floor = handle;
    this.floorHandleId = floorId;
    this.floorAttempt = 0;
    const floor = this.stores.floor.getState();
    floor.apply(handle.snapshot());
    this.floorSubs = [
      handle.onState((state) => floor.apply(state)),
      handle.onLeave((code, reason) => this.onFloorLeft(floorId, code, reason)),
      handle.onRejected(this.emitRejected),
    ];
  }

  private onFloorLeft(floorId: string, code: number, reason?: string) {
    this.unbindFloor();
    if (this.closed || isConsentedClose(code) || this.desiredFloorId !== floorId) return;
    if (!this.building) return; // building retry will bring the floor back
    this.scheduleFloorRetry(floorId, new Error(reason ?? `floor room closed (${code})`));
  }

  private scheduleFloorRetry(floorId: string, err: unknown) {
    if (this.closed || this.desiredFloorId !== floorId) return;
    const message = err instanceof Error ? err.message : String(err);
    if (isDenied(err)) {
      // No access (or the floor is gone): retrying cannot help.
      this.desiredFloorId = null;
      this.stores.floor.getState().clear();
      this.stores.connection.getState().set({ lastError: message });
      return;
    }
    if (this.floorAttempt >= this.maxAttempts) {
      this.stores.connection.getState().set({ lastError: message });
      return;
    }
    const delay = backoffDelay(this.floorAttempt, this.backoff, this.random);
    this.floorAttempt += 1;
    this.stores.connection.getState().set({ lastError: message });
    this.cancelFloorRetry = this.schedule(() => void this.joinFloorNow(floorId), delay);
  }

  private unbindFloor() {
    for (const off of this.floorSubs) off();
    this.floorSubs = [];
    this.floor = null;
    this.floorHandleId = null;
  }

  private async dropFloor(consented: boolean) {
    this.cancelFloorRetry?.();
    this.cancelFloorRetry = null;
    this.floorAttempt = 0;
    const handle = this.floor;
    this.unbindFloor();
    this.stores.floor.getState().clear();
    if (handle) await handle.leave(consented).catch(() => undefined);
  }
}
