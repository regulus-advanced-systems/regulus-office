/**
 * Baked blob shadows (SPEC §12 "soft contact shadows"; research 03 §3:
 * "soft low-opacity blobs under objects plus a longer soft shadow toward
 * south-east"). One shared radial-alpha texture on a small plane under each
 * piece; no shadow maps, no extra render passes.
 */
import type { Rect } from "@regulus/floor-layout";
import { DataTexture, LinearFilter, RGBAFormat, SRGBColorSpace } from "three";

export const BLOB_TEXTURE_SIZE = 64;
/** Shadow colour and peak opacity. */
export const BLOB_COLOR = "#2E2416";
export const BLOB_OPACITY = 0.6;
/** How far the blob spreads past the footprint on each side, metres. */
export const BLOB_SPREAD = 0.35;
/** Offset of the blob toward screen-bottom-right (world +x, +z), metres. */
export const BLOB_OFFSET = 0.12;
/** Height above the floor plane, to avoid z-fighting. */
export const BLOB_Y = 0.006;

/**
 * RGBA pixels of a white square whose alpha falls off smoothly from the
 * centre: full inside `core` (fraction of the half-size), zero at the edge.
 */
export function blobPixels(size = BLOB_TEXTURE_SIZE, core = 0.45): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Rounded-rectangle distance so long objects get long blobs, not circles.
      const dx = Math.max(0, Math.abs(x + 0.5 - half) / half - core);
      const dy = Math.max(0, Math.abs(y + 0.5 - half) / half - core);
      const d = Math.hypot(dx, dy) / (1 - core);
      const t = Math.min(1, Math.max(0, d));
      const alpha = 1 - t * t * (3 - 2 * t);
      const i = (y * size + x) * 4;
      out[i] = 255;
      out[i + 1] = 255;
      out[i + 2] = 255;
      out[i + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

export function createBlobTexture(size = BLOB_TEXTURE_SIZE): DataTexture {
  const tex = new DataTexture(blobPixels(size), size, size, RGBAFormat);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

let shared: DataTexture | null = null;
export function sharedBlobTexture(): DataTexture {
  shared ??= createBlobTexture();
  return shared;
}

export interface BlobPlacement {
  position: readonly [number, number, number];
  width: number;
  depth: number;
}

/** Where a piece's blob goes: its footprint grown by the spread, nudged south-east. */
export function blobPlacement(
  rect: Rect,
  spread = BLOB_SPREAD,
  offset = BLOB_OFFSET,
): BlobPlacement {
  return {
    position: [rect.x + rect.w / 2 + offset, BLOB_Y, rect.z + rect.d / 2 + offset],
    width: rect.w + 2 * spread,
    depth: rect.d + 2 * spread,
  };
}
