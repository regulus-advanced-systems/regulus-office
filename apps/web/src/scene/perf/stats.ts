/** `?stats` shows the fps panel and publishes a rolling fps on `window.__regulusFps`. */
export function statsEnabled(search: string): boolean {
  return new URLSearchParams(search).has("stats");
}

declare global {
  interface Window {
    /** Frames per second over the last ~1 s, only when `?stats` is set. */
    __regulusFps?: number;
    /** The R3F root state (scene, gl, camera), only when `?stats` is set (for perf/debug scripts). */
    __regulusR3F?: unknown;
  }
}

/** Rolling fps counter: feed it frame timestamps, read `.fps`. */
export class FpsCounter {
  fps = 0;
  private frames = 0;
  private windowStart: number | null = null;

  constructor(private readonly windowMs = 1000) {}

  /** Record a frame at time `now` (ms). The first call only opens the window. */
  tick(now: number): number {
    if (this.windowStart === null) {
      this.windowStart = now;
      return this.fps;
    }
    this.frames += 1;
    const elapsed = now - this.windowStart;
    if (elapsed >= this.windowMs) {
      this.fps = (this.frames * 1000) / elapsed;
      this.frames = 0;
      this.windowStart = now;
    }
    return this.fps;
  }
}
