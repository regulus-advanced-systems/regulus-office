/**
 * OperationRoom (SPEC §6 channel 2): one instance per operation, selected by the
 * `operationId` join option. Joining needs a session (the transport's RoomAuth)
 * and at least `view` access to the live operation. State is the protocol
 * `OperationState`: operation metadata, repos, desks from the layout template,
 * henchmen published through {@link OperationRooms}, decor (empty until M2).
 * `agent.spawn` and the henchman controls (agent-commands.ts) are validated with
 * the protocol schema and forwarded to the AgentManager (`setAgentCommands`);
 * failures come back as `command.rejected`, results as `agent.result`.
 * Pending permission requests go only to the henchman's controllers
 * (permissions.ts, SPEC §8 rule 4). `gong.bang` goes to the merge gong
 * (#43, `setGong`), which rings through `broadcast`.
 *
 * The returned {@link OperationRooms} is also the registry the AgentManager
 * (#26) uses: `publishHenchman(operationId, henchman)` / `removeHenchman(operationId, id)`.
 * Henchmen are kept per operation even while nobody is on it, and copied into the
 * room when it is (re)created. Each henchman is published with the henchman
 * skin the admin's rules give it (#184, `setSkins`), re-resolved whenever
 * the rules change.
 */
import {
  type ClientCommand,
  COMMAND_REJECTED_MESSAGE,
  type HenchmanSkinId,
  HenchmanState,
  OperationJoinOptions,
  OperationStateSchema,
  type PendingPermission,
  parseClientCommand,
  QUEUE_RESULT_MESSAGE,
  type QueueSettings,
  type QueueTask,
  type ServiceState,
  type SkinSubject,
} from "@regulus/protocol";
import type { Logger } from "../../logging.ts";
import { isQueueCommand, type OperationQueueCommands } from "../../queue/commands.ts";
import { syncQueue } from "../../queue/publish.ts";
import type { RoomAuthUser } from "../auth.ts";
import type { RoomClient, RoomDefinition, RoomHandle } from "../transport.ts";
import {
  type AgentActor,
  type AgentControlCommand,
  type AgentControlOutcome,
  handleAgentControl,
  isAgentControl,
  rejection as reject,
} from "./agent-commands.ts";
import { type BoardCards, parseBoard, syncBoard } from "./board.ts";
import { dropCarriedOnLeave, handleCardCommand, isCardCommand } from "./cards.ts";
import { OperationPermissions } from "./permissions.ts";
import { parseServices, syncServices } from "./services.ts";
import type { OperationRoomSource } from "./source.ts";
import { type OperationRoomState, syncHenchmen, writeSnapshot } from "./state.ts";

/** Close code for "this operation is gone" (archived); clients treat it as final. */
export const OPERATION_CLOSED_CODE = 4000;
/** Patch rate: henchmen change a few times a second at most. */
export const OPERATION_PATCH_RATE_MS = 100;

export type SpawnCommand = Extract<ClientCommand, { type: "agent.spawn" }>;

/** Agent commands the OperationRoom forwards (implemented by the AgentManager, #26). */
export interface OperationAgentCommands {
  spawn(
    actor: AgentActor,
    command: SpawnCommand,
  ): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** prompt / approve / interrupt / stop / resume / sendHome / pr / worktree. */
  control?(actor: AgentActor, command: AgentControlCommand): Promise<AgentControlOutcome>;
}

/** The skin a henchman wears under the admin's `skin_rules` (#184; skins/store.ts). */
export type SkinResolver = (subject: SkinSubject) => HenchmanSkinId;

/** The merge gong's manual bang (#43; celebrations/service.ts). */
export interface OperationGong {
  bang(operationId: string, user: RoomAuthUser): { ok: true } | { ok: false; reason: string };
}

export type {
  AgentControlCommand,
  AgentControlOutcome,
  AgentControlType,
} from "./agent-commands.ts";

export interface OperationRooms {
  /** Room definition to register under `ROOM_NAMES.operation`. */
  readonly definition: RoomDefinition<OperationRoomState, OperationJoinOptions>;
  /** Add or update a henchman on an operation (validated against the protocol shape). */
  publishHenchman(operationId: string, henchman: HenchmanState): void;
  removeHenchman(operationId: string, agentId: string): void;
  /** A henchman's pending permission requests, delivered to its controllers only. */
  publishPermissions(
    operationId: string,
    agentId: string,
    ownerUserId: string,
    requests: PendingPermission[],
  ): void;
  /** Henchmen currently published on an operation. */
  henchmenOn(operationId: string): HenchmanState[];
  /** Replace an operation's issue / PR board summaries (#35; validated against the protocol shapes). */
  publishBoard(operationId: string, board: BoardCards): void;
  /** The board last published for an operation. */
  boardOn(operationId: string): BoardCards;
  /** Replace an operation's running apps (#39; validated against the protocol shape). */
  publishServices(operationId: string, services: readonly ServiceState[]): void;
  /** Re-read the operation (name, repos, desks); closes the room if it was archived. */
  refreshOperation(operationId: string): void;
  /** Operation ids with a live room instance. */
  liveOperationIds(): string[];
  /** Route `agent.spawn` (and later agent commands) to the AgentManager. */
  setAgentCommands(commands: OperationAgentCommands | undefined): void;
  /** Replace an operation's task queue and its settings (#37). */
  publishQueue(operationId: string, tasks: readonly QueueTask[], settings: QueueSettings): void;
  /** Route `queue.*` to the task queue (#37). */
  setQueueCommands(commands: OperationQueueCommands | undefined): void;
  /** Send a message to everyone on an operation now; false when nobody is on it. */
  broadcast(operationId: string, type: string, payload: unknown): boolean;
  /** Route `gong.bang` to the merge gong (#43). */
  setGong(gong: OperationGong | undefined): void;
  /** Resolve every henchman's skin with this (rules changed); undefined keeps what was published. */
  setSkins(resolver: SkinResolver | undefined): void;
  /** The operation's whiteboard has a new wall snapshot (#45). */
  publishWhiteboard(operationId: string, version: number): void;
}

export interface OperationRoomsDeps {
  source: OperationRoomSource;
  logger: Logger;
}

export function createOperationRooms(deps: OperationRoomsDeps): OperationRooms {
  const { source, logger } = deps;
  const live = new Map<string, RoomHandle<OperationRoomState>>();
  const henchmen = new Map<string, Map<string, HenchmanState>>();
  const boards = new Map<string, BoardCards>();
  const services = new Map<string, ServiceState[]>();
  const queues = new Map<string, { tasks: readonly QueueTask[]; settings: QueueSettings }>();
  let queueCommands: OperationQueueCommands | undefined;
  let skinFor: SkinResolver | undefined;
  const dressed = (henchman: HenchmanState): HenchmanState =>
    skinFor ? { ...henchman, skin: skinFor({ provider: henchman.provider }) } : henchman;

  const henchmenFor = (operationId: string) => {
    let map = henchmen.get(operationId);
    if (!map) {
      map = new Map();
      henchmen.set(operationId, map);
    }
    return map;
  };

  const sync = (operationId: string) => {
    const room = live.get(operationId);
    if (room) syncHenchmen(room.state, henchmen.get(operationId) ?? new Map());
  };

  const permissions = new OperationPermissions();
  const clientsOn = (operationId: string) => live.get(operationId)?.clients ?? [];
  let agentCommands: OperationAgentCommands | undefined;
  let gong: OperationGong | undefined;

  const spawn = (operationId: string, client: RoomClient, command: SpawnCommand) => {
    if (command.operationId !== operationId) {
      client.send(COMMAND_REJECTED_MESSAGE, reject(command.type, "wrong operation"));
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

  const definition: RoomDefinition<OperationRoomState, OperationJoinOptions> = {
    createState: () => new OperationStateSchema(),
    patchRateMs: OPERATION_PATCH_RATE_MS,
    filterBy: ["operationId"],
    parseJoinOptions: (options) => OperationJoinOptions.parse(options ?? {}),
    authorize: (user, options) => source.canEnter(user, options.operationId),

    onCreate(room, options) {
      const snap = source.loadOperation(options.operationId);
      if (!snap) throw new Error(`operation ${options.operationId} is not available`);
      writeSnapshot(room.state, snap);
      live.set(snap.operationId, room);
      sync(snap.operationId);
      const board = boards.get(snap.operationId);
      if (board) syncBoard(room.state, board);
      const apps = services.get(snap.operationId);
      if (apps) syncServices(room.state, apps);
      const queue = queues.get(snap.operationId);
      if (queue) syncQueue(room.state, queue.tasks, queue.settings);
      logger.info({ roomId: room.roomId, operationId: snap.operationId }, "operation room created");
    },

    onJoin(room, client) {
      logger.info(
        {
          operationId: room.state.operationId,
          sessionId: client.sessionId,
          userId: client.user.userId,
        },
        "human entered operation",
      );
      permissions.sendOpen(room.state.operationId, client);
    },

    onMessage(room, client, type, payload) {
      const parsed = parseClientCommand(type, payload);
      if (parsed.success && parsed.data.type === "agent.spawn") {
        spawn(room.state.operationId, client, parsed.data);
        return;
      }
      if (parsed.success && parsed.data.type === "gong.bang") {
        const verdict = gong?.bang(room.state.operationId, client.user) ?? {
          ok: false as const,
          reason: "the gong is not available",
        };
        if (!verdict.ok) client.send(COMMAND_REJECTED_MESSAGE, reject(type, verdict.reason));
        return;
      }
      if (parsed.success && isCardCommand(parsed.data)) {
        const operationId = room.state.operationId;
        const access = source.accessOf?.(client.user, operationId) ?? null;
        handleCardCommand({ state: room.state, client, access }, parsed.data);
        return;
      }
      if (parsed.success && isQueueCommand(parsed.data)) {
        const actor = { id: client.user.userId, role: client.user.role };
        const outcome = queueCommands?.run(actor, room.state.operationId, parsed.data) ?? {
          ok: false as const,
          reason: "the task queue is not available",
        };
        if (outcome.ok) client.send(QUEUE_RESULT_MESSAGE, outcome.result);
        else client.send(COMMAND_REJECTED_MESSAGE, reject(parsed.data.type, outcome.reason));
        return;
      }
      if (parsed.success && isAgentControl(parsed.data)) {
        const operationId = room.state.operationId;
        handleAgentControl(
          {
            operationId,
            client,
            henchman: henchmen.get(operationId)?.get(parsed.data.agentId),
            control: agentCommands?.control?.bind(agentCommands),
            broadcast: (t, p) => room.broadcast(t, p),
            logger,
          },
          parsed.data,
        );
        return;
      }
      const reason = parsed.success
        ? "not handled by the operation room yet"
        : `invalid ${type}: ${parsed.error.issues[0]?.message ?? "malformed"}`;
      client.send(COMMAND_REJECTED_MESSAGE, reject(type, reason));
    },

    onLeave(room, client) {
      dropCarriedOnLeave(room.state, client.sessionId);
    },

    onDispose(room) {
      const operationId = room.state.operationId;
      if (live.get(operationId) === room) live.delete(operationId);
    },
  };

  return {
    definition,

    publishHenchman(operationId, henchman) {
      const parsed = HenchmanState.parse(henchman);
      for (const [otherOperation, map] of henchmen) {
        if (otherOperation !== operationId && map.delete(parsed.agentId)) sync(otherOperation);
      }
      henchmenFor(operationId).set(parsed.agentId, dressed(parsed));
      sync(operationId);
    },

    removeHenchman(operationId, agentId) {
      permissions.drop(operationId, agentId, clientsOn(operationId));
      if (henchmen.get(operationId)?.delete(agentId)) sync(operationId);
    },

    publishPermissions(operationId, agentId, ownerUserId, requests) {
      permissions.set(operationId, agentId, ownerUserId, requests, clientsOn(operationId));
    },

    henchmenOn(operationId) {
      return [...(henchmen.get(operationId)?.values() ?? [])];
    },

    publishBoard(operationId, board) {
      const parsed = parseBoard(board);
      boards.set(operationId, parsed);
      const room = live.get(operationId);
      if (room) syncBoard(room.state, parsed);
    },

    boardOn: (operationId) => boards.get(operationId) ?? { issues: [], pulls: [] },

    publishServices(operationId, list) {
      const parsed = parseServices(list);
      if (parsed.length > 0) services.set(operationId, parsed);
      else services.delete(operationId);
      const room = live.get(operationId);
      if (room) syncServices(room.state, parsed);
    },

    refreshOperation(operationId) {
      const room = live.get(operationId);
      if (!room) return;
      const snap = source.loadOperation(operationId);
      if (!snap) {
        logger.info({ operationId }, "operation archived; closing its room");
        for (const client of room.clients) client.leave(OPERATION_CLOSED_CODE);
        return;
      }
      writeSnapshot(room.state, snap);
      sync(operationId);
    },

    liveOperationIds: () => [...live.keys()],

    setAgentCommands(commands) {
      agentCommands = commands;
    },

    publishQueue(operationId, tasks, settings) {
      queues.set(operationId, { tasks, settings });
      const room = live.get(operationId);
      if (room) syncQueue(room.state, tasks, settings);
    },

    setQueueCommands(commands) {
      queueCommands = commands;
    },

    broadcast(operationId, type, payload) {
      const room = live.get(operationId);
      if (!room || room.clients.length === 0) return false;
      room.broadcast(type, payload);
      return true;
    },

    setGong(next) {
      gong = next;
    },

    publishWhiteboard(operationId, version) {
      const room = live.get(operationId);
      if (room && room.state.whiteboardVersion !== version) room.state.whiteboardVersion = version;
    },

    setSkins(resolver) {
      skinFor = resolver;
      for (const [operationId, map] of henchmen) {
        for (const [id, henchman] of map) map.set(id, dressed(henchman));
        sync(operationId);
      }
    },
  };
}
