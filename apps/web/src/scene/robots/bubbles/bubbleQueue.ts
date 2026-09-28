/**
 * Spreads a robot's bubbles out in time (one every `EMIT_INTERVAL_MS` per
 * robot) and bounds the backlog. Pure bookkeeping; the renderer asks for the
 * bubbles that are due each frame.
 */
import type { BubbleKind } from "./bubbleEmits.ts";

export const EMIT_INTERVAL_MS = 160;
/** Bubbles a robot may have waiting; more are dropped (they count in the HUD at once). */
export const MAX_QUEUED_PER_ROBOT = 12;

export interface DueBubble {
  agentId: string;
  kind: BubbleKind;
}

export class BubbleQueue {
  readonly #queues = new Map<string, { kinds: BubbleKind[]; next: number }>();

  /** Queue bubbles for a robot; returns the ones that were dropped. */
  push(agentId: string, kinds: readonly BubbleKind[], now: number): BubbleKind[] {
    let q = this.#queues.get(agentId);
    if (!q) {
      q = { kinds: [], next: now };
      this.#queues.set(agentId, q);
    }
    if (q.kinds.length === 0) q.next = Math.max(q.next, now);
    const room = Math.max(0, MAX_QUEUED_PER_ROBOT - q.kinds.length);
    q.kinds.push(...kinds.slice(0, room));
    return kinds.slice(room);
  }

  /** Bubbles whose time has come, at most one per robot per interval. */
  due(now: number): DueBubble[] {
    const out: DueBubble[] = [];
    for (const [agentId, q] of this.#queues) {
      if (q.kinds.length === 0 || now < q.next) continue;
      const kind = q.kinds.shift() as BubbleKind;
      out.push({ agentId, kind });
      q.next = now + EMIT_INTERVAL_MS;
    }
    return out;
  }

  /** Forget a robot; returns what it still had queued. */
  drop(agentId: string): BubbleKind[] {
    const q = this.#queues.get(agentId);
    this.#queues.delete(agentId);
    return q?.kinds ?? [];
  }

  /** Everything still queued (reduced motion switched on, floor left). */
  clear(): BubbleKind[] {
    const all = [...this.#queues.values()].flatMap((q) => q.kinds);
    this.#queues.clear();
    return all;
  }

  get size(): number {
    let n = 0;
    for (const q of this.#queues.values()) n += q.kinds.length;
    return n;
  }
}
