import { beforeEach, describe, expect, test } from "bun:test";
import { ACCESS_CLOSE_CODES } from "@regulus/protocol";
import { FakeSocket } from "../../ui/terminal/fakeSocket.ts";
import { fakeScreensCount, fakeScreenText } from "./fakeScreens.ts";
import { ScreenFeedClient } from "./screenFeed.ts";

beforeEach(() => {
  FakeSocket.all = [];
});

describe("ScreenFeedClient", () => {
  test("delivers screens and removals, reconnects with backoff, stops cleanly", () => {
    const screens: [string, string][] = [];
    const removed: string[] = [];
    const timers: { fn: () => void; ms: number }[] = [];
    const feed = new ScreenFeedClient({
      wsBase: "ws://office",
      operationId: "f 1",
      onScreen: (id, text) => screens.push([id, text]),
      onRemoved: (id) => removed.push(id),
      socket: FakeSocket.factory,
      random: () => 0.5,
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => {},
    });
    feed.start();
    const ws = FakeSocket.last();
    expect(ws.url).toBe("ws://office/ws/screens/f%201");
    ws.open();
    ws.text({ type: "screen", agentId: "a1", text: "$ ls" });
    ws.text({ type: "removed", agentId: "a2" });
    ws.text({ type: "screen", agentId: "a1" });
    expect(screens).toEqual([["a1", "$ ls"]]);
    expect(removed).toEqual(["a2"]);

    ws.drop(1006);
    expect(timers.map((t) => t.ms)).toEqual([1000]);
    timers[0]?.fn();
    FakeSocket.last().drop(1006);
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000]);
    timers[1]?.fn();
    const live = FakeSocket.last();
    feed.stop();
    expect(live.closedWith).toBe(1000);
    live.drop(1006);
    expect(timers).toHaveLength(2);
  });

  test("a feed closed because access was withdrawn is not reopened (#244)", () => {
    const timers: { fn: () => void; ms: number }[] = [];
    const feed = new ScreenFeedClient({
      wsBase: "ws://office",
      operationId: "f1",
      onScreen: () => {},
      onRemoved: () => {},
      socket: FakeSocket.factory,
      random: () => 0.5,
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => {},
    });
    feed.start();
    FakeSocket.last().open();
    FakeSocket.last().drop(ACCESS_CLOSE_CODES.revoked);
    expect(timers).toHaveLength(0);
    expect(FakeSocket.all).toHaveLength(1);
  });
});

describe("fake screens probe", () => {
  test("flag parsing and deterministic text", () => {
    expect(fakeScreensCount("")).toBeNull();
    expect(fakeScreensCount("?fakeScreens")).toBe(Number.POSITIVE_INFINITY);
    expect(fakeScreensCount("?stats&fakeScreens=12")).toBe(12);
    expect(fakeScreenText(1, 50)).toBe(fakeScreenText(1, 50));
    expect(fakeScreenText(1, 50).split("\n").length).toBeLessThanOrEqual(45);
  });
});
