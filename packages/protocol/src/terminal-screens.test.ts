import { describe, expect, test } from "bun:test";
import {
  clampScreenText,
  parseScreenFeedMessage,
  SCREEN_TEXT_LIMITS,
  screensWsPath,
} from "./terminal-screens.ts";

describe("screen feed protocol", () => {
  test("path carries the operation id", () => {
    expect(screensWsPath("operation-1")).toBe("/ws/screens/operation-1");
    expect(screensWsPath("a/b")).toBe("/ws/screens/a%2Fb");
  });

  test("screen and removed parse; anything else is rejected", () => {
    const screen = { type: "screen", agentId: "a1", text: "$ ls\nREADME" };
    expect(parseScreenFeedMessage(JSON.stringify(screen))).toEqual(screen as never);
    expect(parseScreenFeedMessage('{"type":"removed","agentId":"a1"}')).toEqual({
      type: "removed",
      agentId: "a1",
    });
    expect(parseScreenFeedMessage('{"type":"screen","agentId":"","text":""}')).toBeNull();
    expect(parseScreenFeedMessage("not json")).toBeNull();
    const huge = {
      type: "screen",
      agentId: "a",
      text: "x".repeat(SCREEN_TEXT_LIMITS.maxBytes + 1),
    };
    expect(parseScreenFeedMessage(JSON.stringify(huge))).toBeNull();
  });

  test("clamp keeps the last lines, cuts wide lines and strips control characters", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const out = clampScreenText(`${lines.join("\n")}\n\n\n`);
    const kept = out.split("\n");
    expect(kept).toHaveLength(SCREEN_TEXT_LIMITS.maxLines);
    expect(kept.at(-1)).toBe("line 99");
    expect(clampScreenText("a".repeat(500))).toHaveLength(SCREEN_TEXT_LIMITS.maxCols);
    expect(clampScreenText("a\u001b[31mb\u0007c\r\nd")).toBe("a [31mb c\nd");
  });

  test("clamp caps the UTF-8 size", () => {
    const wide = Array.from({ length: 60 }, () => "█".repeat(240)).join("\n");
    const out = clampScreenText(wide);
    expect(new TextEncoder().encode(out).byteLength).toBeLessThanOrEqual(
      SCREEN_TEXT_LIMITS.maxBytes,
    );
    expect(out.length).toBeGreaterThan(0);
  });
});
