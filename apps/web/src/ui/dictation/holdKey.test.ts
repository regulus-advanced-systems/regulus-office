import { describe, expect, test } from "bun:test";
import { createHotkeyRegistry, DEFAULT_HOTKEYS } from "../hotkeys/registry.ts";
import { createHoldKey, DICTATION_HOTKEY, type HoldKeyEvent, isDictationChord } from "./holdKey.ts";
import type { DictationTarget, TargetLookup } from "./targets.ts";

interface Sent extends HoldKeyEvent {
  prevented: boolean;
  stopped: boolean;
}

function key(code: string, init: Partial<HoldKeyEvent> = {}): Sent {
  const e: Sent = {
    code,
    key: code === "Space" ? " " : code.startsWith("Control") ? "Control" : code,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    prevented: false,
    stopped: false,
    preventDefault: () => {
      e.prevented = true;
    },
    stopPropagation: () => {
      e.stopped = true;
    },
    ...init,
  };
  return e;
}

const TARGET: TargetLookup = { target: {} as DictationTarget };

function setup(focused: TargetLookup, takes = true) {
  const calls: string[] = [];
  const hold = createHoldKey(
    {
      begin: (lookup) => {
        if (!lookup || !takes) return false;
        calls.push("begin");
        return true;
      },
      release: () => void calls.push("release"),
    },
    () => focused,
  );
  return { hold, calls };
}

describe("the dictation chord", () => {
  test("is Ctrl+Space and nothing else", () => {
    expect(isDictationChord(key("Space", { ctrlKey: true }))).toBe(true);
    expect(isDictationChord(key("Space"))).toBe(false);
    expect(isDictationChord(key("Space", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isDictationChord(key("Space", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isDictationChord(key("Space", { ctrlKey: true, metaKey: true }))).toBe(false);
    expect(isDictationChord(key("KeyM", { ctrlKey: true }))).toBe(false);
  });

  test("collides with no hotkey: the registry ignores Ctrl presses and takes the help entry", () => {
    const registry = createHotkeyRegistry(DEFAULT_HOTKEYS);
    // Voice chat's key (media/useMedia.ts), registered the same way.
    registry.register({ id: "voice", key: "m", description: "", group: "Voice" });
    registry.register(DICTATION_HOTKEY);
    expect(registry.resolve({ key: " ", ctrlKey: true })).toBeNull();
    expect(registry.resolve({ key: " " })).toBeNull();
    expect(registry.resolve({ key: "m" })?.id).toBe("voice");
    expect(registry.list().some((b) => b.id === "dictation")).toBe(true);
  });
});

describe("holding the key", () => {
  test("in a dictation target: taken, kept from the target, released on key-up", () => {
    const { hold, calls } = setup(TARGET);
    const down = key("Space", { ctrlKey: true });
    hold.keydown(down);
    expect(calls).toEqual(["begin"]);
    expect(down.prevented && down.stopped).toBe(true);

    const repeat = key("Space", { ctrlKey: true, repeat: true });
    hold.keydown(repeat);
    expect(calls).toEqual(["begin"]);
    expect(repeat.prevented && repeat.stopped).toBe(true);

    const up = key("Space", { ctrlKey: true });
    hold.keyup(up);
    expect(calls).toEqual(["begin", "release"]);
    expect(up.prevented && up.stopped).toBe(true);
  });

  test("nowhere to dictate: the press is left untouched", () => {
    const { hold, calls } = setup(null);
    const down = key("Space", { ctrlKey: true });
    hold.keydown(down);
    const up = key("Space", { ctrlKey: true });
    hold.keyup(up);
    expect(calls).toEqual([]);
    expect(down.prevented || down.stopped || up.prevented || up.stopped).toBe(false);
  });

  test("dictation off: the press is left untouched", () => {
    const { hold } = setup(TARGET, false);
    const down = key("Space", { ctrlKey: true });
    hold.keydown(down);
    expect(down.prevented || down.stopped).toBe(false);
  });

  test("other keys pass while holding, and plain Space is never taken", () => {
    const { hold, calls } = setup(TARGET);
    const space = key("Space");
    hold.keydown(space);
    expect(space.prevented).toBe(false);
    hold.keydown(key("Space", { ctrlKey: true }));
    const letter = key("KeyA", { ctrlKey: true });
    hold.keydown(letter);
    expect(letter.prevented || letter.stopped).toBe(false);
    expect(calls).toEqual(["begin"]);
  });

  test("Ctrl let go first: stops at once, and the still-held Space types nothing", () => {
    const { hold, calls } = setup(TARGET);
    hold.keydown(key("Space", { ctrlKey: true }));
    hold.keyup(key("ControlLeft"));
    expect(calls).toEqual(["begin", "release"]);
    const repeat = key("Space", { repeat: true });
    hold.keydown(repeat);
    expect(repeat.prevented && repeat.stopped).toBe(true);
    hold.keyup(key("Space"));
    // Free again.
    const plain = key("Space");
    hold.keydown(plain);
    expect(plain.prevented).toBe(false);
  });

  test("a held key that repeats into a target focused later does not start", () => {
    const { hold, calls } = setup(TARGET);
    hold.keydown(key("Space", { ctrlKey: true, repeat: true }));
    expect(calls).toEqual([]);
  });

  test("the window losing focus stops, whatever the keys do", () => {
    const { hold, calls } = setup(TARGET);
    hold.keydown(key("Space", { ctrlKey: true }));
    hold.drop();
    expect(calls).toEqual(["begin", "release"]);
    const plain = key("Space");
    hold.keydown(plain);
    expect(plain.prevented).toBe(false);
  });
});
