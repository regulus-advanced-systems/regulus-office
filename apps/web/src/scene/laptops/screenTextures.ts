/**
 * One `CanvasTexture` per robot screen (SPEC §9.4), fed by the screen feed
 * and repainted through {@link RepaintThrottle} from the render loop, so a
 * hidden tab (render loop paused, SPEC §11) paints nothing.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";
import {
  type Paintable,
  paintScreen,
  RepaintThrottle,
  SCREEN_TEXTURE_SIZE,
} from "./screenPaint.ts";

interface Entry {
  ctx: Paintable | null;
  texture: CanvasTexture;
}

export type CanvasFactory = () => HTMLCanvasElement;

const domCanvas: CanvasFactory = () => {
  const canvas = document.createElement("canvas");
  canvas.width = SCREEN_TEXTURE_SIZE.width;
  canvas.height = SCREEN_TEXTURE_SIZE.height;
  return canvas;
};

export class ScreenTextures {
  readonly #entries = new Map<string, Entry>();
  readonly #throttle: RepaintThrottle;
  readonly #createCanvas: CanvasFactory;
  /** Repaints so far (perf probe and tests). */
  paints = 0;

  constructor(options: { createCanvas?: CanvasFactory; throttle?: RepaintThrottle } = {}) {
    this.#createCanvas = options.createCanvas ?? domCanvas;
    this.#throttle = options.throttle ?? new RepaintThrottle();
  }

  /** The texture for `agentId`; created dark on first use. */
  texture(agentId: string): CanvasTexture {
    return this.#entry(agentId).texture;
  }

  setText(agentId: string, text: string | null): void {
    this.#throttle.submit(agentId, text);
  }

  /** Repaint what the throttle allows; call once per frame. Returns how many were painted. */
  flush(now: number): number {
    let painted = 0;
    for (const [agentId, text] of this.#throttle.take(now)) {
      const entry = this.#entries.get(agentId);
      if (!entry?.ctx) continue;
      paintScreen(entry.ctx, text);
      entry.texture.needsUpdate = true;
      painted += 1;
    }
    this.paints += painted;
    return painted;
  }

  /** Drop textures of robots no longer shown. */
  retain(agentIds: ReadonlySet<string>): void {
    for (const [agentId, entry] of this.#entries) {
      if (agentIds.has(agentId)) continue;
      entry.texture.dispose();
      this.#entries.delete(agentId);
      this.#throttle.forget(agentId);
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  dispose(): void {
    for (const entry of this.#entries.values()) entry.texture.dispose();
    this.#entries.clear();
  }

  #entry(agentId: string): Entry {
    let entry = this.#entries.get(agentId);
    if (entry) return entry;
    const canvas = this.#createCanvas();
    const ctx = canvas.getContext("2d") as Paintable | null;
    if (ctx) paintScreen(ctx, null);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.generateMipmaps = false;
    entry = { ctx, texture };
    this.#entries.set(agentId, entry);
    return entry;
  }
}
