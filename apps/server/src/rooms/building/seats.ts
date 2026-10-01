/**
 * Seats humans may take (#49): resolve a seat key (`<roomId>/<seatId>`,
 * protocol social.ts) against the published compound, using the same seat
 * lists the client draws (`@regulus/room-layout` compound/seats.ts): the
 * chairs and couches of the special rooms and the lounge seats of finished
 * project rooms. Desk seats are henchmen's and are never found here. Pure.
 */
import {
  DECOR_STYLES,
  DOOR_SIDES,
  isOneOf,
  LOBBY_OPERATION_ID,
  parseSeatKey,
  SPECIAL_ROOM_KINDS,
} from "@regulus/protocol";
import { projectRoomSeats, type Seat, specialRoomSeats } from "@regulus/room-layout";

/** The slice of the BuildingRoom state a seat lookup reads (schema or plain objects). */
export interface SeatWorld {
  compound: {
    tileMetres: number;
    specialRooms: Iterable<{
      kind: string;
      gridX: number;
      gridY: number;
      width: number;
      depth: number;
    }>;
  };
  operations: {
    get(operationId: string):
      | {
          gridX: number;
          gridY: number;
          width: number;
          depth: number;
          doorSide: string;
          deskCount: number;
          decorStyle: string;
          buildState: string;
        }
      | undefined;
  };
}

export interface SeatSpot {
  /** Operation id of a project room (or the lobby's id), else the special room's kind. */
  roomId: string;
  /** A project room: entering it needs operation access. */
  project: boolean;
  seat: Seat;
  /** The seat point in compound metres. */
  x: number;
  z: number;
}

const isSpecialKind = isOneOf(SPECIAL_ROOM_KINDS);
const isDoorSide = isOneOf(DOOR_SIDES);
const isDecorStyle = isOneOf(DECOR_STYLES);

const spot = (
  roomId: string,
  project: boolean,
  seats: readonly Seat[],
  seatId: string,
  origin: { x: number; z: number },
): SeatSpot | null => {
  const seat = seats.find((s) => s.id === seatId);
  return seat
    ? { roomId, project, seat, x: origin.x + seat.pose.x, z: origin.z + seat.pose.z }
    : null;
};

/** The seat a key names, or null when there is no such human seat in the compound. */
export function findSeat(world: SeatWorld, key: string): SeatSpot | null {
  const parsed = parseSeatKey(key);
  if (!parsed) return null;
  const { roomId, seatId } = parsed;
  const m = world.compound.tileMetres;
  for (const s of world.compound.specialRooms) {
    if (!isSpecialKind(s.kind)) continue;
    const id = s.kind === "lobby" ? LOBBY_OPERATION_ID : s.kind;
    if (id !== roomId) continue;
    const seats = specialRoomSeats(s.kind, s.width * m, s.depth * m);
    return spot(roomId, false, seats, seatId, { x: s.gridX * m, z: s.gridY * m });
  }
  if (roomId === LOBBY_OPERATION_ID) return null;
  const room = world.operations.get(roomId);
  if (!room || room.gridX < 0 || room.width <= 0 || room.buildState !== "ready") return null;
  const { doorSide, decorStyle } = room;
  if (!isDoorSide(doorSide) || !isDecorStyle(decorStyle)) return null;
  const seats = projectRoomSeats({
    width: room.width,
    depth: room.depth,
    doorSide,
    deskCount: room.deskCount,
    decorStyle,
  });
  return spot(roomId, true, seats, seatId, { x: room.gridX * m, z: room.gridY * m });
}
