/**
 * The lobby jukebox (SPEC §9.4, research 01 §5; #47): limits, the playhead
 * maths every side shares, who may do what, and the REST shapes of the
 * track library. The playing state itself travels in the BuildingRoom
 * (`BuildingState.jukebox`, building-state.ts); commands are in
 * commands/lobby.ts.
 *
 * Playhead model: the server owns `startedAtServerMs`, the server time at
 * which position 0 would have played. While playing, the position at server
 * time `t` is `t - startedAtServerMs`; while paused it is `pausedAtMs`.
 * Clients turn their own clock into server time with the 4-timestamp clock
 * sync (clock-sync.ts) and steer their player toward that position.
 */
import { z } from "zod";
import { Count, Id, TimestampMs } from "./common.ts";
import { JUKEBOX_SOURCES, type UserRole } from "./enums.ts";

export const JUKEBOX_API_PATH = "/api/jukebox";
/** GET the library; POST a multipart upload (`file`, `title`, `artist`, `durationMs`). */
export const JUKEBOX_TRACKS_API_PATH = `${JUKEBOX_API_PATH}/tracks`;
/** POST `AddYouTubeTrack`: a YouTube video as a library entry (id only, nothing fetched). */
export const JUKEBOX_YOUTUBE_API_PATH = `${JUKEBOX_API_PATH}/youtube`;

/** Where a file track's audio is served (session required, Range supported). */
export function jukeboxAudioPath(trackId: string): string {
  return `${JUKEBOX_TRACKS_API_PATH}/${encodeURIComponent(trackId)}/audio`;
}

export const JUKEBOX_LIMITS = {
  /** Entries waiting in the queue (not counting the one playing). */
  queueMax: 50,
  /** Entries one human may have waiting; owners and admins are not limited. */
  perUserQueued: 5,
  /** Largest audio upload. */
  uploadMaxBytes: 20 * 1024 * 1024,
  /** Uploaded tracks per human. */
  uploadsPerUser: 50,
  /** Shortest and longest track the jukebox takes. */
  minDurationMs: 1_000,
  maxFileDurationMs: 30 * 60_000,
  maxYouTubeDurationMs: 3 * 3_600_000,
  /** One jukebox command per human per this many ms; faster ones are refused. */
  commandIntervalMs: 250,
  titleMax: 200,
} as const;

/** Tight sync for file tracks (research 01 §5), loose sync for YouTube. */
export const JUKEBOX_SYNC = {
  /** Below this drift (ms) the player runs at normal speed. */
  settleMs: 12,
  /** Up to this drift (ms) the player nudges its playback rate; beyond, it re-seeks. */
  nudgeMaxMs: 75,
  /** The nudge: playbackRate 1 ± this (0.4 %, inaudible). */
  nudgeRate: 0.004,
  /** YouTube re-seeks only beyond this drift (ms); its player cannot be steered finer. */
  youtubeSeekMs: 2_000,
} as const;

/** The jukebox's own office-wide level when nobody has changed it. */
export const DEFAULT_JUKEBOX_VOLUME = 0.6;

/** `current` when nothing is loaded (the schema defaults). */
export const NO_JUKEBOX_ENTRY = {
  entryId: "",
  trackId: "",
  title: "",
  artist: "",
  source: "file",
  videoId: "",
  durationMs: 0,
  addedBy: "",
  addedByName: "",
} as const;

/** The jukebox before anything was played (the schema defaults). */
export const IDLE_JUKEBOX = {
  current: NO_JUKEBOX_ENTRY,
  startedAtServerMs: 0,
  pausedAtMs: 0,
  playing: false,
  volume: DEFAULT_JUKEBOX_VOLUME,
  queue: [],
} as const;

/** What the playhead depends on. `durationMs` 0 means unknown (a YouTube video not yet measured). */
export interface PlayheadState {
  playing: boolean;
  startedAtServerMs: number;
  pausedAtMs: number;
  durationMs: number;
}

/** Position (ms) of the current track at server time `serverNow`, clamped to the track. */
export function jukeboxPosition(state: PlayheadState, serverNow: number): number {
  const raw = state.playing ? serverNow - state.startedAtServerMs : state.pausedAtMs;
  const floor = Math.max(0, raw);
  return state.durationMs > 0 ? Math.min(floor, state.durationMs) : floor;
}

/** Has the current track played to its end at `serverNow`? Never for an unknown length. */
export function jukeboxTrackEnded(state: PlayheadState, serverNow: number): boolean {
  return (
    state.playing && state.durationMs > 0 && serverNow - state.startedAtServerMs >= state.durationMs
  );
}

/** `startedAtServerMs` that puts the playhead at `positionMs` at `serverNow`. */
export function startForPosition(positionMs: number, serverNow: number): number {
  return serverNow - Math.max(0, positionMs);
}

export interface JukeboxActor {
  userId: string;
  role: UserRole;
}

/** Viewers watch and listen but control nothing (D12); everyone else uses the jukebox. */
export function mayUseJukebox(role: UserRole): boolean {
  return role !== "viewer";
}

/** Owners and admins run the jukebox for the office: any track, the office volume, no queue cap. */
export function mayManageJukebox(role: UserRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * May `actor` pause, seek, skip or remove `entry`? Its adder may, owners and
 * admins may, and anyone who uses the jukebox may when nobody added it
 * (`addedBy` empty: a bundled track the jukebox started by itself).
 */
export function mayControlEntry(actor: JukeboxActor, entry: { addedBy: string }): boolean {
  if (!mayUseJukebox(actor.role)) return false;
  if (mayManageJukebox(actor.role)) return true;
  return entry.addedBy === "" || entry.addedBy === actor.userId;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
]);

/**
 * The video id of a YouTube link (watch, youtu.be, shorts, embed, live) or
 * of a bare 11-character id; null for anything else. Nothing is fetched:
 * the office never proxies remote URLs (SPEC §11).
 */
export function parseYouTubeId(input: string): string | null {
  const text = input.trim();
  if (YOUTUBE_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  let id: string | null | undefined;
  if (url.hostname.toLowerCase() === "youtu.be") id = parts[0];
  else if (parts[0] === "watch") id = url.searchParams.get("v");
  else if (["shorts", "embed", "live", "v"].includes(parts[0] ?? "")) id = parts[1];
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/** One library track (REST). File tracks play from `jukeboxAudioPath(id)`. */
export const JukeboxTrack = z.object({
  id: Id,
  title: z.string().max(JUKEBOX_LIMITS.titleMax),
  artist: z.string().max(JUKEBOX_LIMITS.titleMax),
  source: z.enum(JUKEBOX_SOURCES),
  /** YouTube video id; empty for file tracks. */
  videoId: z.string().max(16),
  /** 0 while unknown (a YouTube video nobody has played yet). */
  durationMs: Count,
  /** Licence of a bundled track (e.g. `CC-BY-4.0`); empty for uploads. */
  license: z.string().max(64),
  /** Attribution line of a bundled track; empty otherwise. */
  attribution: z.string().max(400),
  bundled: z.boolean(),
  /** Empty for bundled tracks. */
  addedBy: z.string().max(128),
  addedByName: z.string().max(64),
  createdAt: TimestampMs,
});
export type JukeboxTrack = z.infer<typeof JukeboxTrack>;

export const JukeboxTrackList = z.object({ tracks: z.array(JukeboxTrack) });
export type JukeboxTrackList = z.infer<typeof JukeboxTrackList>;

export const AddYouTubeTrack = z.object({
  /** A YouTube link or video id. */
  url: z.string().trim().min(1).max(500),
  title: z.string().trim().max(JUKEBOX_LIMITS.titleMax).optional(),
});
export type AddYouTubeTrack = z.infer<typeof AddYouTubeTrack>;

/** Why an upload or a YouTube link was refused (REST `error`). */
export const JUKEBOX_UPLOAD_ERRORS = [
  "too_large",
  "not_audio",
  "bad_duration",
  "bad_title",
  "too_many_uploads",
  "not_youtube",
  "forbidden",
] as const;
export type JukeboxUploadError = (typeof JUKEBOX_UPLOAD_ERRORS)[number];
