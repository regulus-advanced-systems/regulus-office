/**
 * Shared rules for the social layer of the BuildingRoom (#49, SPEC §10 M3):
 * seat keys and reach for `sit`, emote timing, chat rate limits and bubble
 * timing, and the `doing` status. The server enforces these; the client
 * uses the same numbers so it never asks for what will be refused.
 */
import { EMOTES, type Emote, isOneOf } from "./enums.ts";

/** Is this avatar animation one of the emote wheel's emotes? */
export const isEmote: (value: unknown) => value is Emote = isOneOf(EMOTES);

/**
 * A seat anywhere in the compound: `<roomId>/<seatId>`, where `roomId` is an
 * operation id, the lobby's id or a special room's kind (`conference`,
 * `break_room`), and `seatId` the seat's id in that room's layout. This is
 * what `HumanPresence.seatId` and the `sit` command carry.
 */
export const SEAT_KEY_SEPARATOR = "/";

export function seatKey(roomId: string, seatId: string): string {
  return `${roomId}${SEAT_KEY_SEPARATOR}${seatId}`;
}

/** Split a seat key; null when it is not `<roomId>/<seatId>` with both parts. */
export function parseSeatKey(key: string): { roomId: string; seatId: string } | null {
  const at = key.indexOf(SEAT_KEY_SEPARATOR);
  if (at <= 0 || at === key.length - 1) return null;
  return { roomId: key.slice(0, at), seatId: key.slice(at + 1) };
}

/** A human may sit only this close (metres, on the ground) to the seat point. */
export const SIT_REACH_METRES = 2.5;

/** How long an emote plays before the avatar returns to rest, ms. */
export const EMOTE_MS = 2500;
/** At most one emote per this many ms per client; faster ones are refused. */
export const EMOTE_MIN_INTERVAL_MS = 1000;

/** Chat lines a client may send in a burst ... */
export const CHAT_BURST = 5;
/** ... refilled at one line per this many ms. */
export const CHAT_REFILL_MS = 2000;

/** A chat bubble stays over the speaker this long, ms ... */
export const CHAT_BUBBLE_MS = 6000;
/** ... fading out over its last this many ms. */
export const CHAT_BUBBLE_FADE_MS = 1200;

/** Longest `doing` status (HumanPresence.doing). */
export const DOING_MAX = 80;
/** `doing` updates faster than this are dropped. */
export const DOING_MAX_HZ = 2;

/** Labels and icons for the emote wheel and the reduced-motion badge. */
export const EMOTE_LABELS: Readonly<Record<Emote, { label: string; icon: string }>> = {
  wave: { label: "Wave", icon: "👋" },
  thumbs_up: { label: "Thumbs up", icon: "👍" },
  clap: { label: "Clap", icon: "👏" },
  dance: { label: "Dance", icon: "💃" },
  point: { label: "Point", icon: "👉" },
  facepalm: { label: "Facepalm", icon: "🤦" },
};
