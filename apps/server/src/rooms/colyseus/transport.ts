/**
 * `RoomTransport` implemented with Colyseus 0.18 on the embedded Bun
 * WebSocket transport. One instance per process: Colyseus' matchmaker is
 * module-global.
 */
import { Server } from "@colyseus/core";
import type { LiveAccess } from "../../auth/live-access.ts";
import type { OriginPolicy } from "../../auth/origin.ts";
import type { Logger } from "../../logging.ts";
import type { RoomAuth } from "../auth.ts";
import type { HttpAttachment, RoomDefinition, RoomHandle, RoomTransport } from "../transport.ts";
import { EmbeddedBunWebSockets } from "./embedded-transport.ts";
import { createColyseusRoomClass } from "./room-adapter.ts";

export interface ColyseusTransportOptions {
  auth: RoomAuth;
  logger: Logger;
  originPolicy: OriginPolicy;
  /** Ends seats on lost access (#244). */
  liveAccess?: LiveAccess;
  maxPayloadLength?: number;
}

export class ColyseusRoomTransport implements RoomTransport {
  readonly #server: Server;
  readonly #transport: EmbeddedBunWebSockets;
  readonly #auth: RoomAuth;
  readonly #logger: Logger;
  readonly #liveAccess: LiveAccess | undefined;
  readonly #rooms = new Set<string>();
  readonly #live = new Set<RoomHandle<object>>();
  #listening: Promise<void> | undefined;

  constructor(options: ColyseusTransportOptions) {
    this.#auth = options.auth;
    this.#liveAccess = options.liveAccess;
    this.#logger = options.logger.child({ module: "rooms" });
    this.#transport = new EmbeddedBunWebSockets({
      logger: this.#logger,
      originPolicy: options.originPolicy,
      maxPayloadLength: options.maxPayloadLength,
    });
    this.#server = new Server({
      transport: this.#transport,
      // The office lifecycle controller owns signals and shutdown (src/lifecycle.ts).
      gracefullyShutdown: false,
      greet: false,
      logger: colyseusLogger(this.#logger),
    });
  }

  get attachment(): HttpAttachment {
    return this.#transport.attachment;
  }

  defineRoom<S extends object, J>(name: string, definition: RoomDefinition<S, J>): void {
    if (this.#rooms.has(name)) throw new Error(`room already defined: ${name}`);
    this.#rooms.add(name);
    const handler = this.#server.define(
      name,
      createColyseusRoomClass(name, definition, {
        auth: this.#auth,
        logger: this.#logger,
        liveAccess: this.#liveAccess,
        onRoomCreated: (handle) => this.#live.add(handle),
        onRoomDisposed: (handle) => this.#live.delete(handle),
      }),
    );
    if (definition.filterBy?.length) handler.filterBy([...definition.filterBy]);
  }

  listen(): Promise<void> {
    // The port is unused: the embedded transport never opens a socket.
    this.#listening ??= this.#server.listen(0).then(() => {
      this.#logger.info({ rooms: [...this.#rooms] }, "rooms listening");
    });
    return this.#listening;
  }

  broadcast(roomName: string, type: string, payload?: unknown): void {
    for (const room of this.#live) {
      if (room.roomName === roomName) room.broadcast(type, payload);
    }
  }

  /** Live room instances in this process (tests and diagnostics). */
  get liveRooms(): readonly RoomHandle<object>[] {
    return [...this.#live];
  }

  async shutdown(): Promise<void> {
    await this.#server.gracefullyShutdown(false);
    this.#logger.info("rooms stopped");
  }
}

/** Route Colyseus' own log lines through pino at their level. */
function colyseusLogger(logger: Logger) {
  const format = (args: unknown[]) =>
    args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
  return {
    debug: (...args: unknown[]) => logger.debug(format(args)),
    info: (...args: unknown[]) => logger.debug(format(args)),
    warn: (...args: unknown[]) => logger.warn(format(args)),
    error: (...args: unknown[]) => logger.error(format(args)),
    trace: (...args: unknown[]) => logger.trace(format(args)),
  };
}
