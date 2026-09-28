/**
 * One live terminal: an xterm host in `element` wired to a
 * {@link TerminalConnection}, plus the UI state the modal shows. Everything
 * is torn down when the agent, the requested mode or the element changes,
 * and on unmount (socket closed, xterm and its WebGL context disposed).
 */
import { TERMINAL_DEFAULT_SIZE, type TerminalMode, terminalWsPath } from "@regulus/protocol";
import { useEffect, useReducer, useRef } from "react";
import { officeServerUrl, toWebSocketUrl } from "../../net/serverUrl.ts";
import { TerminalConnection } from "./connection.ts";
import { defaultTerminalDeps, type TerminalDeps, type TerminalHost } from "./host.ts";
import {
  INITIAL_TERMINAL_STATE,
  type TerminalEvent,
  type TerminalUiState,
  terminalReducer,
} from "./terminalState.ts";

export interface UseTerminalOptions {
  agentId: string | null;
  mode: TerminalMode;
  element: HTMLElement | null;
  deps?: TerminalDeps;
  /** Take keyboard focus once connected in control mode. */
  autoFocus?: boolean;
  /** Called when the server refused control and the view fell back to watch. */
  onDowngrade?: () => void;
}

export interface UseTerminalResult {
  state: TerminalUiState;
  /** The live host, for tests and the renderer badge. */
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
}: UseTerminalOptions): UseTerminalResult {
  const [state, dispatch] = useReducer(terminalReducer, INITIAL_TERMINAL_STATE);
  const hostRef = useRef<TerminalHost | null>(null);
  const downgradeRef = useRef(onDowngrade);
  downgradeRef.current = onDowngrade;

  useEffect(() => {
    if (!agentId || !element) return;
    let cancelled = false;
    let connection: TerminalConnection | null = null;
    let host: TerminalHost | null = null;
    let offData: (() => void) | null = null;
    let observer: ResizeObserver | null = null;
    dispatch({ kind: "connecting", attempt: 0 });

    const onEvent = (event: TerminalEvent) => {
      if (cancelled) return;
      if (event.kind === "hello" && host) {
        // Every connection starts with its own scrollback: drop what the last one drew.
        host.reset();
        host.setGrid(event.cols, event.rows);
        host.setReadOnly(event.mode !== "control");
        if (event.mode === "control" && autoFocus) host.focus();
      }
      if (event.kind === "downgraded") downgradeRef.current?.();
      dispatch(event);
    };

    void (async () => {
      const created = await deps.createHost(element, TERMINAL_DEFAULT_SIZE);
      if (cancelled) {
        created.dispose();
        return;
      }
      host = created;
      hostRef.current = created;
      const base = (deps.wsBase ?? defaultWsBase)();
      connection = new TerminalConnection({
        url: (m) => `${base}${terminalWsPath(agentId, m)}`,
        mode,
        socket: deps.socket,
        onBytes: (bytes) => host?.write(bytes),
        onEvent,
      });
      offData = created.onData((data) => connection?.send(data));
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => host?.fit());
        observer.observe(element);
      }
      connection.connect();
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      offData?.();
      connection?.dispose();
      host?.dispose();
      hostRef.current = null;
    };
  }, [agentId, mode, element, deps, autoFocus]);

  // Expire "X is typing" when no new notice arrives.
  useEffect(() => {
    if (!state.typing) return;
    const ms = Math.max(0, state.typing.until - Date.now());
    const timer = setTimeout(() => dispatch({ kind: "tick", now: Date.now() }), ms + 10);
    return () => clearTimeout(timer);
  }, [state.typing]);

  return { state, host: hostRef.current };
}
