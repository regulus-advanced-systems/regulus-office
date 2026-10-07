/**
 * Nobody is told about a room their own GitHub access does not cover (D27;
 * #270): the henchman's owner, office admins who asked for other people's
 * errors, and team channels (through the person who set each one up) are all
 * checked against the access gate when a notice goes out.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_NOTIFICATION_PREFS, NOTIFY_ATTENTION_MESSAGE } from "@regulus/protocol";
import { notificationChannels } from "../db/schema/index.ts";
import { type CenterSetup, centerSetup } from "./center.fixture.ts";
import { startFakeWebhooks } from "./testing.ts";

const fake = startFakeWebhooks();
afterAll(() => fake.stop());

let s: CenterSetup;
beforeEach(() => {
  s = centerSetup(fake);
  fake.requests.length = 0;
});

/** Which fake service each request went to: Slack, Discord or Telegram. */
const delivered = () =>
  fake.requests
    .map((r) =>
      r.path.startsWith("/services/")
        ? "slack"
        : r.path.startsWith("/api/webhooks/")
          ? "discord"
          : "telegram",
    )
    .sort();

describe("personal notifications follow the person's own access to the room", () => {
  const lastBadge = () =>
    (
      s.sent.filter((m) => m.type === NOTIFY_ATTENTION_MESSAGE).at(-1)?.payload as {
        agentIds: string[];
      }
    ).agentIds;

  test("an owner who lost the room gets no desktop notice, and the badge drops that henchman", () => {
    // Mia's GitHub account can no longer see operation-1's repo; operation-2 is still hers.
    s.setAccess(s.member.id, 1, null);
    s.center.statusChanged(s.henchman("a1", "waiting_input"), "working");
    s.center.statusChanged(s.henchman("a2", "waiting_permission", 2), "working");
    expect(lastBadge()).toEqual(["a2"]);
    expect(s.center.attentionFor(s.member.id)).toEqual({ agentIds: ["a2"] });
    s.settle();
    expect(s.events().map((e) => [e.userId, e.payload.agentId])).toEqual([[s.member.id, "a2"]]);

    // With the room back, its henchman is on the badge again and the next event reaches her.
    s.setAccess(s.member.id, 1, "view");
    expect(s.center.attentionFor(s.member.id).agentIds.sort()).toEqual(["a1", "a2"]);
    s.clock.t += 61_000;
    s.center.statusChanged(s.henchman("a1", "done"), "waiting_input");
    s.settle();
    expect(s.events().map((e) => [e.payload.agentId, e.payload.event])).toEqual([
      ["a2", "needs_permission"],
      ["a1", "done"],
    ]);
  });

  test("an admin without GitHub access to the room gets no error notice; one with access does", () => {
    const bea = s.addUser("Bea", "admin");
    for (const manager of [s.owner, s.admin, bea]) {
      s.directory.setPrefs(manager.id, { ...DEFAULT_NOTIFICATION_PREFS, adminErrors: true });
    }
    // Bea's GitHub account can read operation-1's repo. Ada has linked nothing;
    // the office owner sees operation-1 but no longer operation-2.
    s.setAccess(bea.id, 1, "view");
    s.setAccess(s.owner.id, 2, null);
    s.center.statusChanged(s.henchman("a1", "error"), "working");
    s.settle();
    expect(s.events().map((e) => [e.userId, e.payload.own])).toEqual([
      [s.member.id, true],
      [s.owner.id, false],
      [bea.id, false],
    ]);
    s.sent.length = 0;
    // In operation-2 no opted-in manager can see the room: only the henchman's owner hears.
    s.center.statusChanged(s.henchman("a2", "error", 2), "working");
    s.settle();
    expect(s.events().map((e) => [e.userId, e.payload.own])).toEqual([[s.member.id, true]]);
    expect(JSON.stringify(s.sent.filter((m) => m.userId !== s.member.id))).not.toContain("API");
  });
});

describe("a team channel carries only rooms its creator can see", () => {
  const channel = (
    kind: "slack" | "discord" | "telegram",
    createdBy: string,
    operationIds: string[] | null = null,
  ) =>
    s.channels.create(
      {
        kind,
        label: kind,
        secret:
          kind === "slack"
            ? fake.slackUrl
            : kind === "discord"
              ? fake.discordUrl
              : fake.telegramToken,
        ...(kind === "telegram" ? { chatId: "-1001" } : {}),
        operationIds,
        events: ["needs_input", "error"],
      },
      createdBy,
    );
  const errorIn = async (agentId: "a1" | "a2") => {
    fake.requests.length = 0;
    s.clock.t += 61_000;
    s.center.statusChanged(s.henchman(agentId, "error", agentId === "a1" ? 1 : 2), "working");
    s.settle();
    await s.dispatcher.drain();
    return delivered();
  };

  test("a channel set up by someone who cannot see the room gets nothing; one by someone who can does", async () => {
    // Ada is an office admin with no GitHub access to either repo; the owner sees both.
    channel("slack", s.admin.id);
    channel("discord", s.owner.id);
    expect(await errorIn("a1")).toEqual(["discord"]);
    // Naming the room does not help either.
    channel("telegram", s.admin.id, ["operation-1"]);
    expect(await errorIn("a1")).toEqual(["discord"]);
    // Once Ada's own GitHub account can see the repo, her channels carry the room.
    s.setAccess(s.admin.id, 1, "view");
    expect(await errorIn("a1")).toEqual(["discord", "slack", "telegram"]);
  });

  test('"every operation" means every one the creator can see', async () => {
    s.setAccess(s.admin.id, 1, "view");
    channel("slack", s.admin.id);
    expect(await errorIn("a1")).toEqual(["slack"]);
    expect(await errorIn("a2")).toEqual([]);
    expect(JSON.stringify(fake.requests)).not.toContain("API");
  });

  test("a creator who loses the room, or is gone, takes the channel's events with them", async () => {
    channel("slack", s.owner.id, ["operation-2"]);
    channel("discord", s.owner.id);
    expect(await errorIn("a2")).toEqual(["discord", "slack"]);
    s.setAccess(s.owner.id, 2, null);
    expect(await errorIn("a2")).toEqual([]);
    expect(await errorIn("a1")).toEqual(["discord"]);
    // The creator's account is gone (`created_by` null): the channel carries nothing.
    s.db.update(notificationChannels).set({ createdBy: null }).run();
    expect(await errorIn("a1")).toEqual([]);
  });
});
