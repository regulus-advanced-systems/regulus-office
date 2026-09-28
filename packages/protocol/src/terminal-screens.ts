/**
 * Laptop screen feed (SPEC §9.4): `/ws/screens/<floorId>`.
 *
 * The terminal bridge streams raw PTY bytes to one viewer at a time; the
 * laptops of every other occupied desk only need a low-rate picture of the
 * screen. This socket pushes the visible pane text (`tmux capture-pane`, no
 * escapes) of each robot on one floor, only when it changed, at most every
 * {@link SCREEN_FEED_INTERVAL_MS}, and only while someone is subscribed.
 *
 * Text frames only, server→client. The ACL is the terminal `watch` rule:
 * anyone who can see the floor may subscribe.
 */
import { z } from "zod";

/** Path prefix of the screen feed; the floor id follows it. */
export const SCREENS_WS_PREFIX = "/ws/screens/";

/** Poll period of the feed: 2 Hz (SPEC §9.4 "updated ~2/s"). */
export const SCREEN_FEED_INTERVAL_MS = 500;

/** Size cap for one screen: lines, characters per line, and UTF-8 bytes overall. */
export const SCREEN_TEXT_LIMITS = { maxLines: 60, maxCols: 240, maxBytes: 16 * 1024 } as const;

/** `/ws/screens/<floorId>` for a client to connect to. */
export function screensWsPath(floorId: string): string {
  return `${SCREENS_WS_PREFIX}${encodeURIComponent(floorId)}`;
}

const AgentId = z.string().min(1).max(128);

/** The current visible screen of one robot, replacing any earlier one. */
export const ScreenUpdate = z.object({
  type: z.literal("screen"),
  agentId: AgentId,
  text: z.string().max(SCREEN_TEXT_LIMITS.maxBytes),
});
export type ScreenUpdate = z.infer<typeof ScreenUpdate>;

/** The robot left the floor or its session ended: show a dark screen. */
export const ScreenRemoved = z.object({ type: z.literal("removed"), agentId: AgentId });
export type ScreenRemoved = z.infer<typeof ScreenRemoved>;

export const ScreenFeedMessage = z.discriminatedUnion("type", [ScreenUpdate, ScreenRemoved]);
export type ScreenFeedMessage = z.infer<typeof ScreenFeedMessage>;

/** Parse a screen feed frame; null when malformed or unknown. */
export function parseScreenFeedMessage(text: string): ScreenFeedMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const result = ScreenFeedMessage.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Clamp pane text to {@link SCREEN_TEXT_LIMITS}: drop control characters
 * (other than newlines), trailing blank lines, keep the last `maxLines`
 * lines, cut each to `maxCols` characters, then cap the UTF-8 size.
 */
export function clampScreenText(text: string, limits = SCREEN_TEXT_LIMITS): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const clean = text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ");
  const lines = clean.replace(/\s+$/, "").split("\n");
  let out = lines
    .slice(-limits.maxLines)
    .map((l) => Array.from(l).slice(0, limits.maxCols).join("").trimEnd())
    .join("\n");
  const encoder = new TextEncoder();
  while (encoder.encode(out).byteLength > limits.maxBytes) {
    const cut = out.indexOf("\n");
    out =
      cut >= 0
        ? out.slice(cut + 1)
        : Array.from(out)
            .slice(0, limits.maxBytes / 4)
            .join("");
  }
  return out;
}
