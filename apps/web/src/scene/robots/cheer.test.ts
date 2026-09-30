/**
 * The merge gong's robot celebration as a state machine over time (#43):
 * status/action → settled animation (#159) → cheer → the clip the avatar
 * plays and where it sits. A seated robot dances in its chair for about 3 s
 * and returns to exactly the clip and placement it had; it never stands up.
 */
import { describe, expect, test } from "bun:test";
import { HEADING, type Seat } from "@regulus/floor-layout";
import type { AgentAction, AgentStatus } from "@regulus/protocol";
import { avatarClip } from "../avatar/clips.ts";
import { SEATED_CLIPS } from "../avatar/seatedClips.ts";
import type { GongRingView } from "../gong/timing.ts";
import { settleStart, settleStep } from "./animationSettle.ts";
import { CHEER_MS, robotCheers } from "./cheer.ts";
import { calmFor, robotAnimationFor, robotLookFor } from "./robotAnimation.ts";
import { robotPlacement } from "./seatPlacement.ts";

const seat: Seat = { id: "s", kind: "desk", pose: { x: 3, z: 4, heading: HEADING.north } };
const anchor = { seatY: 0.31, backFwd: -0.13 };

interface Frame {
  at: number;
  clip: string;
  seated: boolean;
  cheering: boolean;
  placement: string;
}

/**
 * Plays a robot in one status/action from t = 0, with the gong ringing at
 * `ringAt` (or never), and samples every 100 ms what the scene would draw.
 */
function play(
  status: AgentStatus,
  action: AgentAction,
  ringAt: number | null,
  until: number,
  reducedMotion = false,
): Frame[] {
  const wanted = calmFor(robotAnimationFor({ status, action }), reducedMotion);
  let settle = settleStart(wanted, 0);
  const ring: GongRingView | null =
    ringAt === null ? null : { id: 1, floorId: "f", cause: "merge", strikes: 1, at: ringAt };
  const frames: Frame[] = [];
  for (let now = 0; now <= until; now += 100) {
    settle = settleStep(settle, wanted, now);
    const look = robotLookFor(settle.shown);
    const heard = ring && now >= ring.at ? ring : null;
    const cheering = robotCheers(look, heard, now, reducedMotion);
    frames.push({
      at: now,
      clip: avatarClip(look.animation, look.seated, cheering),
      seated: look.seated,
      cheering,
      placement: JSON.stringify(robotPlacement(seat, look.seated, anchor)),
    });
  }
  return frames;
}

/** The clips shown in order, collapsed, with when each started. */
const phases = (frames: Frame[]) =>
  frames.reduce<{ at: number; clip: string }[]>((out, f) => {
    if (out[out.length - 1]?.clip !== f.clip) out.push({ at: f.at, clip: f.clip });
    return out;
  }, []);

describe("robots cheer when the gong rings (#43)", () => {
  test("an idle robot dances in its chair for 3 s, then sits still in the same pose", () => {
    const frames = play("idle", "none", 1000, 8000);
    expect(phases(frames)).toEqual([
      { at: 0, clip: SEATED_CLIPS.idle },
      { at: 1000, clip: SEATED_CLIPS.cheer },
      { at: 1000 + CHEER_MS, clip: SEATED_CLIPS.idle },
    ]);
    // Seated the whole time, never moved on the seat: exactly the pose it had.
    expect(new Set(frames.map((f) => f.seated))).toEqual(new Set([true]));
    expect(new Set(frames.map((f) => f.placement)).size).toBe(1);
    // And still afterwards (#159): the idle clip until the end.
    expect(frames.filter((f) => f.at >= 1000 + CHEER_MS).every((f) => !f.cheering)).toBe(true);
  });

  test("a working robot cheers and goes back to typing", () => {
    expect(phases(play("working", "typing", 500, 6000))).toEqual([
      { at: 0, clip: SEATED_CLIPS.type },
      { at: 500, clip: SEATED_CLIPS.cheer },
      { at: 500 + CHEER_MS, clip: SEATED_CLIPS.type },
    ]);
  });

  test("a robot waiting for permission cheers too and returns to its still pose", () => {
    const frames = play("waiting_permission", "none", 2000, 7000);
    expect(phases(frames).map((p) => p.clip)).toEqual([
      SEATED_CLIPS.idle,
      SEATED_CLIPS.cheer,
      SEATED_CLIPS.idle,
    ]);
  });

  test("a robot in a standing one-shot finishes it instead of cheering", () => {
    // A robot seen `done` for the first time is still; one that turns done
    // later celebrates standing. Model the latter: celebrate is shown at once.
    const look = robotLookFor("celebrate");
    const ring: GongRingView = { id: 1, floorId: "f", cause: "bang", strikes: 1, at: 0 };
    expect(robotCheers(look, ring, 100, false)).toBe(false);
    expect(avatarClip("celebrate", look.seated, false)).not.toBe(SEATED_CLIPS.cheer);
  });

  test("with reduced motion nobody cheers", () => {
    const frames = play("idle", "none", 1000, 5000, true);
    expect(frames.some((f) => f.cheering)).toBe(false);
    expect(new Set(frames.map((f) => f.clip))).toEqual(new Set([SEATED_CLIPS.idle]));
  });

  test("a second ring during a cheer starts a new 3 s from that ring", () => {
    const ring = (at: number): GongRingView => ({
      id: at,
      floorId: "f",
      cause: "bang",
      strikes: 1,
      at,
    });
    const seated = { seated: true };
    expect(robotCheers(seated, ring(1000), 3500, false)).toBe(true);
    expect(robotCheers(seated, ring(1000), 4000, false)).toBe(false);
    expect(robotCheers(seated, ring(3000), 5900, false)).toBe(true);
    expect(robotCheers(seated, ring(3000), 6000, false)).toBe(false);
  });
});
