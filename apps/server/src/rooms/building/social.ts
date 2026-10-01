/**
 * The BuildingRoom's social rules (#49, SPEC §10 M3): who may sit where
 * (one human per seat, chairs and couches only, near the seat, in a room
 * they may enter), how often a client may emote, chat and change its
 * `doing` status. Pure apart from the injected clock, so the seat races
 * and rate limits are unit-testable without a transport. Colyseus handles
 * one message at a time per room, so a check followed by the claim is
 * atomic: of two humans asking for one seat, the second always finds it taken.
 */
import {
  CHAT_BURST,
  CHAT_REFILL_MS,
  DOING_MAX_HZ,
  EMOTE_MIN_INTERVAL_MS,
  SIT_REACH_METRES,
} from "@regulus/protocol";
import type { RoomAuthUser } from "../auth.ts";
import { RateLimiter, TokenBucket } from "./rate-limiter.ts";
import { findSeat, type SeatWorld } from "./seats.ts";

/** The presence fields the rules read. */
export interface SeatedHuman {
  seatId: string;
  position: { x: number; z: number };
}

export interface HumansView<H extends SeatedHuman = SeatedHuman> {
  forEach(cb: (human: H, sessionId: string) => void): void;
}

export type SocialCheck = { ok: true } | { ok: false; reason: string };

export interface SocialRulesOptions {
  /** Milliseconds; injectable for tests. */
  now?: () => number;
  /** May this user enter this operation's room? Default: yes. */
  canVisit?(user: RoomAuthUser, operationId: string): boolean;
}

export interface SocialRules {
  /** May `sessionId` take the seat `key`? Does not change state. */
  checkSit(
    world: SeatWorld,
    humans: HumansView,
    sessionId: string,
    user: RoomAuthUser,
    key: string,
  ): SocialCheck;
  allowEmote(sessionId: string): boolean;
  allowChat(sessionId: string): boolean;
  allowDoing(sessionId: string): boolean;
  forget(sessionId: string): void;
}

const refuse = (reason: string): SocialCheck => ({ ok: false, reason });

/** Who sits on `key` besides `sessionId`, if anyone. */
export function seatHolder(humans: HumansView, key: string, except: string): string | null {
  let holder: string | null = null;
  humans.forEach((h, id) => {
    if (holder === null && id !== except && h.seatId === key) holder = id;
  });
  return holder;
}

export function createSocialRules(options: SocialRulesOptions = {}): SocialRules {
  const now = options.now ?? (() => performance.now());
  const emotes = new RateLimiter({
    maxHz: 1000 / EMOTE_MIN_INTERVAL_MS,
    now,
    tolerance: 0,
  });
  const chat = new TokenBucket({ burst: CHAT_BURST, refillMs: CHAT_REFILL_MS, now });
  const doing = new RateLimiter({ maxHz: DOING_MAX_HZ, now });

  return {
    checkSit(world, humans, sessionId, user, key) {
      const spot = findSeat(world, key);
      if (!spot) return refuse(`no seat ${key}`);
      if (spot.project && options.canVisit && !options.canVisit(user, spot.roomId))
        return refuse(`no access to operation ${spot.roomId}`);
      let me: SeatedHuman | undefined;
      humans.forEach((h, id) => {
        if (id === sessionId) me = h;
      });
      if (!me) return refuse("not in the office");
      const far = Math.hypot(me.position.x - spot.x, me.position.z - spot.z);
      if (far > SIT_REACH_METRES) return refuse("too far from the seat; walk up to it first");
      if (seatHolder(humans, key, sessionId)) return refuse("someone is already sitting there");
      return { ok: true };
    },
    allowEmote: (sessionId) => emotes.allow(sessionId),
    allowChat: (sessionId) => chat.take(sessionId),
    allowDoing: (sessionId) => doing.allow(sessionId),
    forget(sessionId) {
      emotes.forget(sessionId);
      chat.forget(sessionId);
      doing.forget(sessionId);
    },
  };
}
