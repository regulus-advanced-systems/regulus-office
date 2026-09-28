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

export interface TerminalHost {
  readonly renderer: "webgl" | "dom";
  write(bytes: Uint8Array): void;
  /** Clear screen and scrollback (before a reconnect's scrollback arrives). */
  reset(): void;
  /** Fixed grid from `hello`; the font scales to fit it. */
  setGrid(cols: number, rows: number): void;
  /** Re-scale after the container changed size. */
  fit(): void;
  setReadOnly(readOnly: boolean): void;
  focus(): void;
  onData(listener: (data: string) => void): () => void;
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
