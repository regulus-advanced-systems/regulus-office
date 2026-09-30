/**
 * One `CanvasTexture` per usage screen (#40). Repaints only when the picture
 * would change (the data, or the minute for "resets in" countdowns), so an
 * idle office costs no canvas work.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";
import type { UsageModel } from "../../ui/usage/model.ts";
import {
  paintUsageScreen,
  USAGE_TEXTURE_SIZE,
  type UsagePaintable,
  type UsageScreenVariant,
} from "./usagePaint.ts";

export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement;

const domCanvas: CanvasFactory = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

export class UsageTexture {
  readonly texture: CanvasTexture;
  readonly #ctx: UsagePaintable | null;
  #last = "";
  /** Repaints so far (tests, perf probe). */
  paints = 0;

  constructor(
    readonly variant: UsageScreenVariant,
    createCanvas: CanvasFactory = domCanvas,
  ) {
    const size = USAGE_TEXTURE_SIZE[variant];
    const canvas = createCanvas(size.width, size.height);
    this.#ctx = canvas.getContext("2d") as UsagePaintable | null;
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
  }

  /** Paint `model` unless it is what the screen already shows. */
  update(model: UsageModel): boolean {
    const key = JSON.stringify(model);
    if (key === this.#last || !this.#ctx) return false;
    this.#last = key;
    paintUsageScreen(this.#ctx, model, this.variant);
    this.texture.needsUpdate = true;
    this.paints += 1;
    return true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/** The lobby's big wall (≥ 2 m wide) gets the full layout, room screens the compact one. */
export function variantForAnchor(width: number): UsageScreenVariant {
  return width >= 2 ? "wall" : "compact";
}
