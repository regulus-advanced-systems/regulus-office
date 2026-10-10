/**
 * Lobby commands: jukebox.*, screen.share.*, pm.ask (SPEC §6), blast_door.press (#188),
 * coffee.drink (#63), and
 * the jukebox's extras (#47): remove, volume, duration and its clock sync's `clock.ping`.
 */
import { z } from "zod";
import { ChatText, Count, Id } from "../common.ts";
import { SCREEN_SHARE_TARGETS } from "../enums.ts";

/** Resume playback, or start a specific track when `trackId` is given. */
export const JukeboxPlayCommand = z.object({
  type: z.literal("jukebox.play"),
  trackId: Id.optional(),
});

export const JukeboxPauseCommand = z.object({ type: z.literal("jukebox.pause") });

export const JukeboxSeekCommand = z.object({
  type: z.literal("jukebox.seek"),
  positionMs: Count,
});

/** Append a library track to the queue. */
export const JukeboxEnqueueCommand = z.object({
  type: z.literal("jukebox.enqueue"),
  trackId: Id,
});

export const JukeboxSkipCommand = z.object({ type: z.literal("jukebox.skip") });

/** Take one waiting entry off the queue (its adder, or an owner/admin). */
export const JukeboxRemoveCommand = z.object({
  type: z.literal("jukebox.remove"),
  entryId: Id,
});

/** The jukebox's office-wide level (owners and admins); each listener also has their own. */
export const JukeboxVolumeCommand = z.object({
  type: z.literal("jukebox.volume"),
  volume: z.number().min(0).max(1),
});

/**
 * A listener's player measured the current track's length (a YouTube video,
 * whose length the office cannot know without fetching it). Taken once.
 */
export const JukeboxDurationCommand = z.object({
  type: z.literal("jukebox.duration"),
  trackId: Id,
  durationMs: Count,
});

/** Clock sync ping (clock-sync.ts): the server answers `clock.pong` to the sender only. */
export const ClockPingCommand = z.object({
  type: z.literal("clock.ping"),
  id: z.number().int().nonnegative(),
  t0: z.number().finite(),
});

export const ScreenShareStartCommand = z.object({
  type: z.literal("screen.share.start"),
  target: z.enum(SCREEN_SHARE_TARGETS).default("lounge_tv"),
});

/**
 * Take a screen off the lounge TV (#48): your own, or with `sessionId` an
 * owner/admin stops someone else's share (audited).
 */
export const ScreenShareStopCommand = z.object({
  type: z.literal("screen.share.stop"),
  sessionId: Id.optional(),
});

/** Ask the PM henchman a question at reception. */
export const PmAskCommand = z.object({
  type: z.literal("pm.ask"),
  text: ChatText,
});

/** Press the blast door button (lobby wall or the outside keypad): open it, or hold it open. */
export const BlastDoorPressCommand = z.object({ type: z.literal("blast_door.press") });

/** Take a cup from the break-room coffee machine (coffee.ts, #63). */
export const CoffeeDrinkCommand = z.object({ type: z.literal("coffee.drink") });

export const lobbyCommands = [
  JukeboxPlayCommand,
  JukeboxPauseCommand,
  JukeboxSeekCommand,
  JukeboxEnqueueCommand,
  JukeboxSkipCommand,
  JukeboxRemoveCommand,
  JukeboxVolumeCommand,
  JukeboxDurationCommand,
  ClockPingCommand,
  ScreenShareStartCommand,
  ScreenShareStopCommand,
  PmAskCommand,
  BlastDoorPressCommand,
  CoffeeDrinkCommand,
] as const;
