import { describe, expect, test } from "bun:test";
import {
  INITIAL_TERMINAL_STATE,
  type TerminalEvent,
  TYPING_VISIBLE_MS,
  terminalReducer,
  uniquePeers,
} from "./terminalState.ts";

const hello: TerminalEvent = {
  kind: "hello",
  mode: "watch",
  cols: 160,
  rows: 45,
  viewers: 2,
  peers: [
    { userId: "a", name: "Ada", mode: "watch" },
    { userId: "b", name: "Bo", mode: "control" },
  ],
};

describe("terminal UI state", () => {
  test("hello opens with mode, viewers and peers; viewers updates them", () => {
    const s = terminalReducer(INITIAL_TERMINAL_STATE, hello);
    expect(s).toMatchObject({ status: "open", mode: "watch", viewers: 2 });
    expect(s.peers).toHaveLength(2);
    const v = terminalReducer(s, { kind: "viewers", viewers: 1 });
    expect(v.viewers).toBe(1);
    expect(v.peers).toHaveLength(2);
  });

  test("typing shows for a while, then a tick clears it", () => {
    const s = terminalReducer(INITIAL_TERMINAL_STATE, {
      kind: "typing",
      userId: "b",
      name: "Bo",
      at: 1000,
    });
    expect(s.typing).toEqual({ userId: "b", name: "Bo", until: 1000 + TYPING_VISIBLE_MS });
    expect(terminalReducer(s, { kind: "tick", now: 1500 }).typing).not.toBeNull();
    expect(terminalReducer(s, { kind: "tick", now: 1000 + TYPING_VISIBLE_MS }).typing).toBeNull();
  });

  test("refused control keeps its notice through the watch hello", () => {
    const refused = terminalReducer(INITIAL_TERMINAL_STATE, { kind: "downgraded" });
    expect(terminalReducer(refused, hello).notice).toContain("Control was refused");
    const retry = terminalReducer(INITIAL_TERMINAL_STATE, { kind: "retry", delayMs: 2000 });
    expect(retry.status).toBe("reconnecting");
    expect(retry.notice).toContain("2 s");
    expect(terminalReducer(retry, hello).notice).toBeNull();
    const open = terminalReducer(INITIAL_TERMINAL_STATE, hello);
    expect(terminalReducer(open, { kind: "ended" }).status).toBe("ended");
    expect(terminalReducer(INITIAL_TERMINAL_STATE, { kind: "unavailable" }).status).toBe(
      "unavailable",
    );
  });

  test("access withdrawn shows a plain, final notice (#244)", () => {
    const open = terminalReducer(INITIAL_TERMINAL_STATE, hello);
    const lost = terminalReducer(open, { kind: "access_lost", signedOut: false });
    expect(lost.status).toBe("unavailable");
    expect(lost.mode).toBeNull();
    expect(lost.notice).toBe("You no longer have access to this terminal.");
    const out = terminalReducer(open, { kind: "access_lost", signedOut: true });
    expect(out.notice).toBe("You were signed out. Sign in again to continue.");
  });

  test("uniquePeers merges tabs and prefers the control entry", () => {
    expect(
      uniquePeers([
        { userId: "a", name: "Ada", mode: "watch" },
        { userId: "a", name: "Ada", mode: "control" },
        { userId: "b", name: "Bo", mode: "watch" },
        { userId: "a", name: "Ada", mode: "watch" },
      ]),
    ).toEqual([
      { userId: "a", name: "Ada", mode: "control" },
      { userId: "b", name: "Bo", mode: "watch" },
    ]);
  });
});
