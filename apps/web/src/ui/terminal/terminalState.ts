/**
 * What the terminal modal shows, as a pure reducer over connection events:
 * status line, granted mode, viewer count and faces, and "X is typing".
 */
import { accessCloseMessage, type TerminalMode, type TerminalPeer } from "@regulus/protocol";

export type TerminalStatus = "connecting" | "open" | "reconnecting" | "ended" | "unavailable";

/** How long a `typing` notice stays up without another one. */
export const TYPING_VISIBLE_MS = 2500;

export interface TerminalUiState {
  status: TerminalStatus;
  /** Mode the server granted on the current connection (null before `hello`). */
  mode: TerminalMode | null;
  viewers: number;
  peers: TerminalPeer[];
  typing: { userId: string; name: string; until: number } | null;
  /** One-line notice (control refused, reconnecting in n s, session ended). */
  notice: string | null;
}

export type TerminalEvent =
  | { kind: "connecting"; attempt: number }
  | {
      kind: "hello";
      mode: TerminalMode;
      cols: number;
      rows: number;
      viewers: number;
      peers?: TerminalPeer[];
    }
  | { kind: "viewers"; viewers: number; peers?: TerminalPeer[] }
  | { kind: "typing"; userId: string; name: string; at: number }
  | { kind: "retry"; delayMs: number }
  | { kind: "downgraded" }
  | { kind: "ended" }
  | { kind: "unavailable" }
  /** The server closed the terminal: signed out, or no access to it any more (#244). */
  | { kind: "access_lost"; signedOut: boolean }
  | { kind: "tick"; now: number };

export const INITIAL_TERMINAL_STATE: TerminalUiState = {
  status: "connecting",
  mode: null,
  viewers: 0,
  peers: [],
  typing: null,
  notice: null,
};

export function terminalReducer(state: TerminalUiState, event: TerminalEvent): TerminalUiState {
  switch (event.kind) {
    case "connecting":
      return { ...state, status: event.attempt === 0 ? "connecting" : "reconnecting" };
    case "hello":
      return {
        ...state,
        status: "open",
        mode: event.mode,
        viewers: event.viewers,
        peers: event.peers ?? state.peers,
        // A refused-control notice survives the watch connection that follows it.
        notice: state.notice?.startsWith("Control") ? state.notice : null,
      };
    case "viewers":
      return { ...state, viewers: event.viewers, peers: event.peers ?? state.peers };
    case "typing":
      return {
        ...state,
        typing: { userId: event.userId, name: event.name, until: event.at + TYPING_VISIBLE_MS },
      };
    case "retry":
      return {
        ...state,
        status: "reconnecting",
        mode: null,
        notice: `Connection lost, retrying in ${Math.max(1, Math.round(event.delayMs / 1000))} s…`,
      };
    case "downgraded":
      return {
        ...state,
        mode: null,
        notice: "Control was refused by the server; watching instead.",
      };
    case "ended":
      return { ...state, status: "ended", mode: null, typing: null, notice: "The session ended." };
    case "unavailable":
      return {
        ...state,
        status: "unavailable",
        mode: null,
        typing: null,
        notice: "This terminal is not available right now.",
      };
    case "access_lost":
      return {
        ...state,
        status: "unavailable",
        mode: null,
        typing: null,
        notice: accessCloseMessage(event.signedOut ? "signedOut" : "revoked", "terminal"),
      };
    case "tick":
      return state.typing && state.typing.until <= event.now ? { ...state, typing: null } : state;
  }
}

/** Distinct people for the faces row (one person may have several tabs open). */
export function uniquePeers(peers: readonly TerminalPeer[]): TerminalPeer[] {
  const byId = new Map<string, TerminalPeer>();
  for (const p of peers) {
    const seen = byId.get(p.userId);
    // Someone in control shows as such even if they also watch from another tab.
    if (!seen || p.mode === "control") byId.set(p.userId, p);
  }
  return [...byId.values()];
}
