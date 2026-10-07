/**
 * BuildingRoom (SPEC §6 channel 1): one per office. Human presence, chat,
 * the operation list with counters, the office usage summary (#40), the lobby
 * jukebox and its clock-sync pings (#47), emotes, seats and `doing` (#49,
 * rules in social.ts), who has the lounge TV (#48, screen-share.ts). PM state is part of the schema but stays at its
 * defaults until its milestone.
 *
 * The state is per viewer (D26, D27; #270): rooms, levels, people and the
 * usage leaderboard reach a client only as far as that person's own GitHub
 * access goes (viewers.ts), and commands are checked against the same answer.
 *
 * Written against `RoomDefinition`, not Colyseus; see ../transport.ts.
 */
import {
  type AvatarAnimation,
  BuildingJoinOptions,
  BuildingStateSchema,
  type ChatMessage,
  type ClientCommand,
  COMMAND_REJECTED_MESSAGE,
  type CommandRejected,
  EMOTE_MS,
  type GeniusLookValue,
  HumanPresenceSchema,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  OperationSummarySchema,
  type UsageSummary,
} from "@regulus/protocol";
import {
  applyCompoundState,
  applyLevels,
  applyRoomFields,
  type CompoundSnapshot,
} from "../../compound/room-state.ts";
import type { JukeboxPlayer } from "../../jukebox/player.ts";
import type { Logger } from "../../logging.ts";
import type { LairView } from "../../operations/access.ts";
import { applyUsageSummary, type OfficeUsage } from "../../usage/room-state.ts";
import type { RoomAuthUser } from "../auth.ts";
import { CHAT_REPLAY, type ChatStore } from "../chat/store.ts";
import type { RoomClient, RoomDefinition, RoomHandle } from "../transport.ts";
import { type BlastDoorOptions, createBlastDoor } from "./blast-door.ts";
import { applyClosedRooms } from "./closed-rooms.ts";
import { checkCommand, wrapHeading } from "./commands.ts";
import { levelOfGo, returnToAllowedPlaces } from "./levels.ts";
import { applyLobbyCommand } from "./lobby-commands.ts";
import {
  applyOperationRecord,
  isKnownOperation,
  type OperationRecord,
  type OperationSource,
} from "./operations.ts";
import { RateLimiter } from "./rate-limiter.ts";
import { applyLook, chatLine } from "./schema-copy.ts";
import { createScreenShareRules, type ScreenShareRules } from "./screen-share.ts";
import { createSocialRules } from "./social.ts";
import { createViewers } from "./viewers.ts";

export type BuildingState = InstanceType<typeof BuildingStateSchema>;
type Human = InstanceType<typeof HumanPresenceSchema>;

/** Maximum accepted `move` rate per client (SPEC research 01 §2: 10-20 Hz). */
export const MOVE_MAX_HZ = 20;
/** Milliseconds between state patches (~20 Hz). */
export const PATCH_RATE_MS = 50;
/** A walking avatar goes idle this long after its last move. */
export const WALK_IDLE_MS = 400;
/** A `move` this close (metres) to where the human already is keeps them seated (heading only). */
const STILL_EPSILON = 0.01;
/** Animation bookkeeping sweep period. */
const SWEEP_MS = 100;

export interface BuildingRoomDeps {
  chat: ChatStore;
  operations: OperationSource;
  logger: Logger;
  now?: () => number;
  /**
   * What this person may see of the lair: the rooms they may enter and the
   * levels they reach (operations/access.ts `lairViewFor`). Required: there
   * is no default that shows anything.
   */
  lairView(user: RoomAuthUser): LairView;
  /** The lobby's blast door (#188): open time and the audit of presses. */
  blastDoor?: BlastDoorOptions;
  /** The lobby jukebox (#47): playhead, queue and permissions; absent = refused. */
  jukebox?: JukeboxPlayer;
  /** The lounge TV (#48); absent = media off, `screen.share.start` refused. */
  screenShare?: ScreenShareRules;
}

export interface BuildingRoom extends RoomDefinition<BuildingState, BuildingJoinOptions> {
  /** Re-read operations and henchman counters from the source into room state. */
  refreshOperations(): Promise<void>;
  /** Send a message to every connected client of one human (notifications, #42). */
  sendToUser(userId: string, type: string, payload: unknown): void;
  /**
   * A person's access changed (GitHub snapshot, role, member row): their view of
   * rooms, levels and people is worked out again, and they are walked back to
   * the lobby from a room or level they may no longer be in.
   */
  accessChanged(userId?: string): void;
  /** Office usage totals and leaderboard for the usage wall (#40); never per-human data. */
  setUsage(summary: UsageSummary | OfficeUsage): void;
  /** A human picked a new genius (#185): every one of their presences shows it at once. */
  setAvatar(userId: string, look: GeniusLookValue): void;
  /** Compound layout and each room's placement and build state (#181). */
  setCompound(snapshot: CompoundSnapshot): void;
  /** The lobby whiteboard has a new wall snapshot (#45). */
  setLobbyWhiteboard(version: number): void;
  /** Whose connected session this is (media tokens, #48); null when it is not connected. */
  presence(sessionId: string): { userId: string } | null;
  /** A chat line from the office itself (an office agent's `post_chat` tool, #271). */
  postChat(line: { userId: string; displayName: string; operationId: string; text: string }): void;
}

interface ClientBookkeeping {
  lastMoveAt: number;
  emoteUntil: number;
}

export function createBuildingRoom(deps: BuildingRoomDeps): BuildingRoom {
  const { chat, operations: operationSource, logger } = deps;
  const now = deps.now ?? (() => Date.now());
  const moveLimiter = new RateLimiter({ maxHz: MOVE_MAX_HZ, now: () => performance.now() });
  const books = new Map<string, ClientBookkeeping>();
  const viewers = createViewers({ lairView: deps.lairView });
  const canVisit = (user: RoomAuthUser, operationId: string) =>
    viewers.viewOf(user).rooms.has(operationId);
  const social = createSocialRules({ now, canVisit });
  let known: OperationRecord[] = [];
  let usage: UsageSummary | OfficeUsage | undefined;
  let compound: CompoundSnapshot | undefined;
  let lobbyWhiteboard = 0;
  let handle: RoomHandle<BuildingState> | undefined;
  const blastDoor = createBlastDoor(deps.blastDoor ?? {}, now);
  const lobbyDeps = {
    jukebox: deps.jukebox,
    screen: deps.screenShare ?? createScreenShareRules({ enabled: false }),
    now,
  };

  const reject = (client: RoomClient, type: string, reason: string) => {
    const notice: CommandRejected = { type, reason };
    client.send(COMMAND_REJECTED_MESSAGE, notice);
  };

  const humanOf = (client: RoomClient): Human | undefined =>
    handle?.state.humans.get(client.sessionId);

  const recountHumans = () => {
    if (!handle) return;
    const counts = new Map<string, number>();
    handle.state.humans.forEach((h) =>
      counts.set(h.operationId, (counts.get(h.operationId) ?? 0) + 1),
    );
    handle.state.operations.forEach((f) => {
      const n = counts.get(f.operationId) ?? 0;
      if (f.humansPresent !== n) f.humansPresent = n;
    });
  };

  const refreshOperations = async () => {
    known = await operationSource.listOperations();
    if (!handle) return;
    const seen = new Set<string>();
    for (const f of known) {
      seen.add(f.operationId);
      const entry = handle.state.operations.get(f.operationId) ?? new OperationSummarySchema();
      applyOperationRecord(entry, f);
      applyRoomFields(entry, compound?.rooms.get(f.operationId));
      if (!handle.state.operations.has(f.operationId))
        handle.state.operations.set(f.operationId, entry);
    }
    for (const id of [...handle.state.operations.keys()])
      if (!seen.has(id)) handle.state.operations.delete(id);
    applyClosedRooms(handle.state.closedRooms, known, compound);
    reconsider();
  };

  /** Rooms, levels or someone's access changed: everyone's view is worked out again. */
  const reconsider = (userId?: string) => {
    viewers.forget(userId);
    if (!handle) return;
    const clients = new Map(handle.clients.map((c) => [c.sessionId, c]));
    returnToAllowedPlaces(handle.state.humans, (sessionId) => {
      const client = clients.get(sessionId);
      return client ? viewers.viewOf(client.user) : undefined;
    });
    recountHumans();
    viewers.sync(handle);
  };

  const publishUsage = () => {
    if (!handle || !usage) return;
    const rooms = "henchmanRooms" in usage ? usage.henchmanRooms : {};
    applyUsageSummary(handle.state.usage, usage, (row, agentId) => {
      const room = rooms[agentId];
      if (room !== undefined) viewers.tagRow(row, room);
    });
    viewers.sync(handle);
  };

  const setAnimation = (human: Human, animation: AvatarAnimation) => {
    if (human.animation !== animation) human.animation = animation;
  };

  const restingAnimation = (human: Human): AvatarAnimation => (human.seatId ? "sit_idle" : "idle");

  const sweep = () => {
    if (!handle) return;
    blastDoor.tick(handle.state.blastDoor);
    deps.jukebox?.tick(handle.state.jukebox);
    const t = now();
    handle.state.humans.forEach((human, sessionId) => {
      const book = books.get(sessionId);
      if (!book) return;
      if (book.emoteUntil > 0) {
        if (t >= book.emoteUntil) {
          book.emoteUntil = 0;
          setAnimation(human, restingAnimation(human));
        }
        return;
      }
      if (human.animation === "walk" && t - book.lastMoveAt >= WALK_IDLE_MS) {
        setAnimation(human, restingAnimation(human));
      }
    });
  };

  const apply = (room: RoomHandle<BuildingState>, client: RoomClient, command: ClientCommand) => {
    const human = humanOf(client);
    const book = books.get(client.sessionId);
    if (!human || !book) return;
    switch (command.type) {
      case "move": {
        if (!moveLimiter.allow(client.sessionId)) return; // dropped, not an error
        const moved = human.position.x !== command.x || human.position.z !== command.z;
        const away =
          Math.hypot(human.position.x - command.x, human.position.z - command.z) > STILL_EPSILON;
        human.position.x = command.x;
        human.position.z = command.z;
        human.position.heading = wrapHeading(command.heading);
        book.lastMoveAt = now();
        // Walking off stands the human up; turning in the seat does not.
        if (human.seatId && away) human.seatId = "";
        if (book.emoteUntil === 0) setAnimation(human, moved ? "walk" : "idle");
        return;
      }
      case "sit": {
        const key = command.seatId ?? "";
        if (key && key !== human.seatId) {
          const check = social.checkSit(
            room.state,
            room.state.humans,
            client.sessionId,
            client.user,
            key,
          );
          if (!check.ok) {
            reject(client, command.type, check.reason);
            return;
          }
        }
        if (human.seatId !== key) human.seatId = key;
        book.emoteUntil = 0;
        setAnimation(human, restingAnimation(human));
        return;
      }
      case "emote": {
        if (!social.allowEmote(client.sessionId)) {
          reject(client, command.type, "one emote at a time");
          return;
        }
        book.emoteUntil = now() + EMOTE_MS;
        setAnimation(human, command.emote);
        return;
      }
      case "chat": {
        if (!social.allowChat(client.sessionId)) {
          reject(client, command.type, "You are sending messages too fast. Wait a moment.");
          return;
        }
        const line: ChatMessage = {
          id: crypto.randomUUID(),
          userId: human.userId,
          displayName: human.displayName,
          operationId: human.operationId,
          text: command.text,
          ts: now(),
        };
        // Everyone reads the lobby chat: which room the sender stood in is not published.
        room.state.chat.push(chatLine({ ...line, operationId: "" }));
        while (room.state.chat.length > CHAT_REPLAY) room.state.chat.shift();
        chat.append(line).catch((err) => logger.error({ err }, "chat persistence failed"));
        return;
      }
      case "doing": {
        if (!social.allowDoing(client.sessionId)) return; // dropped, the next one carries it
        if (human.doing !== command.doing) human.doing = command.doing;
        return;
      }
      case "operation.go": {
        // One answer for "no such room" and "not your room": a refusal names nothing.
        if (
          !isKnownOperation(command.operationId, known) ||
          (command.operationId !== LOBBY_OPERATION_ID &&
            !canVisit(client.user, command.operationId))
        ) {
          reject(client, command.type, `unknown operation ${command.operationId}`);
          return;
        }
        // A project room is on one level; the lobby id means "in no project room" on
        // the level the client names (or the one the human is on already).
        const levelId = levelOfGo(
          known,
          compound,
          command.operationId,
          command.levelId,
          human.levelId,
        );
        // A level the person cannot reach is, to them, not there (D26).
        if (levelId === null || !viewers.viewOf(client.user).levels.has(levelId)) {
          reject(client, command.type, `unknown level ${command.levelId}`);
          return;
        }
        if (human.operationId !== command.operationId || human.levelId !== levelId) {
          human.operationId = command.operationId;
          human.levelId = levelId;
          human.seatId = "";
          setAnimation(human, "idle");
          recountHumans();
          // Who sees this person depends on where they are.
          viewers.sync(room);
        }
        return;
      }
      case "blast_door.press": {
        const result = blastDoor.press(
          room.state.blastDoor,
          { userId: human.userId, displayName: human.displayName },
          human.position,
          compound?.state,
        );
        if (!result.ok) reject(client, command.type, result.reason);
        else logger.info(result.press, "blast door pressed");
        return;
      }
      default: {
        const lobby = applyLobbyCommand(lobbyDeps, room.state, client, command);
        if (!lobby.handled) reject(client, command.type, "not handled by the building room");
        else if (lobby.reason) reject(client, command.type, lobby.reason);
      }
    }
  };

  return {
    createState: () => new BuildingStateSchema(),
    patchRateMs: PATCH_RATE_MS,
    parseJoinOptions: (options) => BuildingJoinOptions.parse(options ?? {}),

    async onCreate(room) {
      handle = room;
      await refreshOperations();
      for (const line of await chat.recent(CHAT_REPLAY))
        room.state.chat.push(chatLine({ ...line, operationId: "" }));
      publishUsage();
      if (compound) {
        applyCompoundState(room.state.compound, compound.state);
        applyLevels(room.state.levels, compound);
        applyClosedRooms(room.state.closedRooms, known, compound);
      }
      deps.jukebox?.restore(room.state.jukebox);
      room.state.lobbyWhiteboardVersion = lobbyWhiteboard;
      room.setInterval(sweep, SWEEP_MS);
      logger.info({ roomId: room.roomId, operations: known.length }, "building room created");
    },

    onJoin(room, client) {
      const human = new HumanPresenceSchema();
      human.sessionId = client.sessionId;
      human.userId = client.user.userId;
      human.displayName = client.user.displayName;
      human.role = client.user.role;
      applyLook(human, client.user.avatar);
      human.operationId = LOBBY_OPERATION_ID;
      human.levelId = LOBBY_LEVEL_ID;
      human.animation = "idle";
      human.joinedAt = now();
      room.state.humans.set(client.sessionId, human);
      books.set(client.sessionId, { lastMoveAt: 0, emoteUntil: 0 });
      recountHumans();
      // A join asks the gate afresh: what this person may see, and who sees them.
      viewers.forget(client.user.userId);
      viewers.sync(room);
      logger.info({ sessionId: client.sessionId, userId: client.user.userId }, "human joined");
    },

    onLeave(room, client) {
      room.state.humans.delete(client.sessionId);
      books.delete(client.sessionId);
      moveLimiter.forget(client.sessionId);
      social.forget(client.sessionId);
      viewers.drop(client.sessionId);
      recountHumans();
      viewers.sync(room);
      logger.info({ sessionId: client.sessionId, userId: client.user.userId }, "human left");
    },

    onMessage(room, client, type, payload) {
      const check = checkCommand(type, payload);
      if (!check.ok) {
        reject(client, type, check.reason);
        return;
      }
      apply(room, client, check.command);
    },

    onDispose() {
      handle = undefined;
      books.clear();
      viewers.clear();
    },

    refreshOperations,

    accessChanged: (userId) => reconsider(userId),

    sendToUser(userId, type, payload) {
      for (const client of handle?.clients ?? []) {
        if (client.user.userId === userId) client.send(type, payload);
      }
    },

    setAvatar(userId, look) {
      for (const client of handle?.clients ?? []) {
        if (client.user.userId !== userId) continue;
        // Later joins of this connection's user read the stored profile; keep this one current too.
        client.user.avatar = look;
        const human = humanOf(client);
        if (human) applyLook(human, look);
      }
    },

    setUsage(summary) {
      usage = summary;
      publishUsage();
    },

    presence(sessionId) {
      const human = handle?.state.humans.get(sessionId);
      return human ? { userId: human.userId } : null;
    },

    postChat(line) {
      const message: ChatMessage = { id: crypto.randomUUID(), ...line, ts: now() };
      if (handle) {
        handle.state.chat.push(chatLine({ ...message, operationId: "" }));
        while (handle.state.chat.length > CHAT_REPLAY) handle.state.chat.shift();
      }
      chat.append(message).catch((err) => logger.error({ err }, "chat persistence failed"));
    },

    setLobbyWhiteboard(version) {
      lobbyWhiteboard = version;
      if (handle) handle.state.lobbyWhiteboardVersion = version;
    },

    setCompound(snapshot) {
      compound = snapshot;
      if (!handle) return;
      applyCompoundState(handle.state.compound, snapshot.state);
      applyLevels(handle.state.levels, snapshot);
      handle.state.operations.forEach((entry, operationId) =>
        applyRoomFields(entry, snapshot.rooms.get(operationId)),
      );
      applyClosedRooms(handle.state.closedRooms, known, snapshot);
      reconsider();
    },
  };
}
