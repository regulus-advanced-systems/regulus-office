/**
 * Keeping a listener's player on the server's playhead (#47, research 01
 * §5). Every check compares where the player is with where the server's
 * clock says it should be (`drift`, ms, positive = ahead) and picks one of:
 *
 * - settle: |drift| below `settleMs`, play at normal speed;
 * - nudge: up to `nudgeMaxMs`, play 0.4 % slower (ahead) or faster
 *   (behind) until it is back under `settleMs`; inaudible, no glitch;
 * - seek: beyond that, jump straight to the right position.
 *
 * While nudging, the player keeps nudging down to half of `settleMs` (hysteresis),
 * so it does not flap between rates at the boundary. YouTube's player can
 * only be seeked, coarsely: it re-seeks beyond `youtubeSeekMs` (loose sync).
 */
import { JUKEBOX_SYNC } from "@regulus/protocol";

export type Correction =
  | { kind: "settle"; rate: 1 }
  | { kind: "nudge"; rate: number }
  | { kind: "seek"; rate: 1 };

export interface SyncTuning {
  settleMs: number;
  nudgeMaxMs: number;
  nudgeRate: number;
}

/**
 * What to do about `driftMs` (player minus server, ms) given the playback
 * rate the player runs at now.
 */
export function correctDrift(
  driftMs: number,
  currentRate: number,
  tuning: SyncTuning = JUKEBOX_SYNC,
): Correction {
  const size = Math.abs(driftMs);
  if (!Number.isFinite(driftMs) || size > tuning.nudgeMaxMs) return { kind: "seek", rate: 1 };
  const nudging = currentRate !== 1;
  const threshold = nudging ? tuning.settleMs / 2 : tuning.settleMs;
  if (size <= threshold) return { kind: "settle", rate: 1 };
  // Ahead: slow down; behind: speed up.
  return { kind: "nudge", rate: driftMs > 0 ? 1 - tuning.nudgeRate : 1 + tuning.nudgeRate };
}

/** YouTube: seek only when it has wandered far (its player has no fine control). */
export function youtubeNeedsSeek(driftMs: number, seekMs: number = JUKEBOX_SYNC.youtubeSeekMs) {
  return !Number.isFinite(driftMs) || Math.abs(driftMs) > seekMs;
}
