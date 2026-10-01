/**
 * Lower-body motions (hips, legs, spine lean): standing, walking and seated.
 * The seated pose puts the hips where a seated henchman's are (avatar/seatedFit.ts),
 * so a genius sits on any seat's sit anchor without a separate fit.
 */
import { SEATED_BACK_DEPTH, SEATED_HIPS, SEATED_SIT_DROP } from "../../avatar/seatedFit.ts";
import type { MotionStyle } from "../bodies/types.ts";
import type { Body, Vec3 } from "../rig.ts";
import { type Pose, wave } from "./pose.ts";

/** Standing still: breathing and the archetype's lean. */
export function standing(style: MotionStyle, phase: number): Pose {
  const breath = wave(phase, 1);
  return {
    hips: [0, 0.006 * breath, 0],
    rot: {
      spine: [style.lean + breath * 1.2, 0, 0],
      head: [-style.lean * 0.6 + breath * 0.5, 6 * wave(phase, 1, 0.15), 0],
    },
  };
}

/**
 * One walk cycle (two steps), face-first: legs swing about the hips, the
 * back leg's knee bends as it lifts, arms counter-swing, hips roll by the
 * archetype's sway and bob twice per cycle.
 */
export function walking(style: MotionStyle, phase: number): Pose {
  const s = wave(phase);
  const c = wave(phase, 1, 0.25);
  const lift = (x: number) => Math.max(0, x);
  return {
    hips: [0, style.bob * (0.5 - 0.5 * Math.cos(2 * Math.PI * 2 * phase)), 0],
    rot: {
      hips: [0, 5 * s, style.sway * c],
      spine: [style.lean + 3, -7 * s, -style.sway * c * 0.7],
      head: [-style.lean * 0.6, 3 * s, 0],
      thighL: [-style.stride * s, 0, 0],
      shinL: [lift(-c) * 50 + 6, 0, 0],
      thighR: [style.stride * s, 0, 0],
      shinR: [lift(c) * 50 + 6, 0, 0],
      armL: [style.armSwing * s, 0, 7],
      foreL: [-18 - 8 * lift(-s), 0, 0],
      armR: [-style.armSwing * s, 0, -7],
      foreR: [-18 - 8 * lift(s), 0, 0],
    },
  };
}

/** Thigh swing of a run, from the archetype's walking stride (degrees). */
export const runStride = (style: MotionStyle): number => Math.min(48, style.stride * 1.5 + 8);
/** Arm swing of a run: everyone pumps their arms, even the hands-behind walkers. */
export const runArmSwing = (style: MotionStyle): number => Math.max(34, style.armSwing * 2.2);

/**
 * One run cycle (two strides, #223): the walk's shape, bigger. Longer
 * thigh swing, knees fold high behind, the body pitches forward, the hips
 * bounce harder, and bent arms pump against the legs.
 */
export function running(style: MotionStyle, phase: number): Pose {
  const s = wave(phase);
  const c = wave(phase, 1, 0.25);
  const lift = (x: number) => Math.max(0, x);
  const stride = runStride(style);
  const arm = runArmSwing(style);
  return {
    hips: [0, style.bob * 2 * (0.5 - 0.5 * Math.cos(2 * Math.PI * 2 * phase)), 0],
    rot: {
      hips: [0, 8 * s, style.sway * 0.5 * c],
      spine: [style.lean * 0.5 + 14, -12 * s, -style.sway * 0.3 * c],
      head: [-style.lean * 0.4 - 8, 4 * s, 0],
      thighL: [-stride * s, 0, 0],
      shinL: [lift(-c) * 95 + 12, 0, 0],
      thighR: [stride * s, 0, 0],
      shinR: [lift(c) * 95 + 12, 0, 0],
      armL: [arm * s, 0, 10],
      foreL: [-78 - 12 * lift(-s), 0, 0],
      armR: [-arm * s, 0, -10],
      foreR: [-78 - 12 * lift(s), 0, 0],
    },
  };
}

/** Hips position in the seated pose, model space (facing +z, back toward -z). */
export function seatedHips(body: Body): Vec3 {
  const underside = SEATED_HIPS.up - SEATED_SIT_DROP;
  const backZ = -(SEATED_HIPS.back + SEATED_BACK_DEPTH);
  return [0, underside + body.seatDrop, backZ + body.backDepth];
}

/** Sitting: thighs forward, shins down, a slight lean back; `lean` overrides the spine. */
export function seated(body: Body, phase: number, lean = -4): Pose {
  const breath = wave(phase, 1);
  return {
    hips: seatedHips(body),
    hipsAbsolute: true,
    rot: {
      spine: [lean + breath, 0, 0],
      head: [-lean * 0.5, 5 * wave(phase, 1, 0.2), 0],
      thighL: [-88, 0, 4],
      shinL: [80, 0, 0],
      thighR: [-88, 0, -4],
      shinR: [80, 0, 0],
    },
  };
}
