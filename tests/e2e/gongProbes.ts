/**
 * Probes for the merge gong (#43; needs `?stats`, see probes.ts): the gong group
 * `gong-<anchorId>` (userData: strikes heard, ring id, the ring's swing animation: its peak and
 * the frames drawn with the disc off centre), its swinging part `gong-swing`, the
 * `gong-confetti` instanced mesh, and each henchman's `henchman-<agentId>` group (userData
 * `cheering`, `animation`, `seated`; its placement on the seat).
 */
import type { Page } from "@playwright/test";

export interface HenchmanPose {
  x: number;
  y: number;
  z: number;
  rotY: number;
  animation: string;
  seated: boolean;
  cheering: boolean;
}

/** The gong's own record of its current ring's swing (GongObject userData). */
export interface GongSwing {
  /** The ring the record is for (0: none heard). */
  ringId: number;
  /** The peak of the swing curve this ring plays, radians (not a frame sample). */
  peak: number;
  /** Frames drawn with the disc off centre for this ring. */
  frames: number;
}

export interface GongSample {
  /** Strikes the page has heard, from the gong's userData. */
  strikes: number;
  /** The gong's record of its current ring's swing, when sampling ended. */
  swing: GongSwing;
  /** Largest swing of the disc seen in a sampled frame, radians (for the report only). */
  maxSwing: number;
  /** The swing when sampling ended. */
  lastSwing: number;
  /** Most confetti instances alive at once, and how many at the end. */
  maxConfetti: number;
  lastConfetti: number;
  /** Henchmen seen cheering at least once. */
  cheered: string[];
  /** Henchmen's poses when sampling ended. */
  henchmen: Record<string, HenchmanPose>;
}

/**
 * Samples the gong, its confetti and the henchmen every frame for `ms`. With `afterStrikes`, the
 * `ms` window starts once the page has heard more strikes than that (a ring the test caused is
 * still on its way from the server), waiting up to `waitMs` for it: how long the round trip takes
 * does not eat into the window (#229).
 */
export function sampleGong(
  page: Page,
  ms: number,
  opts: { afterStrikes?: number; waitMs?: number } = {},
): Promise<GongSample> {
  const args = {
    duration: ms,
    afterStrikes: opts.afterStrikes ?? null,
    waitMs: opts.waitMs ?? 15_000,
  };
  return page.evaluate(async ({ duration, afterStrikes, waitMs }) => {
    type Obj = {
      name: string;
      count?: number;
      visible: boolean;
      rotation: { x: number; y: number };
      position: { x: number; y: number; z: number };
      userData: Record<string, unknown>;
    };
    const r3f = (
      window as unknown as { __regulusR3F?: { scene: { traverse(f: (o: Obj) => void): void } } }
    ).__regulusR3F;
    const out = {
      strikes: 0,
      swing: { ringId: 0, peak: 0, frames: 0 },
      maxSwing: 0,
      lastSwing: 0,
      maxConfetti: 0,
      lastConfetti: 0,
      cheered: [] as string[],
      henchmen: {} as Record<string, HenchmanPose>,
    };
    type HenchmanPose = {
      x: number;
      y: number;
      z: number;
      rotY: number;
      animation: string;
      seated: boolean;
      cheering: boolean;
    };
    const giveUp = performance.now() + waitMs;
    let end = afterStrikes === null ? performance.now() + duration : Number.POSITIVE_INFINITY;
    do {
      let swing = 0;
      let confetti = 0;
      const henchmen: Record<string, HenchmanPose> = {};
      r3f?.scene.traverse((o) => {
        if (o.name.startsWith("gong-") && typeof o.userData.strikes === "number") {
          out.strikes = o.userData.strikes;
          const swung = o.userData.swung as { ringId: number; frames: number } | undefined;
          out.swing = {
            ringId: Number(o.userData.ringId ?? 0),
            peak: Number(o.userData.swingPeak ?? 0),
            frames: swung && swung.ringId === o.userData.ringId ? swung.frames : 0,
          };
        }
        if (o.name === "gong-swing") swing = Math.max(swing, Math.abs(o.rotation.x));
        if (o.name === "gong-confetti" && o.visible) confetti += o.count ?? 0;
        if (o.name.startsWith("henchman-") && "status" in o.userData) {
          const id = o.name.slice("henchman-".length);
          const d = o.userData;
          henchmen[id] = {
            x: o.position.x,
            y: o.position.y,
            z: o.position.z,
            rotY: o.rotation.y,
            animation: String(d.animation),
            seated: d.seated === true,
            cheering: d.cheering === true,
          };
          if (d.cheering === true && !out.cheered.includes(id)) out.cheered.push(id);
        }
      });
      out.maxSwing = Math.max(out.maxSwing, swing);
      out.lastSwing = swing;
      out.maxConfetti = Math.max(out.maxConfetti, confetti);
      out.lastConfetti = confetti;
      out.henchmen = henchmen;
      if (end === Number.POSITIVE_INFINITY) {
        if (afterStrikes !== null && out.strikes > afterStrikes) end = performance.now() + duration;
        else if (performance.now() > giveUp) break;
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    } while (performance.now() < end);
    return out;
  }, args);
}

/** Henchmen's poses now (a zero-length sample). */
export async function henchmanPoses(page: Page): Promise<Record<string, HenchmanPose>> {
  return (await sampleGong(page, 0)).henchmen;
}

/** Strikes the page has heard so far. */
export async function gongStrikes(page: Page): Promise<number> {
  return (await sampleGong(page, 0)).strikes;
}

/** How far each henchman moved or turned between two samples (metres + radians), largest first. */
export function poseDrift(
  before: Record<string, HenchmanPose>,
  after: Record<string, HenchmanPose>,
): number {
  let drift = 0;
  for (const [id, a] of Object.entries(before)) {
    const b = after[id];
    if (!b) continue;
    drift = Math.max(drift, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), Math.abs(a.rotY - b.rotY));
  }
  return drift;
}

/** Local rotations (x, y, z, w) of every bone of one henchman, by bone name. */
export function boneSnapshot(page: Page, agentId: string): Promise<Record<string, number[]>> {
  return page.evaluate((id) => {
    type Obj = {
      name: string;
      isBone?: boolean;
      quaternion: { x: number; y: number; z: number; w: number };
      traverse(f: (o: Obj) => void): void;
    };
    const r3f = (
      window as unknown as {
        __regulusR3F?: { scene: { getObjectByName(n: string): Obj | undefined } };
      }
    ).__regulusR3F;
    const out: Record<string, number[]> = {};
    r3f?.scene.getObjectByName(`henchman-${id}`)?.traverse((b) => {
      if (b.isBone && !out[b.name])
        out[b.name] = [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w];
    });
    return out;
  }, agentId);
}

/** Largest rotation of any bone between two snapshots, degrees (no acos rounding). */
export function boneDriftDeg(a: Record<string, number[]>, b: Record<string, number[]>): number {
  let max = 0;
  for (const [name, x] of Object.entries(a)) {
    const y = b[name];
    if (!y) continue;
    const sign = x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0) < 0 ? -1 : 1;
    const diff = Math.hypot(...x.map((v, i) => v - sign * (y[i] ?? 0)));
    const sum = Math.hypot(...x.map((v, i) => v + sign * (y[i] ?? 0)));
    max = Math.max(max, (4 * Math.atan2(diff, sum) * 180) / Math.PI);
  }
  return max;
}
