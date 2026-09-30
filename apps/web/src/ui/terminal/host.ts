/**
 * The terminal widget as the modal and the laptop panel see it; the real one
 * is xterm.js (`xterm.ts`, loaded lazily), tests inject a fake.
 */
import type { SocketFactory } from "./connection.ts";

export interface TerminalHostOptions {
  cols: number;
  rows: number;
  /** Try the WebGL renderer (default true). */
  webgl?: boolean;
}

export interface TerminalGrid {
  cols: number;
  rows: number;
}

/** One line of the terminal buffer as text, for the client-side sign-in link finder. */
export interface BufferLine {
  text: string;
  /** xterm soft-wrapped this line onto the previous one. */
  wrapped: boolean;
}

export interface TerminalHost {
  readonly renderer: "webgl" | "dom";
  write(bytes: Uint8Array): void;
  /** Clear screen and scrollback (before a reconnect's scrollback arrives). */
  reset(): void;
  /** Fixed grid from `hello` (watchers): the font scales to fit it. */
  setGrid(cols: number, rows: number): void;
  /** Re-scale after the container changed size. */
  fit(): void;
  /**
   * Control mode: the readable default font, and as many cells as fit the
   * box (at most `max`). Returns the new grid, or null when the box has no size.
   */
  fitGrid(max: TerminalGrid): TerminalGrid | null;
  setReadOnly(readOnly: boolean): void;
  focus(): void;
  onData(listener: (data: string) => void): () => void;
  /** The selected text ("" when nothing is selected). */
  getSelection(): string;
  /** Paste as typed input (bracketed when the program asked for it); ignored while read-only. */
  paste(text: string): void;
  /** The terminal's width and its recent lines (scrollback and screen), oldest first. */
  readBuffer(): { cols: number; lines: BufferLine[] };
  /** After new output was parsed (for the sign-in link finder). */
  onWrite(listener: () => void): () => void;
  dispose(): void;
}

export type HostFactory = (
  element: HTMLElement,
  options: TerminalHostOptions,
) => Promise<TerminalHost>;

export interface TerminalDeps {
  createHost: HostFactory;
  socket?: SocketFactory;
  /** Base ws(s) URL of the office server. */
  wsBase?: () => string;
}

export const defaultTerminalDeps: TerminalDeps = {
  createHost: async (element, options) =>
    (await import("./xterm.ts")).createXtermHost(element, options),
};
