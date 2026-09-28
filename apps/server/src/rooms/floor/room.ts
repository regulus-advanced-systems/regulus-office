/**
 * FloorRoom (SPEC §6 channel 2): one instance per floor, selected by the
 * `floorId` join option. Joining needs a session (the transport's RoomAuth)
 * and at least `view` access to the live floor. State is the protocol
 * `FloorState`: floor metadata, repos, desks from the layout template,
 * robots published through {@link FloorRooms}, decor (empty until M2).
 *
 * The returned {@link FloorRooms} is also the registry the AgentManager
 * (#26) uses: `publishRobot(floorId, robot)` / `removeRobot(floorId, id)`.
 * Robots are kept per floor even while nobody is on it, and copied into the
 * room when it is (re)created.
 */
import {
  COMMAND_REJECTED_MESSAGE,
  type CommandRejected,
  FloorJoinOptions,
  FloorStateSchema,
  parseClientCommand,
  RobotState,
} from "@regulus/protocol";
import type { Logger } from "../../logging.ts";
import type { RoomDefinition, RoomHandle } from "../transport.ts";
import type { FloorRoomSource } from "./source.ts";
import { type FloorRoomState, syncRobots, writeSnapshot } from "./state.ts";

/** Close code for "this floor is gone" (archived); clients treat it as final. */
export const FLOOR_CLOSED_CODE = 4000;
/** Patch rate: robots change a few times a second at most. */
export const FLOOR_PATCH_RATE_MS = 100;

export interface FloorRooms {
  /** Room definition to register under `ROOM_NAMES.floor`. */
  readonly definition: RoomDefinition<FloorRoomState, FloorJoinOptions>;
  /** Add or update a robot on a floor (validated against the protocol shape). */
  publishRobot(floorId: string, robot: RobotState): void;
  removeRobot(floorId: string, agentId: string): void;
  /** Robots currently published on a floor. */
  robotsOn(floorId: string): RobotState[];
  /** Re-read the floor (name, repos, desks); closes the room if it was archived. */
  refreshFloor(floorId: string): void;
  /** Floor ids with a live room instance. */
  liveFloorIds(): string[];
}

export interface FloorRoomsDeps {
  source: FloorRoomSource;
  logger: Logger;
}

export function createFloorRooms(deps: FloorRoomsDeps): FloorRooms {
  const { source, logger } = deps;
  const live = new Map<string, RoomHandle<FloorRoomState>>();
  const robots = new Map<string, Map<string, RobotState>>();

  const robotsFor = (floorId: string) => {
    let map = robots.get(floorId);
    if (!map) {
      map = new Map();
      robots.set(floorId, map);
    }
    return map;
  };

  const sync = (floorId: string) => {
    const room = live.get(floorId);
    if (room) syncRobots(room.state, robots.get(floorId) ?? new Map());
  };

  const reject = (type: string, reason: string): CommandRejected => ({ type, reason });

  const definition: RoomDefinition<FloorRoomState, FloorJoinOptions> = {
    createState: () => new FloorStateSchema(),
    patchRateMs: FLOOR_PATCH_RATE_MS,
    filterBy: ["floorId"],
    parseJoinOptions: (options) => FloorJoinOptions.parse(options ?? {}),
    authorize: (user, options) => source.canEnter(user, options.floorId),

    onCreate(room, options) {
      const snap = source.loadFloor(options.floorId);
      if (!snap) throw new Error(`floor ${options.floorId} is not available`);
      writeSnapshot(room.state, snap);
      live.set(snap.floorId, room);
      sync(snap.floorId);
      logger.info({ roomId: room.roomId, floorId: snap.floorId }, "floor room created");
    },

    onJoin(room, client) {
      logger.info(
        { floorId: room.state.floorId, sessionId: client.sessionId, userId: client.user.userId },
        "human entered floor",
      );
    },

    onMessage(_room, client, type, payload) {
      const parsed = parseClientCommand(type, payload);
      const reason = parsed.success
        ? "not handled by the floor room yet"
        : `invalid ${type}: ${parsed.error.issues[0]?.message ?? "malformed"}`;
      client.send(COMMAND_REJECTED_MESSAGE, reject(type, reason));
    },

    onDispose(room) {
      const floorId = room.state.floorId;
      if (live.get(floorId) === room) live.delete(floorId);
    },
  };

  return {
    definition,

    publishRobot(floorId, robot) {
      const parsed = RobotState.parse(robot);
      for (const [otherFloor, map] of robots) {
        if (otherFloor !== floorId && map.delete(parsed.agentId)) sync(otherFloor);
      }
      robotsFor(floorId).set(parsed.agentId, parsed);
      sync(floorId);
    },

    removeRobot(floorId, agentId) {
      if (robots.get(floorId)?.delete(agentId)) sync(floorId);
    },

    robotsOn(floorId) {
      return [...(robots.get(floorId)?.values() ?? [])];
    },

    refreshFloor(floorId) {
      const room = live.get(floorId);
      if (!room) return;
      const snap = source.loadFloor(floorId);
      if (!snap) {
        logger.info({ floorId }, "floor archived; closing its room");
        for (const client of room.clients) client.leave(FLOOR_CLOSED_CODE);
        return;
      }
      writeSnapshot(room.state, snap);
      sync(floorId);
    },

    liveFloorIds: () => [...live.keys()],
  };
}
