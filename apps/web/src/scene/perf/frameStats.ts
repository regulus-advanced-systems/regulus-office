/**
 * Frame-time statistics for the §11 performance gate (#190): a ring of
 * recent frame intervals and main-thread times, their percentiles, and an
 * estimate of the texture memory a scene holds. Pure, so it is unit-tested;
 * `PerfProbe.tsx` feeds it from the render loop and publishes it on
 * `window.__regulusPerf` (only with `?stats`).
 */

/** Nearest-rank percentile of `values` (0..100); 0 for no values. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? 0;
}

/** A fixed-size ring of numbers. */
export class Ring {
  private readonly buf: number[] = [];
  private at = 0;
  constructor(private readonly size: number) {}
  push(v: number): void {
    if (this.buf.length < this.size) this.buf.push(v);
    else this.buf[this.at] = v;
    this.at = (this.at + 1) % this.size;
  }
  values(): number[] {
    return [...this.buf];
  }
  clear(): void {
    this.buf.length = 0;
    this.at = 0;
  }
}

export interface FrameSummary {
  frames: number;
  /** Frames per second from the mean interval. */
  fps: number;
  /** Frame interval percentiles, ms. */
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  /** Main-thread time per frame (scene update + render submission), ms. */
  cpuP50: number;
  cpuP90: number;
}

const round = (v: number) => Math.round(v * 100) / 100;

export function summarise(intervals: readonly number[], cpu: readonly number[]): FrameSummary {
  const mean = intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length);
  return {
    frames: intervals.length,
    fps: mean > 0 ? round(1000 / mean) : 0,
    p50: round(percentile(intervals, 50)),
    p90: round(percentile(intervals, 90)),
    p95: round(percentile(intervals, 95)),
    p99: round(percentile(intervals, 99)),
    max: round(intervals.reduce((a, b) => Math.max(a, b), 0)),
    cpuP50: round(percentile(cpu, 50)),
    cpuP90: round(percentile(cpu, 90)),
  };
}

interface TextureLike {
  uuid: string;
  isTexture?: boolean;
  image?: unknown;
  mipmaps?: unknown[];
  generateMipmaps?: boolean;
}

/** Width and height of a texture's image (canvas, image, bitmap or data texture). */
function imageSize(image: unknown): { w: number; h: number } | null {
  if (!image || typeof image !== "object") return null;
  const i = image as { width?: unknown; height?: unknown };
  return typeof i.width === "number" && typeof i.height === "number"
    ? { w: i.width, h: i.height }
    : null;
}

/** Approximate GPU bytes of one texture: RGBA8, plus a third for its mip chain. */
export function textureBytes(t: TextureLike): number {
  const size = imageSize(t.image);
  if (!size) return 0;
  const base = size.w * size.h * 4;
  return t.generateMipmaps === false ? base : Math.round((base * 4) / 3);
}

/** Distinct textures among materials' properties, and their estimated bytes. */
export function textureMemory(materials: Iterable<object>): { count: number; bytes: number } {
  const seen = new Map<string, number>();
  for (const m of materials) {
    for (const v of Object.values(m)) {
      const t = v as TextureLike | null;
      if (t && typeof t === "object" && t.isTexture && !seen.has(t.uuid))
        seen.set(t.uuid, textureBytes(t));
    }
    const uniforms = (m as { uniforms?: Record<string, { value?: unknown }> }).uniforms;
    for (const u of Object.values(uniforms ?? {})) {
      const t = u?.value as TextureLike | null;
      if (t && typeof t === "object" && t.isTexture && !seen.has(t.uuid))
        seen.set(t.uuid, textureBytes(t));
    }
  }
  let bytes = 0;
  for (const b of seen.values()) bytes += b;
  return { count: seen.size, bytes };
}
