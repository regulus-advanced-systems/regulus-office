/**
 * Terminal WebSocket (SPEC §6 channel 3): `/ws/term/<agentId>?mode=watch|control`.
 *
 * - Binary frames carry raw PTY bytes both ways: terminal output server→client,
 *   keystrokes client→server (dropped server-side in `watch` mode).
 * - Text frames carry small JSON control messages: the server says `hello`
 *   first and `viewers` when the audience changes; the client may send
 *   `resize` (applied only in `control` mode, see below).
 * - On join the server sends `hello`, then up to {@link TERMINAL_SCROLLBACK_LINES}
 *   lines of scrollback (`tmux capture-pane`) as one binary frame, then live bytes.
 *
 * Every viewer gets its own tmux client at a fixed virtual size (default
 * {@link TERMINAL_DEFAULT_SIZE}); clients scale it to fit rather than resizing.
 */
import { z } from "zod";
import { TERMINAL_MODES, type TerminalMode } from "./enums.ts";

/** Path prefix of the terminal socket; the agent id follows it. */
export const TERMINAL_WS_PREFIX = "/ws/term/";

/** Fixed virtual terminal size every viewer attaches with (research 01 §3). */
export const TERMINAL_DEFAULT_SIZE = { cols: 160, rows: 45 } as const;

/** Lines of scrollback sent before live bytes (`capture-pane -S -2000`). */
export const TERMINAL_SCROLLBACK_LINES = 2000;

/** Bounds for a `resize`; anything outside is rejected. */
export const TERMINAL_SIZE_LIMITS = {
  minCols: 20,
  maxCols: 500,
  minRows: 5,
  maxRows: 200,
} as const;

/** Largest inbound frame (keystrokes or a paste) the server accepts, in bytes. */
export const TERMINAL_MAX_INPUT_BYTES = 64 * 1024;

/** WebSocket close codes the terminal socket uses besides the standard ones. */
export const TERMINAL_CLOSE_CODES = {
  /** The tmux session ended or the attach process exited. */
  sessionEnded: 4000,
  /** The viewer could not keep up with the output and was dropped. */
  slowConsumer: 4008,
  /** Attaching failed (runner unreachable, PTY unavailable). */
  attachFailed: 4011,
} as const;

/** `/ws/term/<agentId>?mode=<mode>` for a client to connect to. */
export function terminalWsPath(agentId: string, mode: TerminalMode): string {
  return `${TERMINAL_WS_PREFIX}${encodeURIComponent(agentId)}?mode=${mode}`;
}

const Cols = z.number().int().min(TERMINAL_SIZE_LIMITS.minCols).max(TERMINAL_SIZE_LIMITS.maxCols);
const Rows = z.number().int().min(TERMINAL_SIZE_LIMITS.minRows).max(TERMINAL_SIZE_LIMITS.maxRows);

// ---- client → server (text frames) ------------------------------------------

export const TerminalResize = z.object({ type: z.literal("resize"), cols: Cols, rows: Rows });
export type TerminalResize = z.infer<typeof TerminalResize>;

export const TerminalClientMessage = z.discriminatedUnion("type", [TerminalResize]);
export type TerminalClientMessage = z.infer<typeof TerminalClientMessage>;

// ---- server → client (text frames) ------------------------------------------

/** First frame on every connection: the granted mode and the attach size. */
export const TerminalHello = z.object({
  type: z.literal("hello"),
  mode: z.enum(TERMINAL_MODES),
  cols: Cols,
  rows: Rows,
  /** Viewers of this agent's terminal, this one included. */
  viewers: z.number().int().min(1),
});
export type TerminalHello = z.infer<typeof TerminalHello>;

/** Sent when another viewer joins or leaves. */
export const TerminalViewers = z.object({
  type: z.literal("viewers"),
  viewers: z.number().int().min(0),
});
export type TerminalViewers = z.infer<typeof TerminalViewers>;

export const TerminalServerMessage = z.discriminatedUnion("type", [TerminalHello, TerminalViewers]);
export type TerminalServerMessage = z.infer<typeof TerminalServerMessage>;

function parseJson<T>(schema: z.ZodType<T>, text: string): T | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const result = schema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Parse a client text frame; null when malformed or unknown. */
export const parseTerminalClientMessage = (text: string): TerminalClientMessage | null =>
  parseJson(TerminalClientMessage, text);

/** Parse a server text frame; null when malformed or unknown. */
export const parseTerminalServerMessage = (text: string): TerminalServerMessage | null =>
  parseJson(TerminalServerMessage, text);
