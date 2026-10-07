/**
 * RoomTransport: the small networking seam from SPEC §4.2. Rooms are written
 * against these interfaces only; `./colyseus` implements them with Colyseus
 * on the Bun WebSocket transport, and docs/adr/0002-room-transport.md
 * describes how a raw Bun WebSocket implementation would replace it.
 */
import type { Server } from "bun";
import type { RoomAuthUser } from "./auth.ts";

/** A connected, authenticated client as seen by a room definition. */
export interface RoomClient {
  readonly sessionId: string;
  readonly user: RoomAuthUser;
  /** Send a typed message to this client only. */
  send(type: string, payload?: unknown): void;
  /** Disconnect this client; `code` is a WebSocket close code. */
  leave(code?: number): void;
}

/** What a room definition can do with the live room instance. */
export interface RoomHandle<S extends object> {
  readonly roomId: string;
  readonly roomName: string;
  /** Shared, delta-synchronised state. Mutate in place. */
  readonly state: S;
  readonly clients: readonly RoomClient[];
  broadcast(type: string, payload?: unknown, options?: { except?: RoomClient }): void;
  /** Room-scoped interval, cleared when the room is disposed. Returns a cancel function. */
  setInterval(handler: () => void, ms: number): () => void;
}

/**
 * A room type. Lifecycle hooks mirror what every real-time framework
 * offers (create/join/leave/message/dispose) so the definition does not
 * depend on Colyseus.
 */
export interface RoomDefinition<S extends object, J = unknown> {
  /** Builds the initial state for a new room instance. */
  createState(): S;
  /** Milliseconds between state patches. Default 50 (20 Hz). */
  patchRateMs?: number;
  /** Maximum concurrent clients; unlimited when omitted. */
  maxClients?: number;
  /** Validates join options; a thrown error rejects the join before `onJoin`. */
  parseJoinOptions?(options: unknown): J;
  /**
   * Join options that select a room instance: a join goes to the live
   * instance created with the same values, or creates one (e.g. one OperationRoom
   * per `operationId`). Without it every join shares one instance.
   */
  filterBy?: readonly (keyof J & string)[];
  /**
   * Authorises an authenticated user for these (parsed) options before a seat
   * is reserved; `false` rejects the join with 403.
   */
  authorize?(user: RoomAuthUser, options: J): boolean | Promise<boolean>;
  /**
   * The operation a seat joined with these options shows, for live access
   * (#244): when the human loses that operation the seat is closed. Omit for
   * office-wide rooms.
   */
  operationOf?(options: J): string | null;
  /** `options` are the parsed join options of the join that created the instance. */
  onCreate?(room: RoomHandle<S>, options: J): void | Promise<void>;
  onJoin?(room: RoomHandle<S>, client: RoomClient, options: J): void | Promise<void>;
  onLeave?(room: RoomHandle<S>, client: RoomClient, code: number): void | Promise<void>;
  /** Called for every client message; `payload` is untrusted and must be validated. */
  onMessage?(room: RoomHandle<S>, client: RoomClient, type: string, payload: unknown): void;
  onDispose?(room: RoomHandle<S>): void | Promise<void>;
}

/** Returned by `HttpAttachment.fetch` when the request was upgraded to a WebSocket. */
export const UPGRADED: unique symbol = Symbol("upgraded");

/**
 * The hooks a transport needs inside the office's `Bun.serve` (there is only
 * one listening socket, SPEC §4.1). `fetch` returns a `Response` for requests
 * it owns (matchmaking), `UPGRADED` once it has taken over the connection,
 * or `undefined` to let the HTTP router handle the request.
 */
export interface HttpAttachment {
  fetch(
    request: Request,
    url: URL,
    server: Server<unknown>,
  ): Promise<Response | typeof UPGRADED | undefined>;
  websocket: import("bun").WebSocketHandler<unknown>;
}

export interface RoomTransport {
  /** Register a room type under `name`; instances are created on first join. */
  defineRoom<S extends object, J>(name: string, definition: RoomDefinition<S, J>): void;
  /** Start accepting joins. Rooms must be defined first. */
  listen(): Promise<void>;
  /** Handlers to plug into the office `Bun.serve`; available before `listen()`. */
  readonly attachment: HttpAttachment;
  /** Send a message to every client of every live instance of `roomName`. */
  broadcast(roomName: string, type: string, payload?: unknown): void;
  /** Disconnect every client and dispose every room. */
  shutdown(): Promise<void>;
}
