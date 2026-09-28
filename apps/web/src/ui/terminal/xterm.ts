/**
 * xterm.js host (research 01 §3): @xterm/xterm with the fit addon (used to
 * scale the font to the fixed grid) and the WebGL renderer. When WebGL is
 * unavailable or its context is lost, xterm falls back to its DOM renderer
 * (xterm 6 no longer ships a canvas renderer). Loaded lazily so xterm stays
 * out of the main office chunk until a terminal opens.
 */
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { fitFontSize } from "./fit.ts";
import type { TerminalHost, TerminalHostOptions } from "./host.ts";

const THEME = {
  background: "#16161D",
  foreground: "#E8E6E3",
  cursor: "#F5A623",
  selectionBackground: "#2DBFE855",
};

export function createXtermHost(element: HTMLElement, options: TerminalHostOptions): TerminalHost {
  const term = new Terminal({
    cols: options.cols,
    rows: options.rows,
    fontFamily: '"JetBrains Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace',
    fontSize: 13,
    scrollback: 5000,
    disableStdin: true,
    cursorBlink: false,
    allowTransparency: false,
    theme: THEME,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(element);
  let renderer: "webgl" | "dom" = "dom";
  if (options.webgl !== false) {
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        renderer = "dom";
      });
      term.loadAddon(webgl);
      renderer = "webgl";
    } catch {
      renderer = "dom";
    }
  }
  let grid = { cols: options.cols, rows: options.rows };
  const refit = () => {
    const size = fitFontSize(term.options.fontSize ?? 13, fit.proposeDimensions(), grid);
    if (size !== term.options.fontSize) term.options.fontSize = size;
    if (term.cols !== grid.cols || term.rows !== grid.rows) term.resize(grid.cols, grid.rows);
  };
  return {
    get renderer() {
      return renderer;
    },
    write: (bytes) => term.write(bytes),
    reset: () => term.reset(),
    setGrid: (cols, rows) => {
      grid = { cols, rows };
      refit();
    },
    fit: refit,
    setReadOnly: (readOnly) => {
      term.options.disableStdin = readOnly;
      term.options.cursorBlink = !readOnly;
    },
    focus: () => term.focus(),
    onData: (listener) => {
      const sub = term.onData(listener);
      return () => sub.dispose();
    },
    dispose: () => term.dispose(),
  };
}
