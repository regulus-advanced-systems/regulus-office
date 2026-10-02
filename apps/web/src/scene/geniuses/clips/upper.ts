/**
 * Upper-body poses: each archetype's idle stance (hands rubbed together,
 * thumbs in the waistcoat, hands behind the back...) and the SPEC §9.3
 * emotes. Poses set arms, forearms and the head; the lower body (lower.ts)
 * sets hips, legs and the spine lean.
 */
import type { IdlePose } from "../bodies/types.ts";
import { type Pose, type Rot, wave } from "./pose.ts";

const arms = (armL: Rot, foreL: Rot, armR: Rot, foreR: Rot): Pose => ({
  rot: { armL, foreL, armR, foreR },
});

/** Mirror a left-arm rotation to the right arm (x stays, y and z flip). */
const m = ([x, y, z]: Rot): Rot => [x, -y, -z];

/** The archetype's resting arms, with a little life in them. */
export function idleArms(idle: IdlePose, phase: number): Pose {
  const w = wave(phase, 4);
  switch (idle) {
    case "rub_hands": {
      const armL: Rot = [-30, 0, -8];
      const foreL: Rot = [-62 + 6 * w, -38, 0];
      return arms(armL, foreL, m(armL), m([-62 - 6 * w, -38, 0]));
    }
    case "thumbs_in_vest": {
      const armL: Rot = [-10, 0, 26];
      const foreL: Rot = [-80, -70 + 3 * w, 0];
      return arms(armL, foreL, m(armL), m(foreL));
    }
    case "hands_behind": {
      const armL: Rot = [24, 0, 10];
      const foreL: Rot = [-12, 0, -85];
      return arms(armL, foreL, m(armL), m(foreL));
    }
    case "hands_in_pocket": {
      const armL: Rot = [-14, 0, -2];
      const foreL: Rot = [-62, -40, 0];
      return { rot: { ...arms(armL, foreL, m(armL), m(foreL)).rot, head: [-6, 0, 4 * w] } };
    }
    case "hand_on_hip": {
      const armL: Rot = [10, 0, 34];
      const foreL: Rot = [-70, -100, 0];
      const armR: Rot = [-24 + 2 * w, 0, -6];
      const foreR: Rot = [-100, 20, 0];
      return { rot: { armL, foreL, armR, foreR, head: [-4, 0, -8] } };
    }
    case "steepled": {
      const armL: Rot = [-18, 0, -6];
      const foreL: Rot = [-96 + 3 * w, -52, 0];
      return arms(armL, foreL, m(armL), m([-96 + 3 * w, -52, 0]));
    }
  }
}

/** Hands on the lap while seated. */
export function lapArms(): Pose {
  return arms([-28, 0, 4], [-40, -10, 0], [-28, 0, -4], [-40, 10, 0]);
}

/** Typing at the laptop: forearms level, fingers drumming. */
export function typingArms(phase: number): Pose {
  const a = wave(phase, 2);
  const b = wave(phase, 2, 0.5);
  return {
    rot: {
      armL: [-26, 0, 6],
      foreL: [-62 + 5 * a, -12, 0],
      armR: [-26, 0, -6],
      foreR: [-62 + 5 * b, 12, 0],
      head: [10, 0, 0],
    },
  };
}

/** Emote upper bodies (SPEC §9.3 one-shots; they loop while the emote lasts). */
export function emoteArms(emote: string, phase: number): Pose {
  const w = wave(phase, 2);
  switch (emote) {
    case "wave":
      return {
        rot: {
          ...lapArms().rot,
          armL: [4, 0, 8],
          foreL: [-12, 0, 0],
          armR: [-10, 0, -155],
          foreR: [0, 0, -22 * w - 10],
          head: [0, -8, 6],
        },
      };
    case "point":
      return {
        rot: {
          armL: [10, 0, 10],
          foreL: [-15, 0, 0],
          armR: [-88, -12, 0],
          foreR: [-4, 0, 0],
          head: [4, -10, 0],
        },
      };
    case "celebrate":
      return {
        rot: {
          armL: [-10, 0, 150 + 12 * w],
          foreL: [-20, 0, 10],
          armR: [-10, 0, -150 - 12 * w],
          foreR: [-20, 0, -10],
          head: [-18, 0, 6 * w],
        },
      };
    case "facepalm":
      return {
        rot: {
          armL: [6, 0, 6],
          foreL: [-15, 0, 0],
          armR: [-58, 0, 10],
          foreR: [-100, 40, 0],
          head: [22, 6 * w, 0],
        },
      };
    case "think":
      return {
        rot: {
          armL: [-22, 0, -10],
          foreL: [-80, -60, 0],
          armR: [-30, 0, 4],
          foreR: [-120, 25, 0],
          head: [6, 0, -12],
        },
      };
    case "thumbs_up": {
      // Right fist forward and up, thumb to the sky; a small proud nod.
      const nod = Math.max(0, wave(phase, 2));
      return {
        rot: {
          armL: [6, 0, 6],
          foreL: [-15, 0, 0],
          armR: [-62, 0, -14],
          foreR: [-78, 30, 0],
          head: [-6 + 6 * nod, -6, 0],
        },
      };
    }
    case "clap": {
      // Hands in front of the chest, meeting six times in the two seconds.
      const open = 0.5 + 0.5 * wave(phase, 6);
      const armL: Rot = [-52, 0, -6 + 16 * open];
      const foreL: Rot = [-48, -58 + 22 * open, 0];
      return { rot: { ...arms(armL, foreL, m(armL), m(foreL)).rot, head: [-8, 0, 0] } };
    }
    case "dance": {
      // Arms up in turn, as if to a disco beat.
      const a = wave(phase, 2);
      return {
        rot: {
          armL: [-20, 0, 120 + 35 * a],
          foreL: [-30 - 20 * Math.max(0, -a), 0, 0],
          armR: [-20, 0, -120 + 35 * a],
          foreR: [-30 - 20 * Math.max(0, a), 0, 0],
          head: [-6, 10 * a, 6 * a],
        },
      };
    }
    case "read":
      return {
        rot: {
          armL: [-24, 0, 6],
          foreL: [-60, -18, 0],
          armR: [-24, 0, -6],
          foreR: [-60, 18, 0],
          head: [24, 0, 0],
        },
      };
    default:
      return { rot: {} };
  }
}
