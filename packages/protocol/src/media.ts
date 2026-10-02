/**
 * Media (#48, SPEC §4.2 Media, §9.4 lounge TV, D5): LiveKit screen share to
 * the lounge TV and proximity voice, both optional (Compose profile `media`).
 *
 * The office server never carries media: it only mints short-lived LiveKit
 * access tokens for signed-in humans (`POST /api/media/token`) and keeps
 * who is sharing the TV in the building room (`HumanPresence.sharingScreen`,
 * commands `screen.share.start|stop`). Browsers talk to LiveKit directly.
 *
 * One LiveKit room per office (`MEDIA_ROOM`): the lounge TV and voice from
 * anywhere in the compound. Loudness by distance is client-side (the web's
 * audio/spatial.ts); who may hear a voice at all is enforced by the SFU with
 * the publisher's track subscription permissions (`voiceListeners`), so a
 * modified client cannot listen in on a project room it may not enter.
 */
import { z } from "zod";
import { Id } from "./common.ts";
import type { UserRole } from "./enums.ts";

/** GET: is media configured, and what may this human do (`MediaStatus`). */
export const MEDIA_STATUS_API_PATH = "/api/media";
/** POST `MediaTokenRequest` → `MediaToken`. */
export const MEDIA_TOKEN_API_PATH = "/api/media/token";

/** The LiveKit room every human of the office joins. */
export const MEDIA_ROOM = "office";

/**
 * Token lifetime. A token only opens the connection: LiveKit refreshes it
 * for connected participants itself, and a client that drops for longer
 * asks the office for a new one. Short, so a leaked token is soon useless.
 */
export const MEDIA_TOKEN_TTL_SECONDS = 10 * 60;

/** LiveKit track sources (its `TrackSource` names in a token's `canPublishSources`). */
export const MEDIA_SOURCES = ["microphone", "screen_share", "screen_share_audio"] as const;
export type MediaSource = (typeof MEDIA_SOURCES)[number];

/**
 * What a human may do in the media room. Everyone signed in watches the TV
 * and hears voices nearby. Viewers (SPEC §3: "can walk around and watch";
 * D12: control nothing) only listen and watch: putting a screen on the
 * shared TV or a voice into the room is taking part, like queuing music on
 * the jukebox, which viewers may not do either. Nobody gets data messages
 * (state goes through the building room) or may change their own name or
 * metadata (the office sets the name from the profile).
 */
export interface MediaGrants {
  canSubscribe: boolean;
  canPublish: boolean;
  canPublishSources: MediaSource[];
  canPublishData: boolean;
  canUpdateOwnMetadata: boolean;
}

export function mediaGrantsFor(role: UserRole): MediaGrants {
  const publish = role !== "viewer";
  return {
    canSubscribe: true,
    canPublish: publish,
    canPublishSources: publish ? [...MEDIA_SOURCES] : [],
    canPublishData: false,
    canUpdateOwnMetadata: false,
  };
}

/** May this human put their screen on the lounge TV? */
export function mayShareScreen(role: UserRole): boolean {
  return mediaGrantsFor(role).canPublishSources.includes("screen_share");
}

/** May this human talk? */
export function mayTalk(role: UserRole): boolean {
  return mediaGrantsFor(role).canPublishSources.includes("microphone");
}

/** Owners and admins may take someone else's screen off the TV (audited). */
export function mayStopAnyScreenShare(role: UserRole): boolean {
  return role === "owner" || role === "admin";
}

/** `GET /api/media` */
export interface MediaStatus {
  /** LiveKit is configured on this office (LIVEKIT_API_KEY/SECRET set). */
  enabled: boolean;
  /** This human may talk and share (not a viewer). */
  canPublish: boolean;
}

/**
 * `POST /api/media/token`: the building room session this connection
 * belongs to. It becomes the LiveKit identity, so voices and the TV map to
 * avatars; the server checks the session is this human's.
 */
export const MediaTokenRequest = z.object({ sessionId: Id });
export type MediaTokenRequest = z.infer<typeof MediaTokenRequest>;

export interface MediaToken {
  /** LiveKit signalling URL for the browser (wss://…). */
  url: string;
  token: string;
  room: string;
  identity: string;
  /** Unix ms. */
  expiresAt: number;
  grants: MediaGrants;
}

export const MEDIA_ERRORS = ["media_not_configured", "not_in_office", "invalid_request"] as const;
export type MediaError = (typeof MEDIA_ERRORS)[number];

/** The most voices a client listens to at once: the nearest ones (bandwidth bound, #48). */
export const VOICE_MAX_SUBSCRIPTIONS = 12;

/** Voice and TV hints for `doing` and the HUD. */
export const SCREEN_SHARE_REJECTIONS = {
  disabled: "Screen share is not set up on this office (the media profile is off).",
  viewer: "Viewers can watch the TV but not share to it.",
  notInLobby: "Walk to the lobby to put your screen on the lounge TV.",
  notSharing: "Nobody is sharing the TV.",
  notYours: "Only the sharer, an owner or an admin can take a screen off the TV.",
} as const;

/** "Ada is sharing the TV" rejection for a second sharer. */
export function screenBusyReason(sharerName: string): string {
  return `${sharerName} is sharing the TV. Ask them to stop, or wait until they do.`;
}

/** The parts of a presence the voice permissions read. */
export interface VoicePresence {
  sessionId: string;
  /** The room the human is in (`operation.go`, checked by the server); the lobby id elsewhere. */
  operationId: string;
}

/**
 * Who may subscribe to a voice published from `speaker`'s room: `"all"` in
 * the lobby, corridors and special rooms (open to everyone signed in),
 * otherwise only the humans the server placed in the same project room
 * (their `operationId`, which it only grants with room access, SPEC §9.1).
 * The publisher's client applies this as LiveKit track subscription
 * permissions, which the SFU enforces.
 */
export function voiceListeners(
  speaker: VoicePresence,
  everyone: Iterable<VoicePresence>,
  lobbyId: string,
): "all" | string[] {
  if (speaker.operationId === lobbyId || speaker.operationId === "") return "all";
  const out: string[] = [];
  for (const h of everyone)
    if (h.sessionId !== speaker.sessionId && h.operationId === speaker.operationId)
      out.push(h.sessionId);
  return out.sort();
}
