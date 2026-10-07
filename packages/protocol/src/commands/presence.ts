/**
 * Human presence commands: move, sit, emote, chat, operation.go (SPEC §6),
 * plus `doing` (#49): the free-text status the whereabouts panel shows.
 */
import { z } from "zod";
import { ChatText, Id } from "../common.ts";
import { EMOTES } from "../enums.ts";
import { DOING_MAX } from "../social.ts";

export const MoveCommand = z.object({
  type: z.literal("move"),
  x: z.number().finite(),
  z: z.number().finite(),
  heading: z.number().finite(),
});

/**
 * Sit on a seat; `seatId: null` stands up. The id is a seat key
 * (`<roomId>/<seatId>`, social.ts): a chair or couch seat, never a desk.
 */
export const SitCommand = z.object({
  type: z.literal("sit"),
  seatId: Id.nullable(),
});

export const EmoteCommand = z.object({
  type: z.literal("emote"),
  emote: z.enum(EMOTES),
});

export const ChatCommand = z.object({
  type: z.literal("chat"),
  text: ChatText,
});

/** What the human is doing ("at the boards"), shown in the whereabouts panel; "" clears it. */
export const DoingCommand = z.object({
  type: z.literal("doing"),
  doing: z.string().trim().max(DOING_MAX),
});

/**
 * Change operation; `ride` plays the elevator animation, `teleport` is the quick menu.
 * A project room is on one level, so going to it also moves the human to that
 * level. `levelId` matters for the lobby id, which stands for "in no project
 * room": it says which level the human is on (absent = stay on the current one).
 */
export const OperationGoCommand = z.object({
  type: z.literal("operation.go"),
  operationId: Id,
  mode: z.enum(["ride", "teleport"]).default("ride"),
  levelId: Id.optional(),
});

export const presenceCommands = [
  MoveCommand,
  SitCommand,
  EmoteCommand,
  ChatCommand,
  OperationGoCommand,
  DoingCommand,
] as const;
