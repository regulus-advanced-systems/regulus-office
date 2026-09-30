import { describe, expect, test } from "bun:test";
import {
  clipboardKeyAction,
  copyText,
  isMacPlatform,
  type KeyLike,
  readText,
} from "./clipboard.ts";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});
const linux = (readOnly: boolean, hasSelection = true) => ({ mac: false, readOnly, hasSelection });
const mac = (readOnly: boolean, hasSelection = true) => ({ mac: true, readOnly, hasSelection });

describe("clipboardKeyAction", () => {
  test("Linux/Windows: Ctrl+Shift+C / Ctrl+Insert copy; Ctrl+Shift+V / Shift+Insert paste in control", () => {
    expect(clipboardKeyAction(key("C", { ctrlKey: true, shiftKey: true }), linux(false))).toBe(
      "copy",
    );
    expect(clipboardKeyAction(key("Insert", { ctrlKey: true }), linux(false))).toBe("copy");
    expect(clipboardKeyAction(key("V", { ctrlKey: true, shiftKey: true }), linux(false))).toBe(
      "paste",
    );
    expect(clipboardKeyAction(key("Insert", { shiftKey: true }), linux(false))).toBe("paste");
  });

  test("Ctrl+C stays the interrupt for a controller; Ctrl+V stays with the program", () => {
    expect(clipboardKeyAction(key("c", { ctrlKey: true }), linux(false))).toBeNull();
    expect(clipboardKeyAction(key("v", { ctrlKey: true }), linux(false))).toBeNull();
    expect(clipboardKeyAction(key("a"), linux(false))).toBeNull();
    expect(clipboardKeyAction(key("c", { ctrlKey: true, altKey: true }), linux(true))).toBeNull();
  });

  test("watchers copy (Ctrl+C too, with a selection) but never paste", () => {
    expect(clipboardKeyAction(key("c", { ctrlKey: true }), linux(true))).toBe("copy");
    expect(clipboardKeyAction(key("c", { ctrlKey: true }), linux(true, false))).toBeNull();
    expect(clipboardKeyAction(key("C", { ctrlKey: true, shiftKey: true }), linux(true))).toBe(
      "copy",
    );
    expect(clipboardKeyAction(key("V", { ctrlKey: true, shiftKey: true }), linux(true))).toBeNull();
    expect(clipboardKeyAction(key("Insert", { shiftKey: true }), linux(true))).toBeNull();
    expect(clipboardKeyAction(key("v", { metaKey: true }), mac(true))).toBeNull();
  });

  test("Mac: Cmd+C copies a selection, Cmd+V pastes in control", () => {
    expect(clipboardKeyAction(key("c", { metaKey: true }), mac(false))).toBe("copy");
    expect(clipboardKeyAction(key("c", { metaKey: true }), mac(false, false))).toBeNull();
    expect(clipboardKeyAction(key("v", { metaKey: true }), mac(false))).toBe("paste");
    expect(clipboardKeyAction(key("c", { ctrlKey: true }), mac(false))).toBeNull();
  });

  test("platform detection", () => {
    expect(isMacPlatform({ platform: "MacIntel" })).toBe(true);
    expect(isMacPlatform({ platform: "Linux x86_64" })).toBe(false);
    expect(isMacPlatform({ platform: "", userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0)" })).toBe(
      true,
    );
  });
});

describe("copyText / readText", () => {
  test("writes through the Clipboard API", async () => {
    const written: string[] = [];
    const clipboard = { writeText: async (t: string) => void written.push(t) };
    expect(await copyText("hello", clipboard)).toBe(true);
    expect(await copyText("", clipboard)).toBe(false);
    expect(written).toEqual(["hello"]);
  });

  test("reads the clipboard, null when the browser refuses", async () => {
    expect(await readText({ readText: async () => "code-123" })).toBe("code-123");
    expect(
      await readText({
        readText: async () => {
          throw new Error("denied");
        },
      }),
    ).toBeNull();
    expect(await readText({})).toBeNull();
  });
});
