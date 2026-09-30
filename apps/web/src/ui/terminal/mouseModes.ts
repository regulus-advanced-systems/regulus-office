/**
 * Mouse tracking stays off in the office's terminals (#164).
 *
 * Claude Code (2.1.x) turns on any-event mouse tracking on its prompt
 * screen (`CSI ? 1000 h`, `1002`, `1003`, `1006`). tmux, even with its own
 * `mouse` option off, passes that request on to the attached client, which
 * is the browser's xterm. In mouse mode xterm reports a drag to the program
 * instead of selecting text, so nothing could be selected or copied (only a
 * Shift+drag selected, and nobody knew). The office terminals are for
 * reading and typing: a drag always selects. The host drops these modes
 * before xterm sees them; everything else in the same sequence still applies.
 */

/** DECSET modes that turn on mouse reporting or change its encoding. */
export const MOUSE_MODES: ReadonlySet<number> = new Set([
  9, // X10 mouse
  1000, // button events
  1001, // highlight tracking
  1002, // button + drag events
  1003, // any-event (motion) tracking
  1005, // UTF-8 encoding
  1006, // SGR encoding
  1015, // urxvt encoding
  1016, // SGR pixel encoding
]);

export interface ModeSplit {
  /** The program asked for mouse reporting (dropped). */
  mouse: number[];
  /** Every other mode in the same sequence (still applied). */
  rest: number[];
}

/** Splits the params of one `CSI ? … h` sequence (xterm hands sub-params as arrays). */
export function splitMouseModes(params: readonly (number | number[])[]): ModeSplit {
  const mouse: number[] = [];
  const rest: number[] = [];
  for (const p of params) {
    const mode = Array.isArray(p) ? p[0] : p;
    if (mode === undefined) continue;
    (MOUSE_MODES.has(mode) ? mouse : rest).push(mode);
  }
  return { mouse, rest };
}

/**
 * A wheel turn as an SGR mouse report ("wheel up" is button 64, "down" 65) at a
 * 1-based cell, for a controller whose program asked for mouse reports: the
 * wheel keeps scrolling Claude Code while a drag selects.
 */
export function sgrWheel(deltaY: number, col: number, row: number): string {
  const c = Math.max(1, Math.floor(col));
  const r = Math.max(1, Math.floor(row));
  return `\x1b[<${deltaY < 0 ? 64 : 65};${c};${r}M`;
}
