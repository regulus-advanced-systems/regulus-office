/** `RoomTransport` over the Colyseus SDK, decoding state with the shared schema classes. */

import { Client, type Room } from "@colyseus/sdk";
import {
  type BuildingState,
  BuildingStateSchema,
  type ClientCommandPayload,
  type ClientCommandType,
  COMMAND_REJECTED_MESSAGE,
  CommandRejected,
  type FloorState,
  FloorStateSchema,
} from "@regulus/protocol";
import {
  type FloorJoinOptions,
  ROOM_NAMES,
  type RoomHandle,
  type RoomTransport,
  type Unsubscribe,
} from "./transport.ts";

/** Decoded root state: any schema instance; only `toJSON` is needed here. */
type DecodedState = { toJSON(): unknown };

class ColyseusRoomHandle<S, T extends DecodedState> implements RoomHandle<S> {
  constructor(private readonly room: Room<unknown, T>) {}

  get roomId() {
    return this.room.roomId;
  }

  get sessionId() {
    return this.room.sessionId;
  }

  snapshot(): S {
    return this.room.state.toJSON() as S;
  }

  onState(cb: (state: S) => void): Unsubscribe {
    const handler = (state: T) => cb(state.toJSON() as S);
    this.room.onStateChange(handler);
    return () => this.room.onStateChange.remove(handler);
  }

  onDrop(cb: (code: number, reason?: string) => void): Unsubscribe {
    this.room.onDrop(cb);
    return () => this.room.onDrop.remove(cb);
  }

  onReconnect(cb: () => void): Unsubscribe {
    this.room.onReconnect(cb);
    return () => this.room.onReconnect.remove(cb);
  }

  onLeave(cb: (code: number, reason?: string) => void): Unsubscribe {
    this.room.onLeave(cb);
    return () => this.room.onLeave.remove(cb);
  }

  onError(cb: (code: number, message?: string) => void): Unsubscribe {
    this.room.onError(cb);
    return () => this.room.onError.remove(cb);
  }

  onRejected(cb: (notice: CommandRejected) => void): Unsubscribe {
    return this.room.onMessage(COMMAND_REJECTED_MESSAGE, (payload: unknown) => {
      const notice = CommandRejected.safeParse(payload);
      if (notice.success) cb(notice.data);
    });
  }

  send<K extends ClientCommandType>(type: K, payload: ClientCommandPayload<K>): void {
    this.room.send(type, payload);
  }

  async leave(consented = true): Promise<void> {
    await this.room.leave(consented);
  }
}

export class ColyseusTransport implements RoomTransport {
  private readonly client: Client;

  /** `endpoint` is the office-server base URL (http(s) or ws(s)). */
  constructor(endpoint: string) {
    this.client = new Client(endpoint);
  }

  async joinBuilding(): Promise<RoomHandle<BuildingState>> {
    const room = await this.client.joinOrCreate(ROOM_NAMES.building, {}, BuildingStateSchema);
    return new ColyseusRoomHandle<BuildingState, InstanceType<typeof BuildingStateSchema>>(room);
  }

  async joinFloor(options: FloorJoinOptions): Promise<RoomHandle<FloorState>> {
    const room = await this.client.joinOrCreate(ROOM_NAMES.floor, options, FloorStateSchema);
    return new ColyseusRoomHandle<FloorState, InstanceType<typeof FloorStateSchema>>(room);
  }
}
