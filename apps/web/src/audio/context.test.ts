import { afterEach, describe, expect, test } from "bun:test";
import {
  audioUnlocked,
  onAudioUnlocked,
  resetSharedAudioForTests,
  sharedAudioContext,
  unlockAudioOnGesture,
} from "./context.ts";

afterEach(() => resetSharedAudioForTests());

describe("shared audio context", () => {
  test("one context for every sound; null without Web Audio", () => {
    const real = globalThis.AudioContext;
    let made = 0;
    class Fake {
      state = "suspended";
      constructor() {
        made += 1;
      }
      resume() {
        this.state = "running";
        return Promise.resolve();
      }
    }
    try {
      (globalThis as { AudioContext?: unknown }).AudioContext = undefined;
      expect(sharedAudioContext()).toBeNull();
      (globalThis as { AudioContext?: unknown }).AudioContext = Fake;
      const a = sharedAudioContext();
      expect(sharedAudioContext()).toBe(a);
      expect(made).toBe(1);
    } finally {
      (globalThis as { AudioContext?: unknown }).AudioContext = real;
    }
  });

  test("audio unlocks on the first gesture, once, and tells its listeners", () => {
    const target = new EventTarget();
    const heard: string[] = [];
    onAudioUnlocked(() => heard.push("early"));
    unlockAudioOnGesture(target);
    expect(audioUnlocked()).toBe(false);
    target.dispatchEvent(new Event("mousemove"));
    expect(audioUnlocked()).toBe(false);
    target.dispatchEvent(new Event("keydown"));
    target.dispatchEvent(new Event("pointerdown"));
    expect(audioUnlocked()).toBe(true);
    onAudioUnlocked(() => heard.push("late"));
    expect(heard).toEqual(["early", "late"]);
  });
});
