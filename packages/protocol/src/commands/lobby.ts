/** Lobby commands: jukebox.*, screen.share.*, pm.ask (SPEC §6). */
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

export const ScreenShareStartCommand = z.object({
  type: z.literal("screen.share.start"),
  target: z.enum(SCREEN_SHARE_TARGETS).default("lounge_tv"),
});

export const ScreenShareStopCommand = z.object({ type: z.literal("screen.share.stop") });

/** Ask the PM robot a question at reception. */
export const PmAskCommand = z.object({
  type: z.literal("pm.ask"),
  text: ChatText,
});

export const lobbyCommands = [
  JukeboxPlayCommand,
  JukeboxPauseCommand,
  JukeboxSeekCommand,
  JukeboxEnqueueCommand,
  JukeboxSkipCommand,
  ScreenShareStartCommand,
  ScreenShareStopCommand,
  PmAskCommand,
] as const;
