/**
 * Fixed-size pool of bubble slots: no allocation per bubble, and a hard cap
 * on how many are in the air (the renderer's instance count).
 */
import type { BubbleKind } from "./bubbleEmits.ts";
import type { V3 } from "./trajectory.ts";

export interface Bubble {
  kind: BubbleKind;
  /** Seconds since launch. */
  t: number;
  seed: number;
  flying: boolean;
  origin: V3;
  pos: V3;
  start: V3;
  target: V3;
  live: boolean;
}

const v3 = (): V3 => ({ x: 0, y: 0, z: 0 });

export class BubblePool {
  readonly #slots: Bubble[];
  #live = 0;

  constructor(readonly capacity: number) {
    this.#slots = Array.from({ length: capacity }, () => ({
      kind: "toolCalls" as BubbleKind,
      t: 0,
      seed: 0,
      flying: false,
      origin: v3(),
      pos: v3(),
      start: v3(),
      target: v3(),
      live: false,
    }));
  }

  /** Take a free slot for a new bubble, or null when all are in use. */
  acquire(kind: BubbleKind, origin: V3, seed: number): Bubble | null {
    const slot = this.#slots.find((s) => !s.live);
    if (!slot) return null;
    slot.kind = kind;
    slot.t = 0;
    slot.seed = seed % 1000;
    slot.flying = false;
    slot.origin.x = origin.x;
    slot.origin.y = origin.y;
    slot.origin.z = origin.z;
    slot.pos.x = origin.x;
    slot.pos.y = origin.y;
    slot.pos.z = origin.z;
    slot.live = true;
    this.#live += 1;
    return slot;
  }

  release(slot: Bubble): void {
    if (!slot.live) return;
    slot.live = false;
    this.#live -= 1;
  }

  /** Live slots (a snapshot, so releasing while iterating is safe). */
  active(): Bubble[] {
    return this.#live === 0 ? [] : this.#slots.filter((s) => s.live);
  }

  clear(): void {
    for (const s of this.#slots) s.live = false;
    this.#live = 0;
  }

  get size(): number {
    return this.#live;
  }
}
