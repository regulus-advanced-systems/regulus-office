import { describe, expect, test } from "bun:test";
import { groupBindings, helpBindings, keyLabel } from "./HotkeyHelp.tsx";
import { createHotkeyRegistry, DEFAULT_HOTKEYS, MOVEMENT_HELP, SOCIAL_HELP } from "./registry.ts";

describe("hotkey help", () => {
  test("keyLabel upper-cases letters and leaves named keys", () => {
    expect(keyLabel("f")).toBe("F");
    expect(keyLabel("?")).toBe("?");
    expect(keyLabel("Escape")).toBe("Escape");
  });
  test("groups keep registration order", () => {
    const groups = groupBindings(DEFAULT_HOTKEYS);
    expect(groups.map(([g]) => g)).toEqual([
      "Navigation",
      "Camera",
      "World",
      "Social",
      "Chat",
      "Search",
      "Help",
    ]);
    expect(groups[0]?.[1].map((b) => b.id)).toEqual(["quickTravel"]);
  });
});

describe("movement help (#223)", () => {
  test("lists Shift (run) and double-click (run there) ahead of the hotkeys", () => {
    const list = helpBindings(DEFAULT_HOTKEYS);
    expect(list.slice(0, 2).map((b) => keyLabel(b.key))).toEqual(["Shift", "Double-click"]);
    expect(groupBindings(list)[0]?.[0]).toBe("Movement");
  });

  test("the emote wheel (G) and its digits are listed under Social (#49)", () => {
    const social = groupBindings(helpBindings(DEFAULT_HOTKEYS)).find(([g]) => g === "Social");
    expect(social?.[1].map((b) => keyLabel(b.key))).toEqual(["G", "1-6", "Click a name"]);
  });

  test("the movement entries are not dispatched hotkeys", () => {
    const r = createHotkeyRegistry(DEFAULT_HOTKEYS);
    for (const b of [...MOVEMENT_HELP, ...SOCIAL_HELP])
      expect(r.resolve({ key: b.key })).toBeNull();
  });
});
