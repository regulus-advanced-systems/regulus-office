/**
 * The BuildingRoom's contract (SPEC §6 channel 1): what it needs, what the
 * rest of the server may ask of it, and its timing constants. room.ts
 * implements it.
 */
import type {
  BuildingJoinOptions,
  BuildingStateSchema,
  GeniusLookValue,
  HumanPresenceSchema,
  UsageSummary,
} from "@regulus/protocol";
import type { CompoundSnapshot } from "../../compound/room-state.ts";
import type { JukeboxPlayer } from "../../jukebox/player.ts";
import type { Logger } from "../../logging.ts";
import type { LairView } from "../../operations/access.ts";
import type { OfficeUsage } from "../../usage/room-state.ts";
import type { RoomAuthUser } from "../auth.ts";
import type { ChatStore } from "../chat/store.ts";
import type { RoomDefinition } from "../transport.ts";
import type { BlastDoorOptions } from "./blast-door.ts";
import type { OperationSource } from "./operations.ts";
import type { ScreenShareRules } from "./screen-share.ts";

export type BuildingState = InstanceType<typeof BuildingStateSchema>;
export type Human = InstanceType<typeof HumanPresenceSchema>;

/** Maximum accepted `move` rate per client (SPEC research 01 §2: 10-20 Hz). */
export const MOVE_MAX_HZ = 20;
/** Milliseconds between state patches (~20 Hz). */
export const PATCH_RATE_MS = 50;
/** A walking avatar goes idle this long after its last move. */
export const WALK_IDLE_MS = 400;
/** A `move` this close (metres) to where the human already is keeps them seated (heading only). */
export const STILL_EPSILON = 0.01;
/** Animation bookkeeping sweep period. */
export const SWEEP_MS = 100;

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

export interface BuildingWorld {
  tick(state: BuildingState, now: number): boolean;
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
  /**
   * Office agents' bodies (#252): stepped in the sweep, they write `state.officeAgents`.
   * `tick` answers true when a body appeared, left, or changed room or level, so the
   * room shows it to the people who may see that place and to nobody else (viewers.ts).
   */
  attachWorld(world: BuildingWorld): void;
  /** A chat line from the office itself (an office agent's `post_chat` tool, #271). */
  postChat(line: { userId: string; displayName: string; operationId: string; text: string }): void;
}
