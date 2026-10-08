import { beforeEach, describe, expect, test } from "bun:test";
import type { OfficeAgentBody } from "@regulus/protocol";
import {
  bodiesOnLevel,
  bodyBubble,
  bodyCaption,
  bodyLight,
  canChatWith,
  nearestBody,
  openBodyChat,
  useAgentAttention,
  useAgentChatWindow,
  type Viewer,
} from "./officeAgents.ts";

const body = (over: Partial<OfficeAgentBody>): OfficeAgentBody => ({
  agentId: "a1",
  name: "Quillon",
  ownerUserId: "ante",
  ownerName: "Ante",
  appearance: "secretary",
  status: "ready",
  levelId: "lobby",
  operationId: "lobby",
  mode: "follow",
  target: { x: 1, z: 2, heading: 0 },
  hop: 1,
  doing: "",
  dismissed: false,
  post: "none",
  ...over,
});
const SHARED = body({
  agentId: "s1",
  name: "Number Two",
  ownerUserId: "",
  ownerName: "",
  mode: "wander",
});
const ante: Viewer = { id: "ante", role: "member" };
const mia: Viewer = { id: "mia", role: "member" };
const admin: Viewer = { id: "olga", role: "owner" };
const guest: Viewer = { id: "guest", role: "viewer" };

beforeEach(() => {
  useAgentChatWindow.getState().close();
  useAgentAttention.getState().set([]);
});

describe("office agent bodies for this viewer", () => {
  test("only the bodies of the level being looked at", () => {
    const state = {
      officeAgents: { a1: body({}), s1: SHARED, x: body({ agentId: "x", levelId: "level-acme" }) },
    };
    expect(bodiesOnLevel(state, "lobby").map((b) => b.agentId)).toEqual(["a1", "s1"]);
    expect(bodiesOnLevel(state, "level-acme").map((b) => b.agentId)).toEqual(["x"]);
    expect(bodiesOnLevel(null, "lobby")).toEqual([]);
  });

  test("a personal agent's chat is its owner's alone, whatever the other person's role", () => {
    expect(canChatWith(body({}), ante)).toBe(true);
    expect(canChatWith(body({}), mia)).toBe(false);
    expect(canChatWith(body({}), admin)).toBe(false);
    expect(canChatWith(body({}), null)).toBe(false);
    expect(openBodyChat(body({}), mia)).toBe(false);
    expect(useAgentChatWindow.getState().agentId).toBeNull();
    expect(openBodyChat(body({}), ante)).toBe(true);
    expect(useAgentChatWindow.getState().agentId).toBe("a1");
  });

  test("a shared agent's chat opens for members and above, not for office viewers", () => {
    expect(canChatWith(SHARED, ante)).toBe(true);
    expect(canChatWith(SHARED, mia)).toBe(true);
    expect(canChatWith(SHARED, guest)).toBe(false);
    expect(openBodyChat(SHARED, guest)).toBe(false);
    expect(openBodyChat(SHARED, mia)).toBe(true);
    expect(useAgentChatWindow.getState().agentId).toBe("s1");
  });

  test("whose it is, in words", () => {
    expect(bodyCaption(body({}), ante)).toBe("Your assistant");
    expect(bodyCaption(body({}), mia)).toBe("Ante's assistant");
    expect(bodyCaption(SHARED, mia)).toBe("Office agent");
  });
});

describe("the bubble over a body", () => {
  const conversation = { targetKind: "conversation", targetId: "a1" } as const;

  test("a question it asked me shows as needs_you and opens the chat", () => {
    const b = bodyBubble(
      body({}),
      { agentId: "a1", question: "Ship it tonight?", unread: true, waiting: false },
      ante,
      true,
    );
    expect(b).toEqual({ kind: "needs_you", text: "Ship it tonight?", ...conversation });
  });

  test("an unread reply shows as answer_ready; a reply still owed as a quiet doing", () => {
    expect(
      bodyBubble(body({}), { agentId: "a1", unread: true, waiting: false }, ante, false),
    ).toEqual({
      kind: "answer_ready",
      text: "has an answer for you",
      ...conversation,
    });
    expect(
      bodyBubble(body({}), { agentId: "a1", unread: false, waiting: true }, ante, false)?.kind,
    ).toBe("doing");
  });

  test("a long question is cut to bubble length", () => {
    const b = bodyBubble(
      body({}),
      { agentId: "a1", question: "x".repeat(300), unread: false, waiting: false },
      ante,
      true,
    );
    expect(b?.text.length).toBe(64);
  });

  test("someone else's personal agent says whose it is and nothing else", () => {
    // Even if the client were handed its attention, the other person sees none of it.
    const leaked = { agentId: "a1", question: "the launch code?", unread: true, waiting: true };
    for (const viewer of [mia, admin]) {
      const b = bodyBubble(body({ doing: "studying the issue board" }), leaked, viewer, true);
      expect(b).toEqual({
        kind: "doing",
        text: "Ante's assistant",
        targetKind: "none",
        targetId: "",
      });
    }
  });

  test("on its own it says where it stands, once it stands there", () => {
    const wandering = body({ mode: "wander", doing: "watching the usage wall" });
    expect(bodyBubble(wandering, undefined, ante, true)?.text).toBe("watching the usage wall");
    expect(bodyBubble(wandering, undefined, ante, false)).toBeNull();
    expect(
      bodyBubble({ ...SHARED, doing: "patrolling the lobby" }, undefined, mia, true)?.kind,
    ).toBe("doing");
    // Following quietly at my side: no bubble.
    expect(bodyBubble(body({}), undefined, ante, true)).toBeNull();
  });

  test("a shared agent's question to me shows for me, not for the next person", () => {
    const asked = { agentId: "s1", question: "Which repo?", unread: false, waiting: false };
    expect(bodyBubble(SHARED, asked, mia, true)?.kind).toBe("needs_you");
    expect(bodyBubble(SHARED, undefined, ante, true)).toBeNull();
    expect(bodyBubble(SHARED, asked, guest, true)).toBeNull();
  });
});

describe("helpers", () => {
  test("status light", () => {
    expect(bodyLight("busy")).toBe("working");
    expect(bodyLight("ready")).toBe("idle");
    expect(bodyLight("stopped")).toBe("offline");
    expect(bodyLight("error")).toBe("error");
  });

  test("E picks the nearest body within reach", () => {
    const near = { id: "n", x: 1, z: 0 };
    const far = { id: "f", x: 5, z: 0 };
    expect(nearestBody([far, near], { x: 0, z: 0 }, 2)?.id).toBe("n");
    expect(nearestBody([far], { x: 0, z: 0 }, 2)).toBeNull();
  });

  test("the attention store is keyed by agent", () => {
    useAgentAttention.getState().set([{ agentId: "a1", unread: true, waiting: false }]);
    expect(useAgentAttention.getState().byAgent.a1?.unread).toBe(true);
    useAgentAttention.getState().set([]);
    expect(useAgentAttention.getState().byAgent).toEqual({});
  });
});
