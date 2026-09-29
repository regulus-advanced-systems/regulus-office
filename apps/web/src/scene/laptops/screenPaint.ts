/**
 * Laptop screen pictures (SPEC §9.4, research 01 §7): the robot's visible
 * pane text drawn with Canvas 2D into a small texture, repainted at most
 * {@link SCREEN_REPAINT_MS} apart per laptop however often the text changes.
 */

/** Texture size: 16:10 like the screen, 1.4x the #111 texture to match the 1.4x laptop (#143). */
export const SCREEN_TEXTURE_SIZE = { width: 360, height: 224 } as const;
/** ~2 fps per laptop. */
export const SCREEN_REPAINT_MS = 500;
/** Grid the text is laid out on (the agents' fixed 160x45 terminal). */
const GRID = { cols: 160, rows: 45 };

export const SCREEN_COLORS = {
  off: "#0D0E12",
  background: "#16161D",
  text: "#C9D1D9",
  prompt: "#2DBFE8",
} as const;

/** Minimal Canvas 2D surface this module draws on (a real context, or a recorder in tests). */
export interface Paintable {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
}

/** Draw `text` (or a dark, switched-off screen for null) over the whole texture. */
export function paintScreen(
  ctx: Paintable,
  text: string | null,
  size: { width: number; height: number } = SCREEN_TEXTURE_SIZE,
): void {
  if (text === null) {
    ctx.fillStyle = SCREEN_COLORS.off;
    ctx.fillRect(0, 0, size.width, size.height);
    return;
  }
  ctx.fillStyle = SCREEN_COLORS.background;
  ctx.fillRect(0, 0, size.width, size.height);
  const lineH = size.height / GRID.rows;
  const lines = text.split("\n").slice(-GRID.rows);
  // Monospace at the line height is roughly 0.6 em wide: keep 160 columns inside the width.
  const fontPx = Math.max(2, Math.min(lineH, size.width / GRID.cols / 0.6));
  ctx.font = `${fontPx}px monospace`;
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim().length === 0) continue;
    ctx.fillStyle = /^\s*[$>❯›]/.test(line) ? SCREEN_COLORS.prompt : SCREEN_COLORS.text;
    ctx.fillText(line, 1, i * lineH);
  }
}

/**
 * Per-laptop repaint throttle: `submit` marks new text; `due` lists laptops
 * whose latest text has not been painted and whose last paint is at least
 * `minIntervalMs` old. The newest text always wins; intermediate ones are
 * skipped.
 */
export class RepaintThrottle {
  readonly #min: number;
  readonly #pending = new Map<string, string | null>();
  readonly #lastPaint = new Map<string, number>();

  constructor(minIntervalMs = SCREEN_REPAINT_MS) {
    this.#min = minIntervalMs;
  }

  submit(id: string, text: string | null): void {
    this.#pending.set(id, text);
  }

  /** Laptops to repaint now with their text; marks them painted at `now`. */
  take(now: number): [string, string | null][] {
    const out: [string, string | null][] = [];
    for (const [id, text] of this.#pending) {
      const last = this.#lastPaint.get(id);
      if (last !== undefined && now - last < this.#min) continue;
      out.push([id, text]);
      this.#lastPaint.set(id, now);
      this.#pending.delete(id);
    }
    return out;
  }

  forget(id: string): void {
    this.#pending.delete(id);
    this.#lastPaint.delete(id);
  }

  get pendingCount(): number {
    return this.#pending.size;
  }
}
