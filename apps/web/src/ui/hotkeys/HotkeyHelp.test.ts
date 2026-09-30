import { describe, expect, test } from "bun:test";
import { groupBindings, keyLabel } from "./HotkeyHelp.tsx";
import { DEFAULT_HOTKEYS } from "./registry.ts";

describe("hotkey help", () => {
  test("keyLabel upper-cases letters and leaves named keys", () => {
    expect(keyLabel("f")).toBe("F");
    expect(keyLabel("?")).toBe("?");
    expect(keyLabel("Escape")).toBe("Escape");
  });
  test("groups keep registration order", () => {
    const groups = groupBindings(DEFAULT_HOTKEYS);
    expect(groups.map(([g]) => g)).toEqual(["Navigation", "Camera", "World", "Chat", "Search", "Help"]);
    expect(groups[0]?.[1].map((b) => b.id)).toEqual(["floorMenu"]);
  });
});
