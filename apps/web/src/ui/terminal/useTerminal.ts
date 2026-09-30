/**
 * One live terminal: an xterm host in `element` wired to a
 * {@link TerminalConnection}, plus the UI state the modal shows. Everything
 * is torn down when the agent, the requested mode or the element changes,
 * and on unmount (socket closed, xterm and its WebGL context disposed).
 *
 * Sizing (#156): a watcher keeps the agent's fixed grid and scales the font
 * to its box. A controller fills its box at the readable font and sends
 * `resize` so tmux reflows (the server honours it only from controllers).
 */
import {
  TERMINAL_DEFAULT_SIZE,
  TERMINAL_SIZE_LIMITS,
  type TerminalMode,
  terminalWsPath,
} from "@regulus/protocol";
import { useEffect, useReducer, useRef, useState } from "react";
import { officeServerUrl, toWebSocketUrl } from "../../net/serverUrl.ts";
import { TerminalConnection } from "./connection.ts";
import {
  defaultTerminalDeps,
  type TerminalDeps,
  type TerminalGrid,
  type TerminalHost,
} from "./host.ts";
import {
  INITIAL_TERMINAL_STATE,
  type TerminalEvent,
  type TerminalUiState,
  terminalReducer,
} from "./terminalState.ts";

/** Largest grid a controller may ask for when nothing else limits it. */
export const MAX_CONTROL_GRID: TerminalGrid = {
  cols: TERMINAL_SIZE_LIMITS.maxCols,
  rows: TERMINAL_SIZE_LIMITS.maxRows,
};

/** Resizes settle this long before the new size goes to the server. */
export const RESIZE_DEBOUNCE_MS = 120;

export interface UseTerminalOptions {
  agentId: string | null;
  mode: TerminalMode;
  element: HTMLElement | null;
  deps?: TerminalDeps;
  /** Take keyboard focus once connected in control mode. */
  autoFocus?: boolean;
  /** Called when the server refused control and the view fell back to watch. */
  onDowngrade?: () => void;
  /**
   * Largest grid this controller asks tmux for. A robot's terminal stays within the
   * agent's default size, so watchers see it letterboxed rather than cut off.
   */
  maxGrid?: TerminalGrid;
}

export interface UseTerminalResult {
  state: TerminalUiState;
  /** The live host (clipboard, sign-in link finder, tests). */
  host: TerminalHost | null;
}

const defaultWsBase = () => toWebSocketUrl(officeServerUrl());

export function useTerminal({
  agentId,
  mode,
  element,
  deps = defaultTerminalDeps,
  autoFocus = false,
  onDowngrade,
  maxGrid = MAX_CONTROL_GRID,
}: UseTerminalOptions): UseTerminalResult {
  const [state, dispatch] = useReducer(terminalReducer, INITIAL_TERMINAL_STATE);
  const [host, setHost] = useState<TerminalHost | null>(null);
  const downgrade = useRef(onDowngrade);
  downgrade.current = onDowngrade;
  const maxCols = maxGrid.cols;
  const maxRows = maxGrid.rows;

  useEffect(() => {
    if (!agentId || !element) return;
    let cancelled = false;
    let connection: TerminalConnection | null = null;
    let live: TerminalHost | null = null;
    let offData: (() => void) | null = null;
    let observer: ResizeObserver | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const max = { cols: maxCols, rows: maxRows };
    dispatch({ kind: "connecting", attempt: 0 });

    /** Fit the box: a controller reflows tmux, a watcher scales the fixed grid. */
    const refit = () => {
      if (!live) return;
      if (connection?.granted !== "control") {
        live.fit();
        return;
      }
      const grid = live.fitGrid(max);
      if (grid) connection.resize(grid.cols, grid.rows);
    };

    const onEvent = (event: TerminalEvent) => {
      if (cancelled) return;
      if (event.kind === "hello" && live) {
        live.setGrid(event.cols, event.rows);
        live.setReadOnly(event.mode !== "control");
        // A controller takes its size before anything is drawn.
        if (event.mode === "control") refit();
        // Every connection starts with its own scrollback: drop what the last one drew. After
        // the resize, so both screens start clean at the new size.
        live.reset();
        if (event.mode === "control" && autoFocus) live.focus();
      }
      if (event.kind === "downgraded") downgrade.current?.();
      dispatch(event);
    };

    void (async () => {
      const created = await deps.createHost(element, TERMINAL_DEFAULT_SIZE);
      if (cancelled) {
        created.dispose();
        return;
      }
      live = created;
      setHost(created);
      const base = (deps.wsBase ?? defaultWsBase)();
      connection = new TerminalConnection({
        url: (m) => `${base}${terminalWsPath(agentId, m)}`,
        mode,
        socket: deps.socket,
        onBytes: (bytes) => live?.write(bytes),
        onEvent,
      });
      offData = created.onData((data) => connection?.send(data));
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => {
          // Watchers rescale at once; a controller's reflow waits for the size to settle.
          if (connection?.granted !== "control") return live?.fit();
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(refit, RESIZE_DEBOUNCE_MS);
        });
        observer.observe(element);
      }
      connection.connect();
    })();

    return () => {
      cancelled = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      observer?.disconnect();
      offData?.();
      connection?.dispose();
      live?.dispose();
      setHost(null);
    };
  }, [agentId, mode, element, deps, autoFocus, maxCols, maxRows]);

  // Expire "X is typing" when no new notice arrives.
  useEffect(() => {
    if (!state.typing) return;
    const ms = Math.max(0, state.typing.until - Date.now());
    const timer = setTimeout(() => dispatch({ kind: "tick", now: Date.now() }), ms + 10);
    return () => clearTimeout(timer);
  }, [state.typing]);

  return { state, host };
}
