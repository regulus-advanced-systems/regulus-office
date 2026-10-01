import { describe, expect, test } from "bun:test";
import { type ChatMessage, parseClientCommand } from "@regulus/protocol";
import {
  CHAT_MAX_LENGTH,
  createChatSelector,
  formatChatTime,
  isOwnMessage,
  prepareChat,
  unreadCount,
} from "./chatModel.ts";

const line = (id: string, userId = "u1"): ChatMessage => ({
  id,
  userId,
  displayName: userId,
  operationId: "lobby",
  text: `line ${id}`,
  ts: 1_700_000_000_000,
});

describe("chat model", () => {
  test("the length limit is the chat command's, and it agrees with the server parser", () => {
    expect(CHAT_MAX_LENGTH).toBe(2000);
    const atLimit = "x".repeat(CHAT_MAX_LENGTH);
    expect(prepareChat(atLimit)).toEqual({ ok: true, text: atLimit });
    expect(parseClientCommand("chat", { text: atLimit }).success).toBe(true);
    expect(prepareChat(`${atLimit}x`)).toEqual({ ok: false, reason: "too_long" });
    expect(parseClientCommand("chat", { text: `${atLimit}x` }).success).toBe(false);
  });

  test("trims like the server and refuses empty lines", () => {
    expect(prepareChat("  hi there \n")).toEqual({ ok: true, text: "hi there" });
    expect(prepareChat("")).toEqual({ ok: false, reason: "empty" });
    expect(prepareChat("   ")).toEqual({ ok: false, reason: "empty" });
    // Surrounding whitespace does not count against the limit.
    expect(prepareChat(` ${"x".repeat(CHAT_MAX_LENGTH)} `).ok).toBe(true);
  });

  test("selector keeps the same array while the chat is unchanged", () => {
    const select = createChatSelector();
    const first = select([line("a"), line("b")]);
    // A room patch brings a structurally equal but fresh array.
    expect(select([line("a"), line("b")])).toBe(first);
    const next = select([line("a"), line("b"), line("c")]);
    expect(next).not.toBe(first);
    expect(next.map((m) => m.id)).toEqual(["a", "b", "c"]);
    // Window slid by one (replay cap): same length, different ids.
    expect(select([line("b"), line("c"), line("d")]).map((m) => m.id)).toEqual(["b", "c", "d"]);
    expect(select(undefined)).toBe(select([]));
  });

  test("unread counts lines after the last seen id", () => {
    const msgs = [line("a"), line("b"), line("c")];
    expect(unreadCount(msgs, null)).toBe(0);
    expect(unreadCount(msgs, "c")).toBe(0);
    expect(unreadCount(msgs, "a")).toBe(2);
    expect(unreadCount(msgs, "")).toBe(3);
    expect(unreadCount(msgs, "gone")).toBe(3);
  });

  test("own messages are matched by user id", () => {
    expect(isOwnMessage(line("a", "u1"), "u1")).toBe(true);
    expect(isOwnMessage(line("a", "u2"), "u1")).toBe(false);
    expect(isOwnMessage(line("a", "u1"), null)).toBe(false);
    expect(isOwnMessage(line("a", "u1"), "")).toBe(false);
  });

  test("times render as 24 h hours and minutes", () => {
    const ts = new Date(2026, 8, 28, 9, 5).getTime();
    expect(formatChatTime(ts, "en-GB")).toBe("09:05");
  });
});
