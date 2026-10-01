/**
 * Build-phase particles (#183, SPEC §9.1: "scaffolding, crates, sparks,
 * dust"): fixed-size pools stepped on the CPU. Pure functions over typed
 * arrays (no allocation per frame), so they are cheap and unit-tested.
 *
 * Sparks: welding bursts that fly out in a cone, fall, bounce off the floor
 * and cool from white-yellow through orange to nothing. Dust: motes that
 * rise and drift lazily in a box, fading in and out.
 */
import type { Vec3 } from "../geometry/builder.ts";

export interface ParticlePool {
  readonly count: number;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  /** Seconds left; <= 0 is dead. */
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  /** Time until the next burst (sparks). */
  nextBurst: number;
}

export function createPool(count: number): ParticlePool {
  return {
    count,
    pos: new Float32Array(count * 3),
    vel: new Float32Array(count * 3),
    life: new Float32Array(count),
    maxLife: new Float32Array(count).fill(1),
    nextBurst: 0,
  };
}

export const GRAVITY = 9.8;
/** Fraction of vertical speed kept on a bounce. */
export const SPARK_BOUNCE = 0.35;
export const SPARKS_PER_BURST = 14;

/** Fraction of life left, 0 (dead) to 1 (just born). */
export function lifeFraction(pool: ParticlePool, i: number): number {
  const max = pool.maxLife[i] ?? 1;
  return Math.max(0, Math.min(1, (pool.life[i] ?? 0) / max));
}

export function stepSparks(pool: ParticlePool, dt: number, rand: () => number, origin: Vec3): void {
  const { pos, vel, life } = pool;
  for (let i = 0; i < pool.count; i++) {
    if ((life[i] ?? 0) <= 0) continue;
    const k = i * 3;
    vel[k + 1] = (vel[k + 1] ?? 0) - GRAVITY * dt;
    pos[k] = (pos[k] ?? 0) + (vel[k] ?? 0) * dt;
    pos[k + 1] = (pos[k + 1] ?? 0) + (vel[k + 1] ?? 0) * dt;
    pos[k + 2] = (pos[k + 2] ?? 0) + (vel[k + 2] ?? 0) * dt;
    if ((pos[k + 1] ?? 0) < 0) {
      pos[k + 1] = 0;
      vel[k + 1] = -(vel[k + 1] ?? 0) * SPARK_BOUNCE;
      vel[k] = (vel[k] ?? 0) * 0.6;
      vel[k + 2] = (vel[k + 2] ?? 0) * 0.6;
    }
    life[i] = (life[i] ?? 0) - dt;
  }
  pool.nextBurst -= dt;
  if (pool.nextBurst > 0) return;
  // A burst: revive dead sparks at the torch, flung out and up.
  pool.nextBurst = 0.15 + rand() * 0.6;
  let born = 0;
  for (let i = 0; i < pool.count && born < SPARKS_PER_BURST; i++) {
    if ((life[i] ?? 0) > 0) continue;
    const k = i * 3;
    const a = rand() * Math.PI * 2;
    const speed = 1.2 + rand() * 2.4;
    const up = 0.3 + rand() * 0.8;
    pos[k] = origin[0];
    pos[k + 1] = origin[1];
    pos[k + 2] = origin[2];
    vel[k] = Math.cos(a) * speed;
    vel[k + 1] = up * speed;
    vel[k + 2] = Math.sin(a) * speed;
    const max = 0.35 + rand() * 0.6;
    life[i] = max;
    pool.maxLife[i] = max;
    born++;
  }
}

/** Spark colour for a life fraction: white-hot, yellow, orange, then dark (additive, so invisible). */
export function sparkColor(
  f: number,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const t = Math.max(0, Math.min(1, f));
  out[0] = Math.min(1, 0.2 + t * 1.6);
  out[1] = Math.max(0, Math.min(1, t * 1.25 - 0.1));
  out[2] = Math.max(0, t * 1.2 - 0.6);
  return out;
}

export interface DustBox {
  center: Vec3;
  size: Vec3;
}

function spawnDust(
  pool: ParticlePool,
  i: number,
  rand: () => number,
  box: DustBox,
  anywhere: boolean,
) {
  const k = i * 3;
  pool.pos[k] = box.center[0] + (rand() - 0.5) * box.size[0];
  pool.pos[k + 1] = box.center[1] - box.size[1] / 2 + rand() * box.size[1] * (anywhere ? 1 : 0.3);
  pool.pos[k + 2] = box.center[2] + (rand() - 0.5) * box.size[2];
  pool.vel[k] = (rand() - 0.5) * 0.15;
  pool.vel[k + 1] = 0.05 + rand() * 0.18;
  pool.vel[k + 2] = (rand() - 0.5) * 0.15;
  const max = 3 + rand() * 4;
  pool.maxLife[i] = max;
  pool.life[i] = anywhere ? rand() * max : max;
}

/** Fill a dust pool with motes at random ages (call once). */
export function seedDust(pool: ParticlePool, rand: () => number, box: DustBox): void {
  for (let i = 0; i < pool.count; i++) spawnDust(pool, i, rand, box, true);
}

export function stepDust(
  pool: ParticlePool,
  dt: number,
  t: number,
  rand: () => number,
  box: DustBox,
): void {
  const { pos, vel, life } = pool;
  for (let i = 0; i < pool.count; i++) {
    const k = i * 3;
    life[i] = (life[i] ?? 0) - dt;
    const top = box.center[1] + box.size[1] / 2;
    if ((life[i] ?? 0) <= 0 || (pos[k + 1] ?? 0) > top) {
      spawnDust(pool, i, rand, box, false);
      continue;
    }
    // A lazy swirl on top of the drift.
    const swirl = Math.sin(t * 0.7 + i * 1.3) * 0.08;
    pos[k] = (pos[k] ?? 0) + ((vel[k] ?? 0) + swirl) * dt;
    pos[k + 1] = (pos[k + 1] ?? 0) + (vel[k + 1] ?? 0) * dt;
    pos[k + 2] = (pos[k + 2] ?? 0) + ((vel[k + 2] ?? 0) - swirl * 0.5) * dt;
  }
}

/** Dust brightness for a life fraction: fade in, hold, fade out. */
export function dustAlpha(f: number): number {
  return Math.sin(Math.PI * Math.max(0, Math.min(1, f)));
}

/** RGBA bytes of a soft round sprite (white, alpha falling off to the rim). */
export function softDotPixels(size = 32): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
      const a = Math.max(0, 1 - d) ** 1.6;
      const i = (y * size + x) * 4;
      out[i] = 255;
      out[i + 1] = 255;
      out[i + 2] = 255;
      out[i + 3] = Math.round(a * 255);
    }
  }
  return out;
}
