/**
 * FloorRoom (SPEC §6 channel 2): one instance per floor, selected by the
 * `floorId` join option. Joining needs a session (the transport's RoomAuth)
 * and at least `view` access to the live floor. State is the protocol
 * `FloorState`: floor metadata, repos, desks from the layout template,
 * robots published through {@link FloorRooms}, decor (empty until M2).
 * `agent.spawn` and the robot controls (agent-commands.ts) are validated with
 * the protocol schema and forwarded to the AgentManager (`setAgentCommands`);
 * failures come back as `command.rejected`, results as `agent.result`.
 * Pending permission requests go only to the robot's controllers
 * (permissions.ts, SPEC §8 rule 4).
 *
 * The returned {@link FloorRooms} is also the registry the AgentManager
 * (#26) uses: `publishRobot(floorId, robot)` / `removeRobot(floorId, id)`.
 * Robots are kept per floor even while nobody is on it, and copied into the
 * room when it is (re)created.
 */
import {
  type ClientCommand,
  COMMAND_REJECTED_MESSAGE,
  FloorJoinOptions,
  FloorStateSchema,
  type PendingPermission,
  parseClientCommand,
  RobotState,
} from "@regulus/protocol";
import type { Logger } from "../../logging.ts";
import type { RoomClient, RoomDefinition, RoomHandle } from "../transport.ts";
import {
  type AgentActor,
  type AgentControlCommand,
  type AgentControlOutcome,
  handleAgentControl,
  isAgentControl,
  rejection as reject,
} from "./agent-commands.ts";
import { FloorPermissions } from "./permissions.ts";
import type { FloorRoomSource } from "./source.ts";
import { type FloorRoomState, syncRobots, writeSnapshot } from "./state.ts";

/** Close code for "this floor is gone" (archived); clients treat it as final. */
export const FLOOR_CLOSED_CODE = 4000;
/** Patch rate: robots change a few times a second at most. */
export const FLOOR_PATCH_RATE_MS = 100;

export type SpawnCommand = Extract<ClientCommand, { type: "agent.spawn" }>;

/** Agent commands the FloorRoom forwards (implemented by the AgentManager, #26). */
export interface FloorAgentCommands {
  spawn(
    actor: AgentActor,
    command: SpawnCommand,
  ): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** prompt / approve / interrupt / stop / resume / sendHome / pr / worktree. */
  control?(actor: AgentActor, command: AgentControlCommand): Promise<AgentControlOutcome>;
}

export type {
  AgentControlCommand,
  AgentControlOutcome,
  AgentControlType,
} from "./agent-commands.ts";

export interface FloorRooms {
  /** Room definition to register under `ROOM_NAMES.floor`. */
  readonly definition: RoomDefinition<FloorRoomState, FloorJoinOptions>;
  /** Add or update a robot on a floor (validated against the protocol shape). */
  publishRobot(floorId: string, robot: RobotState): void;
  removeRobot(floorId: string, agentId: string): void;
  /** A robot's pending permission requests, delivered to its controllers only. */
  publishPermissions(
    floorId: string,
    agentId: string,
    ownerUserId: string,
    requests: PendingPermission[],
  ): void;
  /** Robots currently published on a floor. */
  robotsOn(floorId: string): RobotState[];
  /** Re-read the floor (name, repos, desks); closes the room if it was archived. */
  refreshFloor(floorId: string): void;
  /** Floor ids with a live room instance. */
  liveFloorIds(): string[];
  /** Route `agent.spawn` (and later agent commands) to the AgentManager. */
  setAgentCommands(commands: FloorAgentCommands | undefined): void;
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

  const permissions = new FloorPermissions();
  const clientsOn = (floorId: string) => live.get(floorId)?.clients ?? [];
  let agentCommands: FloorAgentCommands | undefined;

  const spawn = (floorId: string, client: RoomClient, command: SpawnCommand) => {
    if (command.floorId !== floorId) {
      client.send(COMMAND_REJECTED_MESSAGE, reject(command.type, "wrong floor"));
      return;
    }
    if (!agentCommands) {
      client.send(COMMAND_REJECTED_MESSAGE, reject(command.type, "agents are not available"));
      return;
    }
    const actor = { id: client.user.userId, role: client.user.role };
    agentCommands
      .spawn(actor, command)
      .then((result) => {
        if (!result.ok) client.send(COMMAND_REJECTED_MESSAGE, reject(command.type, result.reason));
      })
      .catch((err) => {
        logger.error({ err }, "agent.spawn failed");
        client.send(COMMAND_REJECTED_MESSAGE, reject(command.type, "internal error"));
      });
  };

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
      permissions.sendOpen(room.state.floorId, client);
    },

    onMessage(room, client, type, payload) {
      const parsed = parseClientCommand(type, payload);
      if (parsed.success && parsed.data.type === "agent.spawn") {
        spawn(room.state.floorId, client, parsed.data);
        return;
      }
      if (parsed.success && isAgentControl(parsed.data)) {
        const floorId = room.state.floorId;
        handleAgentControl(
          {
            floorId,
            client,
            robot: robots.get(floorId)?.get(parsed.data.agentId),
            control: agentCommands?.control?.bind(agentCommands),
            broadcast: (t, p) => room.broadcast(t, p),
            logger,
          },
          parsed.data,
        );
        return;
      }
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
      permissions.drop(floorId, agentId, clientsOn(floorId));
      if (robots.get(floorId)?.delete(agentId)) sync(floorId);
    },

    publishPermissions(floorId, agentId, ownerUserId, requests) {
      permissions.set(floorId, agentId, ownerUserId, requests, clientsOn(floorId));
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

    setAgentCommands(commands) {
      agentCommands = commands;
    },
  };
}
