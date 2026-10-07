/**
 * Turns a transport-agnostic `RoomDefinition` into a Colyseus `Room` class.
 * Authentication runs in the static `onAuth` during the matchmaking HTTP
 * request, where cookies and headers are available; the resulting user is
 * attached to the client for the lifetime of the session. Each seat is
 * registered with the office's live access (#244): `authorize` is asked again
 * when access changes, and the seat is closed when it says no or when the
 * human's office role is no longer the one the seat was given.
 */
import { type AuthContext, type Client, Room, ServerError } from "@colyseus/core";
import { ACCESS_CLOSE_CODES } from "@regulus/protocol";
import { type LiveAccess, type LiveConnection, sessionRefOf } from "../../auth/live-access.ts";
import type { Logger } from "../../logging.ts";
import type { RoomAuth, RoomAuthUser } from "../auth.ts";
import type { RoomClient, RoomDefinition, RoomHandle } from "../transport.ts";

type AuthedClient = Client<{ auth: RoomAuthUser; userData: RoomClient }>;

export interface RoomAdapterDeps {
  auth: RoomAuth;
  logger: Logger;
  /** Ends seats whose human lost the room, signed out or changed role (#244). */
  liveAccess?: LiveAccess;
  /** Live-instance registry hooks used by `RoomTransport.broadcast`. */
  onRoomCreated?(handle: RoomHandle<object>): void;
  onRoomDisposed?(handle: RoomHandle<object>): void;
}

/** Rebuild a `Request` for `RoomAuth` from the matchmaking auth context. */
export function requestFromContext(context: AuthContext): Request {
  const req: unknown = context.req;
  if (req instanceof Request) return req;
  const host = context.headers.get("host") ?? "localhost";
  return new Request(`http://${host}/`, { headers: context.headers });
}

const AUTH_FAILED = 401;
const FORBIDDEN = 403;
const BAD_OPTIONS = 400;

export function createColyseusRoomClass<S extends object, J>(
  name: string,
  definition: RoomDefinition<S, J>,
  deps: RoomAdapterDeps,
): typeof Room {
  const { auth, logger } = deps;
  const parseOptions = (options: unknown): J => {
    if (!definition.parseJoinOptions) return options as J;
    try {
      return definition.parseJoinOptions(options);
    } catch {
      throw new ServerError(BAD_OPTIONS, "invalid join options");
    }
  };

  class AdaptedRoom extends Room<{ state: S; client: AuthedClient }> {
    static override async onAuth(_token: string, options: unknown, context: AuthContext) {
      const user = await auth.authenticate(requestFromContext(context));
      if (!user) throw new ServerError(AUTH_FAILED, "authentication required");
      if (definition.authorize) {
        const allowed = await definition.authorize(user, parseOptions(options));
        if (!allowed) throw new ServerError(FORBIDDEN, "access denied");
      }
      return user;
    }

    readonly #handle: RoomHandle<S>;
    readonly #wrapped = new Map<string, RoomClient>();
    readonly #released = new Map<string, () => void>();

    constructor() {
      super();
      const room = this;
      this.#handle = {
        get roomId() {
          return room.roomId;
        },
        roomName: name,
        get state() {
          return room.state;
        },
        get clients() {
          return [...room.#wrapped.values()];
        },
        broadcast: (type, payload, options) => {
          const except = options?.except ? room.clients.get(options.except.sessionId) : undefined;
          room.broadcast(type, payload, except ? { except } : undefined);
        },
        setInterval: (handler, ms) => {
          const delayed = room.clock.setInterval(handler, ms);
          return () => delayed.clear();
        },
      };
    }

    override async onCreate(options: unknown): Promise<void> {
      this.setState(definition.createState());
      if (definition.patchRateMs !== undefined) this.setPatchRate(definition.patchRateMs);
      if (definition.maxClients !== undefined) this.maxClients = definition.maxClients;
      this.onMessage("*", (client: AuthedClient, type: string | number, payload: unknown) => {
        const wrapped = this.#wrapped.get(client.sessionId);
        if (!wrapped) return;
        try {
          definition.onMessage?.(this.#handle, wrapped, String(type), payload);
        } catch (err) {
          logger.error({ err, room: name, type }, "room message handler failed");
        }
      });
      await definition.onCreate?.(this.#handle, parseOptions(options));
      deps.onRoomCreated?.(this.#handle);
    }

    override async onJoin(client: AuthedClient, options: unknown): Promise<void> {
      const user = client.auth;
      if (!user) throw new ServerError(AUTH_FAILED, "authentication required");
      const joinOptions = parseOptions(options);
      const wrapped: RoomClient = {
        sessionId: client.sessionId,
        user,
        send: (type, payload) => client.send(type, payload),
        leave: (code) => client.leave(code),
      };
      this.#wrapped.set(client.sessionId, wrapped);
      const release = deps.liveAccess?.register(seat(name, definition, wrapped, joinOptions));
      if (release) this.#released.set(client.sessionId, release);
      await definition.onJoin?.(this.#handle, wrapped, joinOptions);
    }

    override async onLeave(client: AuthedClient, code?: number): Promise<void> {
      const wrapped = this.#wrapped.get(client.sessionId);
      this.#wrapped.delete(client.sessionId);
      this.#released.get(client.sessionId)?.();
      this.#released.delete(client.sessionId);
      if (wrapped) await definition.onLeave?.(this.#handle, wrapped, code ?? 1000);
    }

    override async onDispose(): Promise<void> {
      deps.onRoomDisposed?.(this.#handle);
      await definition.onDispose?.(this.#handle);
    }
  }

  Object.defineProperty(AdaptedRoom, "name", { value: `${name}Room` });
  return AdaptedRoom as unknown as typeof Room;
}

/** The live access entry of one seat: the join's own `authorize`, asked again. */
function seat<S extends object, J>(
  name: string,
  definition: RoomDefinition<S, J>,
  client: RoomClient,
  options: J,
): LiveConnection {
  const { user } = client;
  return {
    kind: `room:${name}`,
    user: { id: user.userId, role: user.role },
    session: sessionRefOf(user),
    operationId: definition.operationOf?.(options) ?? null,
    ref: client.sessionId,
    check: (now) => {
      const allowed = definition.authorize?.({ ...user, role: now.role }, options) ?? true;
      if (allowed === false) return "revoked";
      // An asynchronous rule answers later; the seat goes then.
      if (allowed !== true) {
        void allowed.then((ok) => !ok && client.leave(ACCESS_CLOSE_CODES.revoked));
      }
      // The seat carries the role it was given: commands are authorised with it.
      return now.role === user.role ? "keep" : "changed";
    },
    close: (code) => client.leave(code),
  };
}
