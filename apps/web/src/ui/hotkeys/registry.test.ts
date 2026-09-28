import { describe, expect, test } from "bun:test";
import { createHotkeyRegistry, DEFAULT_HOTKEYS, normalizeKey } from "./registry.ts";

describe("hotkey registry", () => {
  test("ships F, V, E and ? by default", () => {
    const r = createHotkeyRegistry(DEFAULT_HOTKEYS);
    expect(r.resolve({ key: "f" })?.id).toBe("floorMenu");
    expect(r.resolve({ key: "V" })?.id).toBe("toggleView");
    expect(r.resolve({ key: "e" })?.id).toBe("interact");
    expect(r.resolve({ key: "?" })?.id).toBe("help");
    expect(r.list().map((b) => b.id)).toEqual(["floorMenu", "toggleView", "interact", "help"]);
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
});
