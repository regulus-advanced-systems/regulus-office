/** Settings → Agents (#271, #280): the list in plain words, who gets which controls, the one-time access code, chat and questions. The form is AgentForm.test.tsx. */
import { afterEach, describe, expect, test } from "bun:test";
import type { OfficeAgentConversation } from "@regulus/protocol";
import { act } from "react";
import { click, useDom } from "../a11y/dom.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import { useChatRequest } from "./chatRequest.ts";
import { ago } from "./labels.ts";
import {
  agent,
  card,
  cleanup,
  mounted,
  NOW,
  QUESTION,
  response,
  SHARED,
  SOMEONES,
  show,
  within,
} from "./testKit.tsx";

useDom();
afterEach(cleanup);

describe("office agents section", () => {
  test("a card says in plain words what the agent is, runs on and looks like; controls follow what the viewer may do", async () => {
    await show("admin", {
      "GET /api/office-agents": { body: response([agent({}), SHARED, SOMEONES]) },
    });
    const mine = card("Hermes");
    expect(mine.textContent).toContain("Ready");
    expect(mine.textContent).toContain("Runs as: Claude Code session");
    expect(mine.textContent).toContain("Runs on: Claude subscription");
    expect(mine.textContent).toContain("Model: Sonnet");
    expect(mine.textContent).toContain("Job: Project manager");
    expect(mine.textContent).toContain("May: Organise work");
    expect(mine.textContent).toContain("Looks: Standard jumpsuit");
    for (const jargon of ["Coordinator", "preset", "grant", "token", "Engine"]) {
      expect(mine.textContent).not.toContain(jargon);
    }
    expect(mine.textContent).toContain("Last active 5 min ago");
    expect(within(mine, "Chat")).toBeDefined();
    expect(within(mine, "Stop")).toBeDefined();
    // A shared agent this viewer cannot configure: chat only.
    const shared = card("Number Two");
    expect(shared.textContent).toContain("Shared by the office");
    expect(within(shared, "Chat")).toBeDefined();
    expect(within(shared, "Start")).toBeUndefined();
    expect(within(shared, "Delete…")).toBeUndefined();
    // Someone else's personal agent, seen by an admin: no chat, no settings, only the emergency stop.
    const theirs = card("Mias helper");
    expect(theirs.textContent).toContain("Personal: Mia");
    expect(within(theirs, "Chat")).toBeUndefined();
    expect(within(theirs, "Emergency stop")).toBeDefined();
    expect(theirs.querySelector("details")).toBeNull();
    expect(theirs.textContent).toContain("only the person it belongs to");
    expect(ago(undefined, NOW)).toBe("never");
    expect(ago(NOW - 3 * 3_600_000, NOW)).toBe("3 h ago");
  });

  test("a new access code is shown once and is gone after the next change", async () => {
    const f = await show("member", {
      "GET /api/office-agents": { body: response([agent({})]) },
      "POST /api/office-agents/a1/tokens": {
        status: 201,
        body: { id: "t1", label: "Outside program", token: "roa_SHOWN-ONCE" },
      },
      "POST /api/office-agents/a1/stop": { body: agent({ status: "stopped" }) },
    });
    await click(within(card("Hermes"), "Create an access code") as HTMLButtonElement);
    await settle();
    expect(f.calls.some((c) => c.path === "/api/office-agents/a1/tokens")).toBe(true);
    expect(text()).toContain("roa_SHOWN-ONCE");
    expect(text()).toContain("It is not shown again");
    await click(within(card("Hermes"), "Stop") as HTMLButtonElement);
    await settle();
    expect(text()).not.toContain("roa_SHOWN-ONCE");
  });

  test("chat shows the history and that the agent is working; questions can be answered", async () => {
    const convo: OfficeAgentConversation = {
      agentId: "a1",
      status: "busy",
      waiting: true,
      messages: [
        { id: "m1", author: "person", text: "Status?", ts: NOW },
        { id: "m2", author: "agent", text: "Two PRs are waiting.", ts: NOW },
        { id: "m3", author: "person", text: "Which?", ts: NOW },
      ],
    };
    const f = await show("member", {
      "GET /api/office-agents": { body: response([agent({})]) },
      "GET /api/office-agents/requests": { body: { requests: [QUESTION] } },
      "GET /api/office-agents/a1/conversation": { body: convo },
      "POST /api/office-agents/requests/r1/answer": {
        body: { ...QUESTION, status: "answered", answer: "Yes" },
      },
    });
    expect(text()).toContain("Hermes asks: Ship on Friday?");
    await click(within(card("Hermes"), "Chat") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("Two PRs are waiting.");
    expect(text()).toContain("Hermes is working on an answer");
    await click(button("Yes") as HTMLButtonElement);
    await settle();
    expect(f.calls.find((c) => c.path.endsWith("/answer"))?.body).toEqual({ answer: "Yes" });
  });

  test("a chat asked for from the world (a click on the agent's bubble, #256) opens by itself", async () => {
    useChatRequest.getState().request("a1");
    await show("member", {
      "GET /api/office-agents": { body: response([agent({})]) },
      "GET /api/office-agents/a1/conversation": {
        body: {
          agentId: "a1",
          status: "busy",
          waiting: true,
          messages: [{ id: "m1", author: "agent", text: "You called?", ts: NOW }],
        } satisfies OfficeAgentConversation,
      },
    });
    await settle();
    expect(text()).toContain("You called?");
    expect(within(card("Hermes"), "Close chat")).toBeDefined();
    // The request is used up: the chat does not reopen by itself after it is closed.
    expect(useChatRequest.getState().agentId).toBeNull();
  });

  test("the hourly limit on a shared agent is shown plainly in the chat; viewers get no chat", async () => {
    const talkable = { ...SHARED, status: "ready" as const };
    await show("member", {
      "GET /api/office-agents": { body: response([talkable]) },
      "GET /api/office-agents/a2/conversation": {
        body: { agentId: "a2", status: "ready", waiting: false, messages: [] },
      },
      "POST /api/office-agents/a2/messages": {
        status: 429,
        body: { error: "message_rate_limited", limit: 20, retryAfterSeconds: 1500 },
      },
    });
    await click(within(card("Number Two"), "Chat") as HTMLButtonElement);
    await settle();
    const box = card("Number Two").querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      box.value = "one more";
    });
    await click(within(card("Number Two"), "Send") as HTMLButtonElement);
    await settle();
    expect(card("Number Two").querySelector('[role="alert"]')?.textContent).toBe(
      "You have reached the hourly limit of messages to this shared agent. Try again in about 25 min.",
    );
    // The draft is kept, so nothing typed is lost.
    expect(box.value).toBe("one more");

    for (const m of mounted.splice(0)) await m.unmount();
    await show("viewer", {
      "GET /api/office-agents": { body: response([{ ...talkable, canTalk: false }]) },
    });
    expect(within(card("Number Two"), "Chat")).toBeUndefined();
    expect(card("Number Two").textContent).toContain("Viewers cannot talk to shared agents");
  });

  test("a refusal from the server is explained", async () => {
    await show("member", {
      "GET /api/office-agents": { body: response([agent({ status: "stopped" })]) },
      "POST /api/office-agents/a1/start": {
        status: 409,
        body: { error: "credential", message: "Claude Code is not connected in your runner" },
      },
    });
    await click(within(card("Hermes"), "Start") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("Claude Code is not connected in your runner");
  });
});
