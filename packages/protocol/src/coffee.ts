/**
 * The break-room coffee machine (SPEC §9.1 special rooms, D9 "coffee buff";
 * #63): a cup gives the drinker a buzz for {@link BUZZ_MS}: they walk and
 * run {@link BUZZ_SPEED_BOOST} times as fast, their HUD shows a buzz meter,
 * and from the third cup of one buzz they have the jitters. Every cup starts
 * the minute again; when it runs out the cups are forgotten.
 *
 * The server grants the buzz (`coffee.drink`, checked against where the
 * human stands) and ends it; `HumanPresence.cups` and `buzzUntil` carry it,
 * so other people see it exactly as far as they see the person. The speed
 * itself is the client's, like all movement (the server takes any position
 * inside the world, at most 20 times a second): the buzz is not a claim a
 * client makes, and no command carries a speed.
 */

/** The command a press on the coffee machine sends to the BuildingRoom. */
export const COFFEE_DRINK = "coffee.drink";

/** How long one cup keeps the buzz going, ms (the issue's 60 s). */
export const BUZZ_MS = 60_000;
/** Walking and running speed while buzzed, times the normal one. */
export const BUZZ_SPEED_BOOST = 1.25;
/** From this many cups in one buzz the drinker has the jitters. */
export const JITTER_CUPS = 3;
/** Cups counted in one buzz; further cups only start the minute again. */
export const MAX_CUPS = 5;
/** One human may take a cup at most this often (a cup takes a moment to drink). */
export const COFFEE_COOLDOWN_MS = 2500;

/** How far from the machine's stand point a human may take a cup (client reach). */
export const COFFEE_REACH = 1.6;
/** The server's reach: the client's plus slack for a pose in flight. */
export const COFFEE_SERVER_REACH = 4;

/** The presence fields the buzz lives in. */
export interface Buzz {
  cups: number;
  buzzUntil: number;
}

/** Is this person buzzed? The server clears the cups when the buzz ends. */
export function isBuzzed(buzz: Pick<Buzz, "cups"> | null | undefined): boolean {
  return (buzz?.cups ?? 0) > 0;
}

/** Does this person have the jitters (the third cup of one buzz)? */
export function hasJitters(buzz: Pick<Buzz, "cups"> | null | undefined): boolean {
  return (buzz?.cups ?? 0) >= JITTER_CUPS;
}

/** The speed factor a person's buzz gives them: {@link BUZZ_SPEED_BOOST} or 1. */
export function buzzSpeedBoost(buzz: Pick<Buzz, "cups"> | null | undefined): number {
  return isBuzzed(buzz) ? BUZZ_SPEED_BOOST : 1;
}

/** Milliseconds of buzz left at server time `now`; 0 when not buzzed. */
export function buzzLeftMs(buzz: Buzz | null | undefined, now: number): number {
  if (!buzz || !isBuzzed(buzz)) return 0;
  return Math.max(0, Math.min(BUZZ_MS, buzz.buzzUntil - now));
}

/** The presence after one more cup taken at server time `now`. */
export function afterCup(buzz: Buzz, now: number): Buzz {
  return { cups: Math.min(MAX_CUPS, Math.max(0, buzz.cups) + 1), buzzUntil: now + BUZZ_MS };
}
