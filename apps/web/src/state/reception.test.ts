/** Asking for the office PM at the reception desk (#60). */
import { beforeEach, describe, expect, test } from "bun:test";
import type { OfficeAgentBody, OfficeAgentView } from "@regulus/protocol";
import type { ToastInput } from "../ui/toast/toastQueue.ts";
import { useAgentChatWindow, type Viewer } from "./officeAgents.ts";
import {
  askAtReception,
  atReception,
  bodyOfView,
  officePmOf,
  RECEPTION_EMPTY,
  RECEPTION_VIEWER,
  receptionBody,
} from "./reception.ts";

const body = (over: Partial<OfficeAgentBody>): OfficeAgentBody => ({
  agentId: "pm",
  name: "Ledger",
  ownerUserId: "",
  ownerName: "",
  appearance: "number_two",
  status: "ready",
  levelId: "lobby",
  operationId: "lobby",
  mode: "post",
  target: { x: 60, z: 118, heading: 0 },
  hop: 1,
  doing: "at reception",
  dismissed: false,
  post: "reception",
  ...over,
});
const view = (over: Partial<OfficeAgentView>): OfficeAgentView => ({
  id: "pm",
  name: "Ledger",
  owner: { kind: "office" },
  engine: "cli-session",
  role: "pm",
  preset: "coordinator",
  provider: "claude-code",
  model: "sonnet",
  runsOn: { kind: "key", officeKey: true },
  appearance: "number_two",
  dismissed: false,
  status: "stopped",
  createdAt: 1,
  canTalk: true,
  canConfigure: false,
  ...over,
});
const MEMBER: Viewer = { id: "mia", role: "member" };
const VIEWER: Viewer = { id: "vic", role: "viewer" };
const WANDERER = body({ agentId: "w", name: "Tally", mode: "wander", post: "none" });
const COMPANION = body({
  agentId: "c",
  name: "Docket",
  ownerUserId: "mia",
  ownerName: "Mia",
  mode: "follow",
  post: "none",
});

function ask(
  bodies: OfficeAgentBody[],
  viewer: Viewer | null,
  listed: readonly OfficeAgentView[] | null = [],
) {
  const toasts: ToastInput[] = [];
  let asked = 0;
  const result = askAtReception({
    state: { officeAgents: Object.fromEntries(bodies.map((b) => [b.agentId, b])) },
    viewer,
    agents: async () => {
      asked += 1;
      return listed;
    },
    toast: (input) => toasts.push(input),
  });
  return { result, toasts, asked: () => asked };
}

beforeEach(() => useAgentChatWindow.getState().close());

describe("who is at reception", () => {
  test("the office PM is the body with the reception post, wherever it is", () => {
    expect(receptionBody(null)).toBeNull();
    expect(receptionBody({ officeAgents: { w: WANDERER, c: COMPANION } })).toBeNull();
    const away = body({ mode: "route", operationId: "op-apollo", levelId: "level-acme" });
    expect(receptionBody({ officeAgents: { w: WANDERER, pm: away } })?.agentId).toBe("pm");
    expect(atReception(body({}))).toBe(true);
    expect(atReception(away)).toBe(false);
    expect(atReception(null)).toBe(false);
  });

  test("in the agent list it is the office's project manager, never a personal one", () => {
    const personal = view({ id: "p", owner: { kind: "user", userId: "mia", displayName: "Mia" } });
    const custom = view({ id: "x", role: "custom" });
    expect(officePmOf([personal, custom])).toBeNull();
    expect(officePmOf([personal, custom, view({})])?.id).toBe("pm");
  });
});

describe("pressing E at the desk", () => {
  test("opens the PM's chat when it is behind the counter", async () => {
    const a = ask([WANDERER, COMPANION, body({})], MEMBER);
    expect(await a.result).toBe("opened");
    expect(useAgentChatWindow.getState()).toMatchObject({ agentId: "pm", known: null });
    expect(a.toasts).toEqual([]);
    // The body said who it is: the office was not asked.
    expect(a.asked()).toBe(0);
  });

  test("opens it while the PM is on its round in sight too", async () => {
    const a = ask([body({ mode: "route", operationId: "op-apollo" })], MEMBER);
    expect(await a.result).toBe("opened");
    expect(useAgentChatWindow.getState().agentId).toBe("pm");
  });

  test("its round has it in a room closed to this viewer: the office says who it is", async () => {
    const a = ask([WANDERER], MEMBER, [view({ id: "x", role: "custom" }), view({})]);
    expect(await a.result).toBe("opened");
    expect(a.asked()).toBe(1);
    const { agentId, known } = useAgentChatWindow.getState();
    expect(agentId).toBe("pm");
    // Enough for the window, and nothing about where it is.
    expect(known).toMatchObject({
      agentId: "pm",
      name: "Ledger",
      ownerUserId: "",
      post: "reception",
    });
    expect(known).toEqual(bodyOfView(view({})));
    expect(a.toasts).toEqual([]);
  });

  test("with no office PM the desk says so and opens nothing", async () => {
    const a = ask([WANDERER, COMPANION], MEMBER, [view({ id: "x", role: "custom" })]);
    expect(await a.result).toBe("nobody");
    expect(useAgentChatWindow.getState().agentId).toBeNull();
    expect(a.toasts.map((t) => t.message)).toEqual([RECEPTION_EMPTY]);
  });

  test("a viewer is told they cannot talk to it, in sight or not", async () => {
    const seen = ask([body({})], VIEWER);
    expect(await seen.result).toBe("not_allowed");
    const unseen = ask([], VIEWER, [view({ canTalk: false })]);
    expect(await unseen.result).toBe("not_allowed");
    expect(useAgentChatWindow.getState().agentId).toBeNull();
    for (const a of [seen, unseen])
      expect(a.toasts.map((t) => t.message)).toEqual([RECEPTION_VIEWER]);
    expect(await ask([body({})], null).result).toBe("not_allowed");
  });

  test("the office cannot be reached: nothing opens", async () => {
    const a = ask([], MEMBER, null);
    expect(await a.result).toBe("failed");
    expect(useAgentChatWindow.getState().agentId).toBeNull();
    expect(a.toasts).toHaveLength(1);
  });
});
