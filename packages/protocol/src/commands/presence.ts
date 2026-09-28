/** Human presence commands: move, sit, emote, chat, floor.go (SPEC §6). */
import { z } from "zod";
import { ChatText, Id } from "../common.ts";
import { EMOTES } from "../enums.ts";

export const MoveCommand = z.object({
  type: z.literal("move"),
  x: z.number().finite(),
  z: z.number().finite(),
  heading: z.number().finite(),
});

/** Sit on a seat; `seatId: null` stands up. */
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

/** Change floor; `ride` plays the elevator animation, `teleport` is the quick menu. */
export const FloorGoCommand = z.object({
  type: z.literal("floor.go"),
  floorId: Id,
  mode: z.enum(["ride", "teleport"]).default("ride"),
});

export const presenceCommands = [
  MoveCommand,
  SitCommand,
  EmoteCommand,
  ChatCommand,
  FloorGoCommand,
] as const;
