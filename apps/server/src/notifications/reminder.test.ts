/**
 * The office PM's reminder (#60): standing next to a henchman that waits for
 * its owner, it brings the owner the existing "needs you" notice, once per
 * wait however many rounds pass, by the rules of every personal notice.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_NOTIFICATION_PREFS, NotifyEvent } from "@regulus/protocol";
import { type CenterSetup, centerSetup } from "./center.fixture.ts";
import { startFakeWebhooks } from "./testing.ts";

const fake = startFakeWebhooks();
afterAll(() => fake.stop());

let s: CenterSetup;
beforeEach(() => {
  s = centerSetup(fake);
  fake.requests.length = 0;
});

describe("NotificationCenter.remind", () => {
  test("the owner gets the needs-you notice once, round after round", () => {
    const waiting = s.henchman("a1", "waiting_permission");
    s.center.statusChanged(waiting, "working");
    s.settle();
    expect(s.events()).toHaveLength(1);
    // Three rounds pass by the same wait.
    expect(s.center.remind(waiting, "Ledger")).toBe(true);
    s.clock.t += 15 * 60_000;
    expect(s.center.remind(waiting, "Ledger")).toBe(false);
    s.clock.t += 15 * 60_000;
    expect(s.center.remind(waiting, "Ledger")).toBe(false);
    expect(s.events()).toHaveLength(2);
    const { userId, payload } = s.events()[1]!;
    expect(userId).toBe(s.member.id);
    // The same notice the henchman's own event sends, plus who brought it.
    expect(NotifyEvent.parse(payload)).toMatchObject({
      event: "needs_permission",
      agentId: "a1",
      operationId: "operation-1",
      henchmanName: "Gasket, Mia's Codex henchman",
      own: true,
      via: "Ledger",
    });
    const { via: _via, id: _id, ts: _ts, ...reminder } = payload;
    const { id: _id0, ts: _ts0, ...first } = s.events()[0]!.payload;
    expect(reminder).toEqual(first);
    // Nothing goes to a team channel for a reminder.
    expect(fake.requests).toHaveLength(0);
  });

  test("a new wait is brought again; other statuses never are", () => {
    const waiting = s.henchman("a1", "waiting_input");
    expect(s.center.remind(waiting, "Ledger")).toBe(true);
    expect(s.center.remind(waiting, "Ledger")).toBe(false);
    // It was answered and asks again later.
    s.center.statusChanged(s.henchman("a1", "working"), "waiting_input");
    s.center.statusChanged(s.henchman("a1", "waiting_input"), "working");
    expect(s.center.remind(s.henchman("a1", "waiting_input"), "Ledger")).toBe(true);
    for (const status of ["working", "done", "error", "idle", "exited"] as const) {
      expect(s.center.remind(s.henchman("a2", status, 2), "Ledger")).toBe(false);
    }
    expect(s.events().filter((e) => e.payload.via === "Ledger")).toHaveLength(2);
  });

  test("a henchman that is sent home is forgotten", () => {
    expect(s.center.remind(s.henchman("a1", "waiting_input"), "Ledger")).toBe(true);
    s.center.henchmanRemoved("a1");
    expect(s.center.remind(s.henchman("a1", "waiting_input"), "Ledger")).toBe(true);
  });

  test("the owner's preference and their own access to the room hold; a refusal is not the one time", () => {
    const waiting = s.henchman("a1", "waiting_permission");
    s.directory.setPrefs(s.member.id, {
      ...DEFAULT_NOTIFICATION_PREFS,
      desktop: { ...DEFAULT_NOTIFICATION_PREFS.desktop, needs_permission: false },
    });
    expect(s.center.remind(waiting, "Ledger")).toBe(false);
    s.directory.setPrefs(s.member.id, DEFAULT_NOTIFICATION_PREFS);
    // Mia's GitHub account can no longer see the room: she hears nothing of it.
    s.setAccess(s.member.id, 1, null);
    expect(s.center.remind(waiting, "Ledger")).toBe(false);
    expect(s.events()).toHaveLength(0);
    s.setAccess(s.member.id, 1, "view");
    expect(s.center.remind(waiting, "Ledger")).toBe(true);
    expect(s.events().map((e) => e.userId)).toEqual([s.member.id]);
  });
});
