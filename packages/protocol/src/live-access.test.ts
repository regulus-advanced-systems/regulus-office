import { describe, expect, test } from "bun:test";
import {
  ACCESS_CLOSE_CODES,
  ACCESS_CLOSE_REASONS,
  accessCloseKind,
  accessCloseMessage,
  isFinalAccessClose,
} from "./live-access.ts";
import { TERMINAL_CLOSE_CODES } from "./terminal.ts";
import { WHITEBOARD_FULL_CODE } from "./whiteboard.ts";

describe("access close codes", () => {
  test("are application codes that collide with nothing else on these sockets", () => {
    const codes = Object.values(ACCESS_CLOSE_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    // Colyseus keeps 4000-4010 for itself (consented, shutdown, reconnect...).
    const taken = [
      ...Object.values(TERMINAL_CLOSE_CODES),
      WHITEBOARD_FULL_CODE,
      4001,
      4002,
      4003,
      4010,
    ];
    for (const code of codes) {
      expect(code).toBeGreaterThanOrEqual(4000);
      expect(code).toBeLessThanOrEqual(4999);
      expect(taken).not.toContain(code);
    }
  });

  test("kinds, finality and reasons", () => {
    expect(accessCloseKind(ACCESS_CLOSE_CODES.signedOut)).toBe("signedOut");
    expect(accessCloseKind(ACCESS_CLOSE_CODES.revoked)).toBe("revoked");
    expect(accessCloseKind(ACCESS_CLOSE_CODES.changed)).toBe("changed");
    expect(accessCloseKind(1006)).toBeNull();
    expect(accessCloseKind(4000)).toBeNull();
    expect(isFinalAccessClose(ACCESS_CLOSE_CODES.signedOut)).toBe(true);
    expect(isFinalAccessClose(ACCESS_CLOSE_CODES.revoked)).toBe(true);
    expect(isFinalAccessClose(ACCESS_CLOSE_CODES.changed)).toBe(false);
    expect(isFinalAccessClose(1006)).toBe(false);
    // A close reason is at most 123 bytes on the wire.
    for (const reason of Object.values(ACCESS_CLOSE_REASONS)) {
      expect(reason.length).toBeLessThan(60);
    }
  });

  test("messages are plain sentences naming what closed", () => {
    expect(accessCloseMessage("revoked", "whiteboard")).toBe(
      "You no longer have access to this whiteboard.",
    );
    expect(accessCloseMessage("revoked")).toBe("You no longer have access to this room.");
    expect(accessCloseMessage("signedOut", "terminal")).toBe(
      "You were signed out. Sign in again to continue.",
    );
    expect(accessCloseMessage("changed", "room")).toBe("Your access to this room changed.");
  });
});
