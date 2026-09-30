/**
 * xterm.js host (research 01 §3): @xterm/xterm with the fit addon, the WebGL
 * renderer and clickable web links. When WebGL is unavailable or its context
 * is lost, xterm falls back to its DOM renderer (xterm 6 no longer ships a
 * canvas renderer). Loaded lazily so xterm stays out of the main office chunk
 * until a terminal opens.
 *
 * Watchers keep the agent's fixed grid and scale the font to fit it
 * (`setGrid` / `fit`); a controller fills the box at the readable default
 * font (`fitGrid`) and the caller sends the new size to the server (#156).
 *
 * Mouse tracking requests from the program are dropped so a drag always
 * selects text (#164, mouseModes.ts).
 */
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { type IBuffer, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { clampGrid, fitFontSize } from "./fit.ts";
import type { BufferLine, TerminalHost, TerminalHostOptions } from "./host.ts";
import { openExternalLink } from "./links.ts";
import { sgrWheel, splitMouseModes } from "./mouseModes.ts";

const THEME = {
  background: "#16161D",
  foreground: "#E8E6E3",
  cursor: "#F5A623",
  selectionBackground: "#2DBFE855",
};

/** Readable font for a controller's terminal, and the watcher's starting point. */
export const BASE_FONT_PX = 13;

/** Lines the sign-in link finder reads from the end of a buffer. */
const READ_LINES = 400;

/** Wheel travel (px) per scroll step sent to a program that asked for mouse reports. */
const WHEEL_STEP_PX = 40;

function linesOf(buffer: IBuffer): BufferLine[] {
  const out: BufferLine[] = [];
  for (let y = Math.max(0, buffer.length - READ_LINES); y < buffer.length; y++) {
    const line = buffer.getLine(y);
    if (line) out.push({ text: line.translateToString(true), wrapped: line.isWrapped });
  }
  return out;
}

export function createXtermHost(element: HTMLElement, options: TerminalHostOptions): TerminalHost {
  const term = new Terminal({
    cols: options.cols,
    rows: options.rows,
    fontFamily: '"JetBrains Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace',
    fontSize: BASE_FONT_PX,
    scrollback: 5000,
    disableStdin: true,
    cursorBlink: false,
    allowTransparency: false,
    theme: THEME,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // Only http(s) links, opened in a new tab without an opener (links.ts).
  term.loadAddon(new WebLinksAddon((_event, uri) => openExternalLink(uri)));
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
  const programMouse = keepMouseForSelection(term);
  let grid = { cols: options.cols, rows: options.rows };
  const refit = () => {
    const size = fitFontSize(term.options.fontSize ?? BASE_FONT_PX, fit.proposeDimensions(), grid);
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
    fitGrid: (max) => {
      if (term.options.fontSize !== BASE_FONT_PX) term.options.fontSize = BASE_FONT_PX;
      const next = clampGrid(fit.proposeDimensions(), max);
      if (!next) return null;
      grid = next;
      if (term.cols !== next.cols || term.rows !== next.rows) {
        term.resize(next.cols, next.rows);
        // tmux redraws the whole screen at the new size; keep the view on it.
        term.scrollToBottom();
      }
      return next;
    },
    setReadOnly: (readOnly) => {
      term.options.disableStdin = readOnly;
      term.options.cursorBlink = !readOnly;
    },
    focus: () => term.focus(),
    onData: (listener) => {
      const sub = term.onData(listener);
      return () => sub.dispose();
    },
    getSelection: () => term.getSelection(),
    onSelectionChange: (listener) => {
      const sub = term.onSelectionChange(listener);
      return () => sub.dispose();
    },
    getScreenText: () => {
      const buffer = term.buffer.active;
      const rows: string[] = [];
      for (let y = buffer.viewportY; y < buffer.viewportY + term.rows; y++) {
        const line = buffer.getLine(y);
        const text = line?.translateToString(true) ?? "";
        // A soft-wrapped row continues the one above (a long URL stays one line).
        if (line?.isWrapped && rows.length) rows[rows.length - 1] += text;
        else rows.push(text);
      }
      const trimmed = rows.map((row) => row.trimEnd());
      while (trimmed.length && trimmed.at(-1) === "") trimmed.pop();
      return trimmed.join("\n");
    },
    paste: (text) => {
      if (!term.options.disableStdin) term.paste(text);
    },
    readBuffer: () => {
      const { active, normal } = term.buffer;
      // tmux runs on the alternate screen; the scrollback sent on join is in the normal one.
      const lines =
        active.type === "alternate" ? [...linesOf(normal), ...linesOf(active)] : linesOf(active);
      return { cols: term.cols, lines };
    },
    onWrite: (listener) => {
      const sub = term.onWriteParsed(listener);
      return () => sub.dispose();
    },
    dispose: () => {
      programMouse.dispose();
      term.dispose();
    },
  };
}

/**
 * Drops the program's mouse tracking requests (a drag selects instead) and, while the
 * program wants mouse reports, turns the wheel into SGR wheel reports for a controller
 * rather than the arrow keys xterm would otherwise type into it.
 */
function keepMouseForSelection(term: Terminal): { dispose(): void } {
  const requested = new Set<number>();
  const set = term.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
    const { mouse, rest } = splitMouseModes(params);
    if (mouse.length === 0) return false;
    for (const m of mouse) requested.add(m);
    // Apply the other modes of a mixed sequence; they contain no mouse mode, so no loop.
    if (rest.length) term.write(`\x1b[?${rest.join(";")}h`);
    return true;
  });
  const reset = term.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
    for (const m of splitMouseModes(params).mouse) requested.delete(m);
    return false;
  });
  let travel = 0;
  term.attachCustomWheelEventHandler((event) => {
    if (requested.size === 0) return true;
    event.preventDefault();
    if (term.options.disableStdin || !requested.has(1006)) return false;
    travel += event.deltaMode === 0 ? event.deltaY : event.deltaY * WHEEL_STEP_PX;
    const screen = term.element?.querySelector(".xterm-screen")?.getBoundingClientRect();
    const col = screen ? ((event.clientX - screen.left) / screen.width) * term.cols + 1 : 1;
    const row = screen ? ((event.clientY - screen.top) / screen.height) * term.rows + 1 : 1;
    while (Math.abs(travel) >= WHEEL_STEP_PX) {
      term.input(sgrWheel(travel, Math.min(col, term.cols), Math.min(row, term.rows)), true);
      travel -= Math.sign(travel) * WHEEL_STEP_PX;
    }
    return false;
  });
  return {
    dispose: () => {
      set.dispose();
      reset.dispose();
    },
  };
}
