/**
 * Bone-motion probes for robots in the office scene (#159; needs `?stats`, see probes.ts).
 * A robot sits still unless it is working: these read the skeleton the mixer drives (the
 * `robot-<agentId>` group from apps/web/src/scene/robots/Robot.tsx) every animation frame, so a
 * test can assert that the bones do not move while a robot is idle and do move while it works.
 *
 * `recordBones` starts an in-page recorder; `boneSegments` splits what it saw into runs of the
 * same `status/action/animation/hand` and reports how far the bones moved within each run;
 * `sampleBones` measures a fixed window from now.
 */
import type { Page } from "@playwright/test";

/** Bones compared frame to frame: head, torso, both arms and a leg (the sitting clip's legs). */
const BONES = ["Head", "Body", "UpperArmL", "LowerArmL", "UpperArmR", "LowerArmR", "UpperLegL"];

export interface BoneSegment {
  /** `status/action/animation/hand`, as the robot group's userData had it. */
  key: string;
  /** How long the run lasted, ms. */
  ms: number;
  frames: number;
  /** Largest rotation of any probed bone away from its pose at the start of the run, degrees. */
  maxDeg: number;
}

/** Starts recording every robot's bone rotations each frame (replaces an earlier recording). */
export async function recordBones(page: Page): Promise<void> {
  await page.evaluate((names) => {
    type Q = { x: number; y: number; z: number; w: number };
    type Obj = {
      name: string;
      isBone?: boolean;
      quaternion: Q;
      userData: Record<string, unknown>;
      traverse(f: (o: Obj) => void): void;
    };
    type Frame = { t: number; key: string; q: number[] };
    const w = window as unknown as {
      __regulusR3F?: { scene: { traverse(f: (o: Obj) => void): void } };
      __boneFrames?: Record<string, Frame[]>;
      __boneRecording?: number;
    };
    const frames: Record<string, Frame[]> = {};
    w.__boneFrames = frames;
    const id = (w.__boneRecording ?? 0) + 1;
    w.__boneRecording = id;
    const step = () => {
      if (w.__boneRecording !== id) return;
      w.__regulusR3F?.scene.traverse((o) => {
        if (!o.name.startsWith("robot-") || !("status" in o.userData)) return;
        const bones: Record<string, Obj> = {};
        o.traverse((b) => {
          if (b.isBone && names.includes(b.name) && !bones[b.name]) bones[b.name] = b;
        });
        const q: number[] = [];
        for (const n of names) {
          const b = bones[n];
          if (b) q.push(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        }
        const d = o.userData;
        const key = `${d.status}/${d.action}/${d.animation}/${d.handRaised ? "hand" : "-"}`;
        const list = (frames[o.name.slice("robot-".length)] ??= []);
        list.push({ t: performance.now(), key, q });
        // Keep the last ~3 minutes at 60 fps.
        if (list.length > 12_000) list.splice(0, list.length - 12_000);
      });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, BONES);
}

/**
 * Runs of the same state in the recording for one robot, with how far its bones moved in each.
 * The first `settleMs` of every run are skipped (the 250 ms crossfade into it).
 */
export function boneSegments(page: Page, agentId: string, settleMs = 400): Promise<BoneSegment[]> {
  return page.evaluate(
    ({ agentId, settleMs }) => {
      type Frame = { t: number; key: string; q: number[] };
      const all = (window as unknown as { __boneFrames?: Record<string, Frame[]> }).__boneFrames;
      const frames = all?.[agentId] ?? [];
      const angle = (a: number[], b: number[]) => {
        let max = 0;
        for (let i = 0; i + 3 < a.length; i += 4) {
          const dot = Math.abs(
            (a[i] ?? 0) * (b[i] ?? 0) +
              (a[i + 1] ?? 0) * (b[i + 1] ?? 0) +
              (a[i + 2] ?? 0) * (b[i + 2] ?? 0) +
              (a[i + 3] ?? 0) * (b[i + 3] ?? 0),
          );
          max = Math.max(max, (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI);
        }
        return max;
      };
      const out: BoneSegment[] = [];
      let start = 0;
      for (let i = 1; i <= frames.length; i++) {
        const first = frames[start];
        if (!first) break;
        if (i < frames.length && frames[i]?.key === first.key) continue;
        const run = frames.slice(start, i).filter((f) => f.t - first.t >= settleMs);
        const base = run[0];
        const last = frames[i - 1] ?? first;
        out.push({
          key: first.key,
          ms: Math.round(last.t - first.t),
          frames: run.length,
          maxDeg: base ? Math.max(0, ...run.map((f) => angle(f.q, base.q))) : 0,
        });
        start = i;
      }
      return out;
    },
    { agentId, settleMs },
  );
}

/** How far one robot's bones move over the next `ms` (degrees), and the states it was in. */
export async function sampleBones(
  page: Page,
  agentId: string,
  ms: number,
): Promise<{ maxDeg: number; keys: string[]; frames: number }> {
  await recordBones(page);
  await page.waitForTimeout(ms);
  const segments = await boneSegments(page, agentId, 0);
  return {
    maxDeg: Math.max(0, ...segments.map((s) => s.maxDeg)),
    keys: segments.map((s) => s.key),
    frames: segments.reduce((n, s) => n + s.frames, 0),
  };
}
