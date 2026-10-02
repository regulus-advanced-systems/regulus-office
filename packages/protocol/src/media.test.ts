import { describe, expect, test } from "bun:test";
import { parseClientCommand } from "./commands/index.ts";
import {
  MediaTokenRequest,
  mayShareScreen,
  mayStopAnyScreenShare,
  mayTalk,
  mediaGrantsFor,
  type VoicePresence,
  voiceListeners,
} from "./media.ts";

describe("media grants per role (#48)", () => {
  test("owners, admins and members may talk and share; nobody gets data or metadata", () => {
    for (const role of ["owner", "admin", "member"] as const) {
      const g = mediaGrantsFor(role);
      expect(g.canSubscribe).toBe(true);
      expect(g.canPublish).toBe(true);
      expect(g.canPublishSources).toEqual(["microphone", "screen_share", "screen_share_audio"]);
      expect(g.canPublishData).toBe(false);
      expect(g.canUpdateOwnMetadata).toBe(false);
      expect(mayTalk(role) && mayShareScreen(role)).toBe(true);
    }
  });

  test("viewers only watch and listen", () => {
    expect(mediaGrantsFor("viewer")).toEqual({
      canSubscribe: true,
      canPublish: false,
      canPublishSources: [],
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
    expect(mayTalk("viewer")).toBe(false);
    expect(mayShareScreen("viewer")).toBe(false);
  });

  test("only owners and admins stop someone else's share", () => {
    expect(mayStopAnyScreenShare("owner")).toBe(true);
    expect(mayStopAnyScreenShare("admin")).toBe(true);
    expect(mayStopAnyScreenShare("member")).toBe(false);
    expect(mayStopAnyScreenShare("viewer")).toBe(false);
  });
});

describe("voice listeners", () => {
  const people: VoicePresence[] = [
    { sessionId: "a", operationId: "lobby" },
    { sessionId: "b", operationId: "op-1" },
    { sessionId: "c", operationId: "op-1" },
    { sessionId: "d", operationId: "op-2" },
  ];
  const [a, b, , d] = people as [VoicePresence, VoicePresence, VoicePresence, VoicePresence];

  test("a voice in the lobby, corridors or special rooms is open to everyone", () => {
    expect(voiceListeners(a, people, "lobby")).toBe("all");
  });

  test("a voice in a project room reaches only the others in that room", () => {
    expect(voiceListeners(b, people, "lobby")).toEqual(["c"]);
    expect(voiceListeners(d, people, "lobby")).toEqual([]);
  });
});

describe("wire shapes", () => {
  test("a token request names a session", () => {
    expect(MediaTokenRequest.safeParse({ sessionId: "abc" }).success).toBe(true);
    expect(MediaTokenRequest.safeParse({}).success).toBe(false);
    expect(MediaTokenRequest.safeParse({ sessionId: "" }).success).toBe(false);
  });

  test("screen.share.stop takes an optional target session", () => {
    expect(parseClientCommand("screen.share.stop", {}).success).toBe(true);
    const other = parseClientCommand("screen.share.stop", { sessionId: "s1" });
    expect(other.success && other.data.type === "screen.share.stop" && other.data.sessionId).toBe(
      "s1",
    );
  });
});
