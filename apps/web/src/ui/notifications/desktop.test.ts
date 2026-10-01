import { describe, expect, test } from "bun:test";
import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
  type NotifyEvent,
} from "@regulus/protocol";
import {
  badgeTitle,
  inQuietHours,
  notificationBody,
  notificationTitle,
  wantsDesktop,
} from "./desktop.ts";

const at = (h: number, m = 0) => new Date(2026, 8, 30, h, m);
const quiet = (start: string, end: string): NotificationPrefs => ({
  ...DEFAULT_NOTIFICATION_PREFS,
  quietHours: { enabled: true, start, end },
});
const ev = (extra: Partial<NotifyEvent> = {}): NotifyEvent => ({
  id: "1",
  event: "needs_input",
  agentId: "a1",
  floorId: "f1",
  floorName: "Web app",
  robotName: "Mia's Codex henchman",
  ownerName: "Mia",
  provider: "codex",
  taskTitle: "Fix the login page",
  prNumber: 0,
  prUrl: "",
  own: true,
  ts: 1,
  ...extra,
});

describe("quiet hours", () => {
  test("a window across midnight", () => {
    const p = quiet("22:00", "08:00");
    expect(inQuietHours(p, at(23))).toBe(true);
    expect(inQuietHours(p, at(7, 59))).toBe(true);
    expect(inQuietHours(p, at(8))).toBe(false);
    expect(inQuietHours(p, at(12))).toBe(false);
  });

  test("a daytime window, and disabled", () => {
    const p = quiet("12:00", "13:30");
    expect(inQuietHours(p, at(12, 45))).toBe(true);
    expect(inQuietHours(p, at(13, 30))).toBe(false);
    expect(inQuietHours(DEFAULT_NOTIFICATION_PREFS, at(23))).toBe(false);
  });
});

describe("wantsDesktop", () => {
  test("per-event switches and quiet hours", () => {
    expect(wantsDesktop(ev(), DEFAULT_NOTIFICATION_PREFS, at(12))).toBe(true);
    expect(wantsDesktop(ev({ event: "pr_opened" }), DEFAULT_NOTIFICATION_PREFS, at(12))).toBe(
      false,
    );
    expect(wantsDesktop(ev(), quiet("11:00", "13:00"), at(12))).toBe(false);
  });

  test("someone else's robot only for opted-in admins, errors only", () => {
    const admin = { ...DEFAULT_NOTIFICATION_PREFS, adminErrors: true };
    expect(wantsDesktop(ev({ own: false, event: "error" }), admin, at(12))).toBe(true);
    expect(wantsDesktop(ev({ own: false, event: "done" }), admin, at(12))).toBe(false);
    expect(
      wantsDesktop(ev({ own: false, event: "error" }), DEFAULT_NOTIFICATION_PREFS, at(12)),
    ).toBe(false);
  });
});

test("title and body", () => {
  expect(notificationTitle(ev())).toBe("Mia's Codex henchman needs your input");
  expect(notificationBody(ev({ prNumber: 4 }))).toBe(
    "Operation: Web app\nFix the login page\nPull request #4",
  );
});

test("tab badge title", () => {
  expect(badgeTitle("Regulus Office", 2)).toBe("(2) Regulus Office");
  expect(badgeTitle("(2) Regulus Office", 3)).toBe("(3) Regulus Office");
  expect(badgeTitle("(3) Regulus Office", 0)).toBe("Regulus Office");
  expect(badgeTitle("Regulus Office", 120)).toBe("(99+) Regulus Office");
  expect(badgeTitle("(99+) Regulus Office", 1)).toBe("(1) Regulus Office");
});
