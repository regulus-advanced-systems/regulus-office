import { describe, expect, test } from "bun:test";
import { closedRoomsOnLevel } from "../../state/level.ts";
import { LINK_AGAIN_TO_ENTER_ROOMS, LINK_TO_ENTER_ROOMS, linkPromptFor } from "./linkPrompt.ts";

const status = (
  state: "not_linked" | "linked" | "revoked",
  unavailableReason: "oauth_not_configured" | "master_key_required" | null = null,
) => ({ state, available: unavailableReason === null, unavailableReason });

describe("the prompt to link GitHub (#270)", () => {
  test("nobody linked is prompted, and nothing shows before the state is known", () => {
    expect(linkPromptFor(null, false)).toBeNull();
    expect(linkPromptFor(status("linked"), true)).toBeNull();
  });

  test("not linked: the lobby sentence and a button", () => {
    expect(linkPromptFor(status("not_linked"), false)).toEqual({
      text: LINK_TO_ENTER_ROOMS,
      canLink: true,
    });
    expect(LINK_TO_ENTER_ROOMS).toBe("Link your GitHub account to enter your rooms.");
  });

  test("a link GitHub refused asks to link again", () => {
    expect(linkPromptFor(status("revoked"), false)?.text).toBe(LINK_AGAIN_TO_ENTER_ROOMS);
  });

  test("linking not set up: no button; the person running the office is told what to set", () => {
    const owner = linkPromptFor(status("not_linked", "oauth_not_configured"), true);
    expect(owner?.canLink).toBe(false);
    expect(owner?.hint).toContain("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET");
    expect(owner?.hint).toContain("every room stays closed for everyone");
    const key = linkPromptFor(status("not_linked", "master_key_required"), true);
    expect(key?.hint).toContain("OFFICE_MASTER_KEY");
    const member = linkPromptFor(status("not_linked", "oauth_not_configured"), false);
    expect(member?.hint).toBe(
      "Linking is not set up on this office yet. Ask the person who runs it.",
    );
  });
});

describe("closed rooms of a level (#270)", () => {
  const closed = (operationId: string, levelId: string) => ({
    operationId,
    levelId,
    gridX: 1,
    gridY: 2,
    width: 6,
    depth: 6,
    doorSide: "south" as const,
    doorX: 3,
    doorY: 8,
    closed: true,
  });

  test("only the viewed level's closed rooms, and none before the state arrives", () => {
    const state = { closedRooms: { b: closed("b", "lv1"), c: closed("c", "lv2") } };
    expect(closedRoomsOnLevel(state, "lv1").map((r) => r.operationId)).toEqual(["b"]);
    expect(closedRoomsOnLevel(state, "lobby")).toEqual([]);
    expect(closedRoomsOnLevel(null, "lv1")).toEqual([]);
    expect(closedRoomsOnLevel({}, "lv1")).toEqual([]);
  });
});
