import { beforeEach, describe, expect, test } from "bun:test";
import { TERMINAL_CLOSE_CODES, TERMINAL_MAX_INPUT_BYTES } from "@regulus/protocol";
import { closeAction, TERMINAL_MAX_ATTEMPTS, TerminalConnection } from "./connection.ts";
import { FakeSocket } from "./fakeSocket.ts";
import type { TerminalEvent } from "./terminalState.ts";

const hello = (mode: "watch" | "control", viewers = 1) => ({
  type: "hello",
  mode,
  cols: 160,
  rows: 45,
  viewers,
});

function setup(mode: "watch" | "control" = "watch", now = () => 0) {
  const events: TerminalEvent[] = [];
  const bytes: string[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const conn = new TerminalConnection({
    url: (m) => `ws://office/ws/term/a1?mode=${m}`,
    mode,
    socket: FakeSocket.factory,
    onBytes: (b) => bytes.push(new TextDecoder().decode(b)),
    onEvent: (e) => events.push(e),
    random: () => 0.5,
    now,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
  });
  conn.connect();
  return { conn, events, bytes, timers };
}

beforeEach(() => {
  FakeSocket.all = [];
});

describe("closeAction", () => {
  test("policy per close code", () => {
    expect(closeAction(TERMINAL_CLOSE_CODES.sessionEnded, true, "watch", 0)).toBe("ended");
    expect(closeAction(1006, false, "control", 1)).toBe("downgrade");
    expect(closeAction(TERMINAL_CLOSE_CODES.slowConsumer, true, "watch", 1)).toBe("retry_now");
    expect(closeAction(TERMINAL_CLOSE_CODES.attachFailed, true, "watch", 1)).toBe("retry");
    expect(closeAction(1006, false, "watch", TERMINAL_MAX_ATTEMPTS)).toBe("give_up");
  });
});

describe("TerminalConnection", () => {
  test("hello, viewers, typing and bytes are surfaced", () => {
    const { events, bytes } = setup("watch", () => 1234);
    const ws = FakeSocket.last();
    expect(ws.url).toBe("ws://office/ws/term/a1?mode=watch");
    expect(ws.binaryType).toBe("arraybuffer");
    ws.open();
    ws.text({ ...hello("watch", 2), peers: [{ userId: "u", name: "U", mode: "watch" }] });
    ws.bytes("scrollback\r\n");
    ws.text({ type: "viewers", viewers: 3 });
    ws.text({ type: "typing", userId: "u2", name: "Ada" });
    ws.text("not json");
    expect(events.map((e) => e.kind)).toEqual(["connecting", "hello", "viewers", "typing"]);
    expect(events[1]).toMatchObject({ kind: "hello", mode: "watch", cols: 160, viewers: 2 });
    expect(events[3]).toEqual({ kind: "typing", userId: "u2", name: "Ada", at: 1234 });
    expect(bytes).toEqual(["scrollback\r\n"]);
  });

  test("input is sent only once the server granted control", () => {
    const { conn } = setup("control");
    const ws = FakeSocket.last();
    ws.open();
    conn.send("early");
    ws.text(hello("control"));
    conn.send("ls\r");
    expect(ws.sent.map((d) => new TextDecoder().decode(d as Uint8Array))).toEqual(["ls\r"]);

    const watch = setup("watch");
    FakeSocket.last().open();
    FakeSocket.last().text(hello("watch"));
    watch.conn.send("rm -rf /");
    expect(FakeSocket.last().sent).toEqual([]);
  });

  test("session ended (4000) stops without reconnecting", () => {
    const { events, timers } = setup();
    FakeSocket.last().open();
    FakeSocket.last().text(hello("watch"));
    FakeSocket.last().drop(TERMINAL_CLOSE_CODES.sessionEnded);
    expect(events.at(-1)).toEqual({ kind: "ended" });
    expect(timers).toHaveLength(0);
    expect(FakeSocket.all).toHaveLength(1);
  });

  test("a control attach that never opens (403) falls back to watch", () => {
    const { conn, events } = setup("control");
    FakeSocket.last().drop(1006);
    expect(events.map((e) => e.kind)).toContain("downgraded");
    expect(conn.mode).toBe("watch");
    expect(FakeSocket.last().url).toEndWith("mode=watch");
    expect(FakeSocket.all).toHaveLength(2);
  });

  test("attach failures retry with growing backoff, then give up", () => {
    const { events, timers } = setup();
    for (let i = 0; i < TERMINAL_MAX_ATTEMPTS; i++) {
      FakeSocket.last().drop(1006);
      if (i < TERMINAL_MAX_ATTEMPTS - 1) timers.at(-1)?.fn();
    }
    const delays = timers.map((t) => t.ms);
    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);
    expect(delays.every((d, i) => i === 0 || d >= (delays[i - 1] ?? 0))).toBe(true);
    expect(events.at(-1)).toEqual({ kind: "unavailable" });
  });

  test("an attach that fails right after hello does not loop at the base delay", () => {
    const { timers } = setup();
    for (let i = 0; i < 3; i++) {
      FakeSocket.last().open();
      FakeSocket.last().text(hello("watch"));
      FakeSocket.last().drop(TERMINAL_CLOSE_CODES.attachFailed);
      timers.at(-1)?.fn();
    }
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000, 4000]);
  });

  test("slow consumer (4008) reconnects at once to resync", () => {
    const { timers } = setup();
    FakeSocket.last().open();
    FakeSocket.last().text(hello("watch"));
    FakeSocket.last().drop(TERMINAL_CLOSE_CODES.slowConsumer);
    expect(timers).toHaveLength(0);
    expect(FakeSocket.all).toHaveLength(2);
  });

  test("dispose closes the socket and cancels reconnects", () => {
    const { conn, events } = setup();
    const ws = FakeSocket.last();
    ws.open();
    conn.dispose();
    expect(ws.closedWith).toBe(1000);
    ws.drop(1006);
    expect(events.map((e) => e.kind)).toEqual(["connecting"]);
    conn.connect();
    expect(FakeSocket.all).toHaveLength(1);
  });

  test("resize is sent only in control mode, once per size, and undone when leaving (#156)", () => {
    const watch = setup("watch");
    const ws = FakeSocket.last();
    ws.open();
    ws.text(hello("watch"));
    expect(watch.conn.resize(120, 30)).toBe(false);
    expect(ws.sent).toEqual([]);
    watch.conn.dispose();
    expect(ws.sent).toEqual([]);

    const control = setup("control");
    const cs = FakeSocket.last();
    expect(control.conn.resize(120, 30)).toBe(false); // not open yet
    cs.open();
    cs.text(hello("control"));
    expect(control.conn.resize(160, 45)).toBe(false); // already the hello size
    expect(control.conn.resize(120, 30)).toBe(true);
    expect(control.conn.resize(120, 30)).toBe(false);
    expect(cs.sent).toEqual([JSON.stringify({ type: "resize", cols: 120, rows: 30 })]);
    control.conn.dispose();
    expect(cs.sent.at(-1)).toBe(JSON.stringify({ type: "resize", cols: 160, rows: 45 }));
    expect(cs.closedWith).toBe(1000);
  });

  test("a long paste is split into frames the server accepts", () => {
    const { conn } = setup("control");
    const ws = FakeSocket.last();
    ws.open();
    ws.text(hello("control"));
    conn.send("x".repeat(TERMINAL_MAX_INPUT_BYTES * 2 + 5));
    const frames = ws.sent.filter((f): f is Uint8Array => typeof f !== "string");
    expect(frames.map((f) => f.byteLength)).toEqual([
      TERMINAL_MAX_INPUT_BYTES,
      TERMINAL_MAX_INPUT_BYTES,
      5,
    ]);
  });
});
