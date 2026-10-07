/** Settings → Agents (#271): the list, who gets which controls, creating, the one-time token, chat and questions. */
import { afterEach, describe, expect, test } from "bun:test";
import type {
  HumanRequest,
  OfficeAgentConversation,
  OfficeAgentsResponse,
  OfficeAgentView,
  UserRole,
} from "@regulus/protocol";
import { act } from "react";
import { useSessionStore } from "../../state/session.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { button, settle, submit, text, typeInto } from "../auth/testDom.tsx";
import { createOfficeAgentsApi } from "./api.ts";
import { ago } from "./labels.ts";
import { OfficeAgentsSection } from "./OfficeAgentsSection.tsx";

useDom();

const NOW = 1_800_000_000_000;
const agent = (over: Partial<OfficeAgentView>): OfficeAgentView => ({
  id: "a1",
  name: "Hermes",
  owner: { kind: "user", userId: "u1", displayName: "Ante" },
  engine: "cli-session",
  role: "pm",
  preset: "coordinator",
  provider: "claude-code",
  model: "sonnet",
  status: "ready",
  lastActivityAt: NOW - 5 * 60_000,
  createdAt: NOW - 86_400_000,
  canTalk: true,
  canConfigure: true,
  config: { instructions: "", grants: [], tokens: [] },
  ...over,
});
const SHARED = agent({
  id: "a2",
  name: "Number Two",
  owner: { kind: "office" },
  status: "stopped",
  canConfigure: false,
  config: undefined,
});
const SOMEONES = agent({
  id: "a3",
  name: "Mias helper",
  owner: { kind: "user", userId: "u9", displayName: "Mia" },
  canTalk: false,
  canConfigure: false,
  config: undefined,
});
const response = (agents: OfficeAgentView[]): OfficeAgentsResponse => ({
  agents,
  settings: { personalAgentCap: 3, managerDailySpawnCap: 10, sharedMessagesPerHour: 20 },
  engines: ["cli-session"],
});
const QUESTION: HumanRequest = {
  id: "r1",
  agentId: "a1",
  agentName: "Hermes",
  forUserId: "u1",
  question: "Ship on Friday?",
  options: ["Yes", "No"],
  status: "pending",
  createdAt: NOW,
};

const mounted: Mounted[] = [];
afterEach(async () => {
  for (const m of mounted.splice(0)) await m.unmount();
  await settle();
  useSessionStore.setState({ status: "unknown", user: null, error: null });
});

async function show(role: UserRole, routes: Parameters<typeof fakeFetch>[0]) {
  useSessionStore.setState({
    status: "authenticated",
    user: { id: "u1", displayName: "Ante", role },
    error: null,
  });
  const f = fakeFetch({
    "GET /api/office-agents/requests": { body: { requests: [] } },
    "GET /api/credential-profiles": { body: { profiles: [] } },
    ...routes,
  });
  mounted.push(
    await mount(
      <OfficeAgentsSection api={createOfficeAgentsApi({ fetch: f.fetch })} now={() => NOW} />,
    ),
  );
  await settle();
  return f;
}

const card = (name: string) => {
  const el = document.querySelector<HTMLElement>(`article[aria-label=${JSON.stringify(name)}]`);
  if (!el) throw new Error(`no card ${name}`);
  return el;
};
const within = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);

describe("office agents section", () => {
  test("lists engine, status, last activity and privileges; controls follow what the viewer may do", async () => {
    await show("admin", {
      "GET /api/office-agents": { body: response([agent({}), SHARED, SOMEONES]) },
    });
    const mine = card("Hermes");
    expect(mine.textContent).toContain("Ready");
    expect(mine.textContent).toContain("Claude Code session");
    expect(mine.textContent).toContain("Coordinator");
    expect(mine.textContent).toContain("Last active 5 min ago");
    expect(within(mine, "Chat")).toBeDefined();
    expect(within(mine, "Stop")).toBeDefined();
    // A shared agent this viewer cannot configure: chat only.
    const shared = card("Number Two");
    expect(shared.textContent).toContain("Shared");
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

  test("a member creates a personal agent; the owner choice is for admins only", async () => {
    const f = await show("member", {
      "GET /api/office-agents": { body: response([]) },
      "POST /api/office-agents": { status: 201, body: agent({ name: "Notes" }) },
    });
    expect(text()).toContain("No agents yet.");
    await click(button("New agent…") as HTMLButtonElement);
    expect(document.querySelector("label[for]")?.textContent).toBe("Name");
    expect(text()).not.toContain("Belongs to");
    // An empty name sends nothing.
    await submit("New agent");
    expect(f.calls.some((c) => c.method === "POST")).toBe(false);
    await typeInto("Name", "Notes");
    await submit("New agent");
    expect(f.calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "Notes",
      owner: "me",
      engine: "cli-session",
      role: "assistant",
      preset: "coordinator",
      provider: "claude-code",
      model: "sonnet",
      instructions: "",
    });
  });

  test("a shared agent cannot be created without an office key, and says why", async () => {
    await show("owner", { "GET /api/office-agents": { body: response([]) } });
    await click(button("New agent…") as HTMLButtonElement);
    const owner = Array.from(document.querySelectorAll("select")).find((s) =>
      Array.from(s.options).some((o) => o.value === "office"),
    ) as HTMLSelectElement;
    await act(async () => {
      owner.value = "office";
      owner.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(text()).toContain("never on anyone's subscription login");
    expect((button("Create agent") as HTMLButtonElement).disabled).toBe(true);
  });

  test("a new token is shown once and is gone after the next change", async () => {
    const f = await show("member", {
      "GET /api/office-agents": { body: response([agent({})]) },
      "POST /api/office-agents/a1/tokens": {
        status: 201,
        body: { id: "t1", label: "External engine", token: "roa_SHOWN-ONCE" },
      },
      "POST /api/office-agents/a1/stop": { body: agent({ status: "stopped" }) },
    });
    await click(within(card("Hermes"), "Create a token") as HTMLButtonElement);
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
