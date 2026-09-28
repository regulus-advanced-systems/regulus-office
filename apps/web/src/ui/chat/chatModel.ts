/**
 * Pure helpers for the lobby chat panel: validating a line against the
 * `chat` command schema from @regulus/protocol (SPEC §6), formatting times,
 * and a selector that keeps the message array stable across room patches.
 */
import { ChatCommand, type ChatMessage } from "@regulus/protocol";

const textSchema = ChatCommand.shape.text;

/** Longest line the server accepts (the `chat` command's text limit). */
export const CHAT_MAX_LENGTH: number = textSchema.maxLength ?? 2000;

export type PreparedChat =
  | { ok: true; text: string }
  | { ok: false; reason: "empty" | "too_long" | "invalid" };

/** Trim and validate what the user typed exactly as the server will. */
export function prepareChat(raw: string): PreparedChat {
  const parsed = textSchema.safeParse(raw);
  if (parsed.success) return { ok: true, text: parsed.data };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if (trimmed.length > CHAT_MAX_LENGTH) return { ok: false, reason: "too_long" };
  return { ok: false, reason: "invalid" };
}

/** `14:05`-style local time for a message timestamp (ms since epoch). */
export function formatChatTime(ts: number, locale?: string): string {
  return new Date(ts).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Full date and time for the `<time dateTime>` attribute and tooltip. */
export function chatDateTime(ts: number): string {
  return new Date(ts).toISOString();
}

export function isOwnMessage(message: ChatMessage, selfUserId: string | null): boolean {
  return selfUserId !== null && selfUserId !== "" && message.userId === selfUserId;
}

const NO_MESSAGES: readonly ChatMessage[] = Object.freeze([]);

/**
 * Selector for the chat list. Every room patch (20 Hz while anyone walks)
 * brings a fresh `chat` array with fresh objects, so plain selection would
 * re-render the panel constantly. Lines are immutable and ids unique, so the
 * previous array is reused while length and first/last ids are unchanged.
 * One selector per component instance.
 */
export function createChatSelector(): (
  chat: readonly ChatMessage[] | undefined,
) => readonly ChatMessage[] {
  let last: readonly ChatMessage[] = NO_MESSAGES;
  return (chat) => {
    if (!chat || chat.length === 0) {
      last = NO_MESSAGES;
      return last;
    }
    if (
      chat.length === last.length &&
      chat[0]?.id === last[0]?.id &&
      chat[chat.length - 1]?.id === last[last.length - 1]?.id
    ) {
      return last;
    }
    last = chat;
    return last;
  };
}

/**
 * Messages after `lastSeenId`: all of them when that id is `""` (nothing was
 * seen) or scrolled out of the replay window; 0 when `null` (not tracking).
 */
export function unreadCount(messages: readonly ChatMessage[], lastSeenId: string | null): number {
  if (lastSeenId === null) return 0;
  const index = messages.findIndex((m) => m.id === lastSeenId);
  return index === -1 ? messages.length : messages.length - index - 1;
}
