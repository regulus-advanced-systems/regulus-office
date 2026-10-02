import { describe, expect, test } from "bun:test";
import { LOBBY_OPERATION_ID, SCREEN_SHARE_REJECTIONS } from "@regulus/protocol";
import {
  createScreenShareRules,
  currentSharer,
  type ScreenShareTakedown,
  type SharingHuman,
} from "./screen-share.ts";

function humans() {
  const map = new Map<string, SharingHuman>([
    [
      "s-ada",
      { userId: "ada", displayName: "Ada", operationId: LOBBY_OPERATION_ID, sharingScreen: false },
    ],
    [
      "s-bob",
      { userId: "bob", displayName: "Bob", operationId: LOBBY_OPERATION_ID, sharingScreen: false },
    ],
    [
      "s-vic",
      { userId: "vic", displayName: "Vic", operationId: LOBBY_OPERATION_ID, sharingScreen: false },
    ],
    ["s-roz", { userId: "roz", displayName: "Roz", operationId: "op-1", sharingScreen: false }],
  ]);
  return map;
}

const member = (userId: string) => ({ userId, role: "member" as const });

describe("lounge TV sharing (#48)", () => {
  test("off without media", () => {
    const rules = createScreenShareRules({ enabled: false });
    const h = humans();
    expect(rules.start(h, "s-ada", member("ada"))).toEqual({
      ok: false,
      reason: SCREEN_SHARE_REJECTIONS.disabled,
    });
    expect(h.get("s-ada")?.sharingScreen).toBe(false);
  });

  test("one sharer at a time; viewers and people outside the lobby may not share", () => {
    const rules = createScreenShareRules({ enabled: true });
    const h = humans();
    expect(rules.start(h, "s-ada", member("ada"))).toEqual({ ok: true });
    expect(currentSharer(h)?.sessionId).toBe("s-ada");
    expect(rules.start(h, "s-ada", member("ada"))).toEqual({ ok: true });
    const busy = rules.start(h, "s-bob", member("bob"));
    expect(busy.ok).toBe(false);
    expect(!busy.ok && busy.reason).toContain("Ada is sharing");
    expect(rules.start(h, "s-vic", { userId: "vic", role: "viewer" })).toEqual({
      ok: false,
      reason: SCREEN_SHARE_REJECTIONS.viewer,
    });
    rules.stop(h, "s-ada", member("ada"));
    expect(rules.start(h, "s-roz", member("roz"))).toEqual({
      ok: false,
      reason: SCREEN_SHARE_REJECTIONS.notInLobby,
    });
    expect(rules.start(h, "s-bob", member("bob"))).toEqual({ ok: true });
  });

  test("the sharer stops their own; members cannot stop someone else's", () => {
    const rules = createScreenShareRules({ enabled: true });
    const h = humans();
    rules.start(h, "s-ada", member("ada"));
    expect(rules.stop(h, "s-bob", member("bob"), "s-ada")).toEqual({
      ok: false,
      reason: SCREEN_SHARE_REJECTIONS.notYours,
    });
    expect(h.get("s-ada")?.sharingScreen).toBe(true);
    expect(rules.apply(h, "s-ada", member("ada"), { type: "screen.share.stop" })).toEqual({
      ok: true,
    });
    expect(currentSharer(h)).toBeNull();
    // Stopping when not sharing is harmless.
    expect(rules.stop(h, "s-ada", member("ada"))).toEqual({ ok: true });
  });

  test("an admin takes someone else's screen off the TV, audited", () => {
    const audits: ScreenShareTakedown[] = [];
    const rules = createScreenShareRules({ enabled: true, audit: (t) => audits.push(t) });
    const h = humans();
    rules.start(h, "s-ada", member("ada"));
    expect(rules.stop(h, "s-bob", { userId: "bob", role: "admin" }, "s-ada")).toEqual({
      ok: true,
    });
    expect(h.get("s-ada")?.sharingScreen).toBe(false);
    expect(audits).toEqual([{ byUserId: "bob", userId: "ada", sessionId: "s-ada" }]);
    expect(rules.stop(h, "s-bob", { userId: "bob", role: "owner" }, "s-ada")).toEqual({
      ok: false,
      reason: SCREEN_SHARE_REJECTIONS.notSharing,
    });
    expect(audits).toHaveLength(1);
  });
});
