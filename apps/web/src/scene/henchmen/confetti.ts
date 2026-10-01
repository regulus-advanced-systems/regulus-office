/**
 * Confetti for a henchman that finished (SPEC §9.3 celebrate: spin + confetti).
 * A fixed particle pool with simple ballistic motion and tumble; bursts
 * reuse the oldest particles when the pool is full. Pure, deterministic
 * with an injected random source.
 */
import { colors } from "../../ui/theme.ts";

export const CONFETTI_COLORS = [
  colors.amber,
  colors.cyan,
  colors.blue,
  colors.orangeRed,
  colors.crimson,
  "#3DCB6A",
] as const;
export const CONFETTI_CAPACITY = 320;
export const CONFETTI_PER_BURST = 80;
export const CONFETTI_LIFETIME = 2.2;
const GRAVITY = 5.5;
const DRAG = 1.6;
/** Longest motion step per frame, seconds. */
const MAX_MOTION_STEP = 0.1;

export interface Particle {
  live: boolean;
  age: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  spin: number;
  color: number;
}

export class ConfettiField {
  readonly particles: Particle[];
  #next = 0;

  constructor(
    readonly capacity = CONFETTI_CAPACITY,
    private readonly random: () => number = Math.random,
  ) {
    this.particles = Array.from({ length: capacity }, () => ({
      live: false,
      age: 0,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      rx: 0,
      ry: 0,
      spin: 0,
      color: 0,
    }));
  }

  burst(origin: { x: number; y: number; z: number }, count = CONFETTI_PER_BURST): void {
    const r = this.random;
    for (let i = 0; i < Math.min(count, this.capacity); i++) {
      const p = this.particles[this.#next] as Particle;
      this.#next = (this.#next + 1) % this.capacity;
      const angle = r() * Math.PI * 2;
      const speed = 0.6 + r() * 1.4;
      p.live = true;
      p.age = 0;
      p.x = origin.x;
      p.y = origin.y;
      p.z = origin.z;
      p.vx = Math.cos(angle) * speed;
      p.vz = Math.sin(angle) * speed;
      p.vy = 2.6 + r() * 1.8;
      p.rx = r() * Math.PI;
      p.ry = r() * Math.PI;
      p.spin = (r() - 0.5) * 14;
      p.color = Math.floor(r() * CONFETTI_COLORS.length);
    }
  }

  /**
   * Advance by `dt` seconds; returns how many particles are alive. Particles
   * age by the real `dt`, so a burst is gone after its lifetime in wall-clock
   * time even at a low frame rate; the motion integrates at most
   * `MAX_MOTION_STEP` per call, so a long frame does not fling them away.
   */
  step(dt: number): number {
    let live = 0;
    const age = Math.max(0, dt);
    dt = Math.min(age, MAX_MOTION_STEP);
    const drag = Math.exp(-DRAG * dt);
    for (const p of this.particles) {
      if (!p.live) continue;
      p.age += age;
      if (p.age >= CONFETTI_LIFETIME || p.y < 0) {
        p.live = false;
        continue;
      }
      p.vx *= drag;
      p.vz *= drag;
      p.vy = p.vy * drag - GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rx += p.spin * dt;
      p.ry += p.spin * 0.7 * dt;
      live += 1;
    }
    return live;
  }

  clear(): void {
    for (const p of this.particles) p.live = false;
  }
}
