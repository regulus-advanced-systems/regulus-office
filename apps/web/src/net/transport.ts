/**
 * `RoomTransport` (SPEC §4.2): the small interface the client talks to so
 * Colyseus can be swapped for a raw Bun WS fallback. `OfficeClient` only
 * depends on this file; `colyseusTransport.ts` is the production implementation.
 */
import type {
  BuildingState,
  ClientCommandPayload,
  ClientCommandType,
  CommandRejected,
  FloorState,
} from "@regulus/protocol";

/**
 * Room names registered on the server. Not part of packages/protocol yet;
 * the server-side room registration must use the same strings.
 */
export const ROOM_NAMES = { building: "building", floor: "floor" } as const;

/** Options sent with a FloorRoom join (matched by the server via filterBy). */
export interface FloorJoinOptions {
  floorId: string;
}

export type Unsubscribe = () => void;

/** One joined room. `S` is the plain (JSON) shape of the room state. */
export interface RoomHandle<S> {
  readonly roomId: string;
  readonly sessionId: string;
  /** Plain-object copy of the current state. */
  snapshot(): S;
  /** Fires after every state patch with a fresh snapshot. */
  onState(cb: (state: S) => void): Unsubscribe;
  /** Fires when the connection dropped and the transport is retrying by itself. */
  onDrop(cb: (code: number, reason?: string) => void): Unsubscribe;
  /** Fires when a dropped connection was re-established without losing the seat. */
  onReconnect(cb: () => void): Unsubscribe;
  /** Fires once the room is gone for good (consented leave, kick, or retries exhausted). */
  onLeave(cb: (code: number, reason?: string) => void): Unsubscribe;
  onError(cb: (code: number, message?: string) => void): Unsubscribe;
  /** Fires when the server dropped one of our commands (`command.rejected`). */
  onRejected(cb: (notice: CommandRejected) => void): Unsubscribe;
  send<T extends ClientCommandType>(type: T, payload: ClientCommandPayload<T>): void;
  leave(consented?: boolean): Promise<void>;
}

export interface RoomTransport {
  joinBuilding(): Promise<RoomHandle<BuildingState>>;
  joinFloor(options: FloorJoinOptions): Promise<RoomHandle<FloorState>>;
}

/** Colyseus close codes the client must not retry after (shared-types `CloseCode`). */
export const CONSENTED_CLOSE_CODES: ReadonlySet<number> = new Set([1000, 4000]);

export function isConsentedClose(code: number): boolean {
  return CONSENTED_CLOSE_CODES.has(code);
}
