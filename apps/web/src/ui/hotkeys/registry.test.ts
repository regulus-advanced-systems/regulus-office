import { describe, expect, test } from "bun:test";
import {
  createHotkeyRegistry,
  DEFAULT_HOTKEYS,
  FOCUS_CHAT_HOTKEYS,
  isFocusedControl,
  normalizeKey,
} from "./registry.ts";

describe("hotkey registry", () => {
  test("ships F, V, E, T, Enter and ? by default", () => {
    const r = createHotkeyRegistry(DEFAULT_HOTKEYS);
    expect(r.resolve({ key: "f" })?.id).toBe("floorMenu");
    expect(r.resolve({ key: "V" })?.id).toBe("toggleView");
    expect(r.resolve({ key: "e" })?.id).toBe("interact");
    expect(r.resolve({ key: "T" })?.id).toBe("focusChat");
    expect(r.resolve({ key: "Enter" })?.id).toBe("focusChatEnter");
    expect(r.resolve({ key: "?" })?.id).toBe("help");
    expect(r.list().map((b) => b.id)).toEqual([
      "floorMenu",
      "toggleView",
      "interact",
      "focusChat",
      "focusChatEnter",
      "help",
    ]);
    expect([...FOCUS_CHAT_HOTKEYS]).toEqual(["focusChat", "focusChatEnter"]);
  });

  test("letters are case-insensitive, named keys are not lowercased", () => {
    expect(normalizeKey("F")).toBe("f");
    expect(normalizeKey("Escape")).toBe("Escape");
  });

  test("ignores presses with modifiers, in text fields, or while an overlay is open", () => {
    const r = createHotkeyRegistry(DEFAULT_HOTKEYS);
    expect(r.resolve({ key: "f", ctrlKey: true })).toBeNull();
    expect(r.resolve({ key: "f", metaKey: true })).toBeNull();
    expect(r.resolve({ key: "f", altKey: true })).toBeNull();
    expect(r.resolve({ key: "f", editable: true })).toBeNull();
    expect(r.resolve({ key: "f", overlayOpen: true })).toBeNull();
    expect(r.resolve({ key: "x" })).toBeNull();
  });

  test("register returns an unregister function and rejects duplicate keys", () => {
    const r = createHotkeyRegistry();
    const off = r.register({ id: "a", key: "a", description: "A", group: "t" });
    expect(r.resolve({ key: "a" })?.id).toBe("a");
    expect(() => r.register({ id: "b", key: "A", description: "B", group: "t" })).toThrow();
    off();
    expect(r.resolve({ key: "a" })).toBeNull();
    // Unregistering twice is harmless and does not remove a newer binding.
    r.register({ id: "c", key: "a", description: "C", group: "t" });
    off();
    expect(r.resolve({ key: "a" })?.id).toBe("c");
  });

  test("chat focus keys never fire while typing; Enter only when no control has focus", () => {
    const r = createHotkeyRegistry(DEFAULT_HOTKEYS);
    expect(r.resolve({ key: "t", editable: true })).toBeNull();
    expect(r.resolve({ key: "Enter", editable: true })).toBeNull();
    // A focused button keeps Enter for its own activation; T still works there.
    expect(r.resolve({ key: "Enter", focused: true })).toBeNull();
    expect(r.resolve({ key: "t", focused: true })?.id).toBe("focusChat");
  });

  test("isFocusedControl treats body, html and canvas as nothing focused", () => {
    class FakeElement {
      constructor(readonly tagName: string) {}
    }
    const g = globalThis as { HTMLElement?: unknown };
    const saved = g.HTMLElement;
    g.HTMLElement = FakeElement;
    try {
      expect(isFocusedControl(new FakeElement("BODY") as unknown as EventTarget)).toBe(false);
      expect(isFocusedControl(new FakeElement("HTML") as unknown as EventTarget)).toBe(false);
      expect(isFocusedControl(new FakeElement("CANVAS") as unknown as EventTarget)).toBe(false);
      expect(isFocusedControl(new FakeElement("BUTTON") as unknown as EventTarget)).toBe(true);
      expect(isFocusedControl(null)).toBe(false);
    } finally {
      g.HTMLElement = saved;
    }
  });
});
