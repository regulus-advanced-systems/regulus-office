/** A scripted terminal host for the terminal and login panel tests. Only imported by tests. */
import type { BufferLine, TerminalGrid, TerminalHost } from "./host.ts";

export class FakeHost implements TerminalHost {
  static all: FakeHost[] = [];
  readonly renderer = "dom" as const;
  written = "";
  resets = 0;
  readOnly = true;
  disposed = false;
  focused = 0;
  grid: [number, number] | null = null;
  /** What `fitGrid` proposes (the cells that fit the box), or null for "no size yet". */
  fits: TerminalGrid | null = { cols: 120, rows: 30 };
  selection = "";
  pasted: string[] = [];
  lines: BufferLine[] = [];
  cols = 160;
  #listener: ((data: string) => void) | null = null;
  #writeListeners = new Set<() => void>();
  constructor() {
    FakeHost.all.push(this);
  }
  write(bytes: Uint8Array) {
    this.written += new TextDecoder().decode(bytes);
    for (const l of this.#writeListeners) l();
  }
  reset() {
    this.resets += 1;
    this.written = "";
  }
  setGrid(cols: number, rows: number) {
    this.grid = [cols, rows];
  }
  fit() {}
  fitGrid(max: TerminalGrid) {
    if (!this.fits) return null;
    const grid = {
      cols: Math.min(max.cols, this.fits.cols),
      rows: Math.min(max.rows, this.fits.rows),
    };
    this.grid = [grid.cols, grid.rows];
    return grid;
  }
  setReadOnly(readOnly: boolean) {
    this.readOnly = readOnly;
  }
  focus() {
    this.focused += 1;
  }
  onData(listener: (data: string) => void) {
    this.#listener = listener;
    return () => {
      this.#listener = null;
    };
  }
  type(data: string) {
    this.#listener?.(data);
  }
  getSelection() {
    return this.selection;
  }
  paste(text: string) {
    if (this.readOnly) return;
    this.pasted.push(text);
    this.#listener?.(text);
  }
  readBuffer() {
    return { cols: this.cols, lines: this.lines };
  }
  onWrite(listener: () => void) {
    this.#writeListeners.add(listener);
    return () => {
      this.#writeListeners.delete(listener);
    };
  }
  dispose() {
    this.disposed = true;
  }
}
