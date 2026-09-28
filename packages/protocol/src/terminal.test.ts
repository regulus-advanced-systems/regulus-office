import { describe, expect, test } from "bun:test";
import {
  parseTerminalClientMessage,
  parseTerminalServerMessage,
  TERMINAL_DEFAULT_SIZE,
  TERMINAL_SIZE_LIMITS,
  terminalWsPath,
} from "./terminal.ts";

describe("terminal wire protocol", () => {
  test("path carries the agent id and mode", () => {
    expect(terminalWsPath("a1", "watch")).toBe("/ws/term/a1?mode=watch");
    expect(terminalWsPath("a b", "control")).toBe("/ws/term/a%20b?mode=control");
  });

  test("default size is the 160x45 virtual terminal and within limits", () => {
    expect(TERMINAL_DEFAULT_SIZE).toEqual({ cols: 160, rows: 45 });
    expect(TERMINAL_DEFAULT_SIZE.cols).toBeLessThanOrEqual(TERMINAL_SIZE_LIMITS.maxCols);
  });

  test("resize parses and is bounded", () => {
    expect(parseTerminalClientMessage('{"type":"resize","cols":120,"rows":40}')).toEqual({
      type: "resize",
      cols: 120,
      rows: 40,
    });
    expect(parseTerminalClientMessage('{"type":"resize","cols":5,"rows":40}')).toBeNull();
    expect(parseTerminalClientMessage('{"type":"resize","cols":120.5,"rows":40}')).toBeNull();
    expect(parseTerminalClientMessage('{"type":"resize","cols":9999,"rows":40}')).toBeNull();
  });

  test("unknown or malformed client frames are rejected", () => {
    expect(parseTerminalClientMessage("ls -la")).toBeNull();
    expect(parseTerminalClientMessage('{"type":"input","data":"x"}')).toBeNull();
    expect(parseTerminalClientMessage("[]")).toBeNull();
  });

  test("hello and viewers parse", () => {
    const hello = { type: "hello", mode: "watch", cols: 160, rows: 45, viewers: 2 };
    expect(parseTerminalServerMessage(JSON.stringify(hello))).toEqual(hello as never);
    expect(parseTerminalServerMessage('{"type":"viewers","viewers":0}')).toEqual({
      type: "viewers",
      viewers: 0,
    });
    expect(
      parseTerminalServerMessage(
        '{"type":"hello","mode":"admin","cols":160,"rows":45,"viewers":1}',
      ),
    ).toBeNull();
  });
});
