import { describe, expect, test } from "bun:test";
import { CHAT_BUBBLE_FADE_MS, CHAT_BUBBLE_MS, type ChatMessage } from "@regulus/protocol";
import {
  BUBBLE_MAX_CHARS,
  bubbleOpacity,
  bubbleText,
  createBubbleTracker,
  useBubbleStore,
} from "./bubbles.ts";
import { wrapLines } from "./bubbleTexture.ts";

const line = (id: string, userId: string, text = `line ${id}`): ChatMessage => ({
  id,
  userId,
  displayName: userId,
  operationId: "lobby",
  text,
  ts: 1,
});

describe("bubble fade (#49)", () => {
  const fadeFrom = CHAT_BUBBLE_MS - CHAT_BUBBLE_FADE_MS;

  test("full, then a linear fade over the last stretch, then gone", () => {
    expect(bubbleOpacity(0)).toBe(1);
    expect(bubbleOpacity(fadeFrom)).toBe(1);
    expect(bubbleOpacity(fadeFrom + CHAT_BUBBLE_FADE_MS / 2)).toBeCloseTo(0.5, 5);
    expect(bubbleOpacity(CHAT_BUBBLE_MS - 1)).toBeGreaterThan(0);
    expect(bubbleOpacity(CHAT_BUBBLE_MS)).toBe(0);
    expect(bubbleOpacity(CHAT_BUBBLE_MS * 3)).toBe(0);
  });

  test("with reduced motion the bubble does not fade: full until it goes", () => {
    expect(bubbleOpacity(fadeFrom + CHAT_BUBBLE_FADE_MS / 2, true)).toBe(1);
    expect(bubbleOpacity(CHAT_BUBBLE_MS, true)).toBe(0);
  });

  test("the store drops faded bubbles", () => {
    const store = useBubbleStore.getState();
    store.clear();
    store.add(new Map([["u1", { id: "m1", text: "hi", shownAt: 1000 }]]));
    useBubbleStore.getState().prune(1000 + CHAT_BUBBLE_MS - 1);
    expect(Object.keys(useBubbleStore.getState().byUser)).toEqual(["u1"]);
    useBubbleStore.getState().prune(1000 + CHAT_BUBBLE_MS);
    expect(useBubbleStore.getState().byUser).toEqual({});
  });
});

describe("which lines become bubbles", () => {
  test("history on join never does; each live line does, the newest per speaker", () => {
    const t = createBubbleTracker();
    expect(t.observe([line("1", "ada"), line("2", "bob")], 0).size).toBe(0);
    const fresh = t.observe(
      [line("1", "ada"), line("2", "bob"), line("3", "ada"), line("4", "ada")],
      50,
    );
    expect([...fresh.keys()]).toEqual(["ada"]);
    expect(fresh.get("ada")).toEqual({ id: "4", text: "line 4", shownAt: 50 });
    // The window slides: an old id dropping out starts nothing.
    expect(
      t.observe([line("3", "ada"), line("4", "ada"), line("5", "bob")], 60).get("bob")?.id,
    ).toBe("5");
  });

  test("long lines are cut, whitespace collapsed", () => {
    expect(bubbleText("  so   much \n space ")).toBe("so much space");
    const long = bubbleText("x".repeat(500));
    expect(long).toHaveLength(BUBBLE_MAX_CHARS);
    expect(long.endsWith("…")).toBe(true);
  });

  test("text wraps by width and is capped in lines", () => {
    const measure = (s: string) => s.length * 10;
    expect(wrapLines("one two three four", measure, 90, 4)).toEqual(["one two", "three", "four"]);
    expect(wrapLines("abcdefghijkl", measure, 50, 4)).toEqual(["abcde", "fghij", "kl"]);
    const capped = wrapLines("a b c d e f", measure, 10, 3);
    expect(capped).toHaveLength(3);
    expect(capped[2]?.endsWith("…")).toBe(true);
  });
});
