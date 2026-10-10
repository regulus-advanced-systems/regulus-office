/**
 * The coffee buzz on the client (#63, protocol `coffee.ts`): where the
 * machine is in the world being drawn, what the HUD's buzz meter shows, the
 * badge over a buzzed human's head, and the jitters, which are a small
 * offset of the avatar's drawn body only. The pose in the player store (what
 * the camera follows and what goes to the server) never shakes, so neither
 * does the camera, in either view. Pure.
 */
import {
  BUZZ_MS,
  BUZZ_SPEED_BOOST,
  type Buzz,
  buzzLeftMs,
  hasJitters,
  isBuzzed,
} from "@regulus/protocol";
import { type CoffeeMachineSpot, coffeeMachineSpot } from "@regulus/room-layout";
import type { BuildingStore } from "../../state/building.ts";
import type { CompoundWorld } from "../compound/world.ts";

/** The coffee machine of the level being drawn, compound metres; null on a level without a break room. */
export function coffeeSpotOf(world: CompoundWorld): CoffeeMachineSpot | null {
  return coffeeMachineSpot({
    tileMetres: world.tileMetres,
    specialRooms: world.rooms
      .filter((r) => r.kind === "break_room")
      .map((r) => ({
        kind: r.kind,
        gridX: r.rect.x,
        gridY: r.rect.y,
        width: r.rect.w,
        depth: r.rect.d,
      })),
  });
}

/** The local human's buzz as the server last published it. */
export function selectSelfBuzz(store: BuildingStore): Buzz | null {
  const me = store.sessionId ? store.state?.humans[store.sessionId] : undefined;
  return me ? { cups: me.cups ?? 0, buzzUntil: me.buzzUntil ?? 0 } : null;
}

export interface BuzzMeterView {
  cups: number;
  /** Whole seconds of buzz left. */
  seconds: number;
  /** 0 (about to end) .. 1 (a cup just taken). */
  fraction: number;
  jitters: boolean;
  /** Percent faster than normal, for the label. */
  boostPercent: number;
}

/** What the HUD meter shows at server time `now`; null when there is no buzz to show. */
export function buzzMeter(buzz: Buzz | null, now: number): BuzzMeterView | null {
  if (!buzz || !isBuzzed(buzz)) return null;
  const left = buzzLeftMs(buzz, now);
  return {
    cups: buzz.cups,
    seconds: Math.ceil(left / 1000),
    fraction: left / BUZZ_MS,
    jitters: hasJitters(buzz),
    boostPercent: Math.round((BUZZ_SPEED_BOOST - 1) * 100),
  };
}

/** The badge over a buzzed human's head: the cup others see. Null when not buzzed. */
export function buzzBadge(cups: number): { icon: string; label: string } | null {
  if (!isBuzzed({ cups })) return null;
  if (hasJitters({ cups })) return { icon: "☕", label: "Jitters" };
  return { icon: "☕", label: cups === 1 ? "1 cup" : `${cups} cups` };
}

/** Does this avatar's body shake? Never for a viewer who asked for less motion. */
export function shakes(cups: number, reducedMotion: boolean): boolean {
  return !reducedMotion && hasJitters({ cups });
}

/** The furthest the body is drawn from where it stands, metres. */
export const JITTER_METRES = 0.014;
/** The furthest it is turned from its heading, radians. */
export const JITTER_YAW = 0.04;

export interface JitterOffset {
  x: number;
  z: number;
  yaw: number;
}

export const NO_JITTER: JitterOffset = { x: 0, z: 0, yaw: 0 };

/** A phase per human, so two jittery people do not shake in step. */
export function jitterSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 6283;
  return h / 1000;
}

/**
 * The body's offset at `t` seconds: three incommensurate tremors per axis,
 * bounded by {@link JITTER_METRES} and {@link JITTER_YAW}. A function of
 * time alone, so it needs no state and a paused frame loop holds still.
 */
export function jitterOffset(t: number, seed = 0): JitterOffset {
  const a = t + seed;
  const wave = (f1: number, f2: number, f3: number, phase: number) =>
    (Math.sin(a * f1 + phase) + Math.sin(a * f2 + phase * 2) + Math.sin(a * f3 + phase * 3)) / 3;
  return {
    x: wave(71, 113, 37, 0.3) * JITTER_METRES,
    z: wave(83, 97, 43, 1.1) * JITTER_METRES,
    yaw: wave(61, 127, 29, 2.3) * JITTER_YAW,
  };
}
