/** Settings → Agents and the chat window for board helpers (#56): placing one, its card, its brief. */
import { afterEach, describe, expect, test } from "bun:test";
import type { KioskBrief as Brief, OfficeAgentBody, TaskProposal } from "@regulus/protocol";
import { buildingFixture } from "@regulus/protocol/src/fixtures.ts";
import { useBuildingStore } from "../../state/building.ts";
import { bodyCaption, bodyScale, isBoardHelper } from "../../state/officeAgents.ts";
import { click, mount, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { button, settle, submit, text, typeInto } from "../auth/testDom.tsx";
import { createOfficeAgentsApi } from "./api.ts";
import { KioskBrief } from "./KioskBrief.tsx";
import { KioskProposals } from "./KioskProposals.tsx";
import { agent, card, choose, cleanup, mounted, response, select, show } from "./testKit.tsx";

useDom();
afterEach(async () => {
  await cleanup();
  useBuildingStore.getState().clear();
});

const lobby = buildingFixture.operations.lobby;
if (!lobby) throw new Error("the fixture has no lobby");
/** The viewer's state: the lobby and the two rooms their GitHub access opens. */
const withRooms = () =>
  useBuildingStore.getState().apply({
    ...buildingFixture,
    operations: {
      lobby,
      apollo: { ...lobby, operationId: "op-apollo", name: "Apollo", slug: "apollo", index: 1 },
      borealis: { ...lobby, operationId: "op-bor", name: "Borealis", slug: "borealis", index: 2 },
    },
  });

const HELPER = agent({
  id: "k1",
  name: "Apollo issues",
  owner: { kind: "office" },
  role: "kiosk",
  appearance: "lab_coat",
  runsOn: { kind: "anthropic", officeKey: true },
  kiosk: {
    operationId: "op-apollo",
    operationName: "Apollo",
    board: "issues",
    viaPm: true,
    runsLikePm: true,
  },
  config: {
    instructions: "",
    profileId: "o-an",
    grants: [{ operationId: "op-apollo", access: "spawn" }],
    tokens: [],
  },
});

const options = (el: HTMLSelectElement) => Array.from(el.options).map((o) => o.textContent);

describe("placing a board helper", () => {
  test("an owner places one: a room they see, a board, the office's key, the helper's coat", async () => {
    withRooms();
    const f = await show("owner", {
      "GET /api/office-agents": { body: response([]) },
      "POST /api/office-agents": { status: 201, body: HELPER },
    });
    await click(button("New agent…") as HTMLButtonElement);
    await settle();
    // A personal agent is never a board helper: the job is not offered until it belongs to the office.
    expect(options(select("Job"))).not.toContain("Board helper");
    await choose(select("Belongs to"), "office");
    expect(options(select("Job"))).toContain("Board helper");
    expect(document.querySelector('[data-testid="kiosk-fields"]')).toBeNull();
    await choose(select("Job"), "kiosk");
    expect(text()).toContain("It can do nothing else.");
    // The rooms this person sees, never the lobby.
    expect(options(select("Room"))).toEqual(["Apollo", "Borealis"]);
    expect(options(select("Board"))).toEqual(["Issue board", "Pull request board", "Task queue"]);
    await choose(select("Room"), "op-bor");
    await choose(select("Board"), "queue");
    await typeInto("Name", "Borealis queue");
    await submit("New agent");
    expect(f.calls.find((c) => c.method === "POST")?.body).toMatchObject({
      name: "Borealis queue",
      owner: "office",
      engine: "cli-session",
      role: "kiosk",
      appearance: "lab_coat",
      profileId: "o-an",
      kiosk: { operationId: "op-bor", board: "queue", viaPm: true },
    });
  });

  test("back to a personal agent, the job and the placement go", async () => {
    withRooms();
    const f = await show("owner", {
      "GET /api/office-agents": { body: response([]) },
      "POST /api/office-agents": { status: 201, body: agent({ name: "Notes" }) },
    });
    await click(button("New agent…") as HTMLButtonElement);
    await settle();
    await choose(select("Belongs to"), "office");
    await choose(select("Job"), "kiosk");
    await choose(select("Belongs to"), "me");
    expect(select("Job").value).toBe("assistant");
    expect(document.querySelector('[data-testid="kiosk-fields"]')).toBeNull();
    await typeInto("Name", "Notes");
    await submit("New agent");
    const sent = f.calls.find((c) => c.method === "POST")?.body;
    expect(sent).toMatchObject({ owner: "me", role: "assistant" });
    expect(sent).not.toHaveProperty("kiosk");
  });

  test("someone who sees no room is told why they cannot place one", async () => {
    useBuildingStore.getState().apply({ ...buildingFixture, operations: { lobby } });
    const f = await show("owner", { "GET /api/office-agents": { body: response([]) } });
    await click(button("New agent…") as HTMLButtonElement);
    await settle();
    await choose(select("Belongs to"), "office");
    await choose(select("Job"), "kiosk");
    expect(document.querySelector('[data-testid="kiosk-no-rooms"]')?.textContent).toContain(
      "you can see no room",
    );
    expect((button("Create agent") as HTMLButtonElement).disabled).toBe(true);
    expect(f.calls.some((c) => c.method === "POST")).toBe(false);
  });

  test("its card says where it stands; its job cannot be changed and it works in its own room only", async () => {
    withRooms();
    await show("owner", { "GET /api/office-agents": { body: response([HELPER]) } });
    const el = card("Apollo issues");
    expect(el.querySelector('[data-testid="agent-kiosk"]')?.textContent).toBe(
      "Stands at: Issue board, Apollo (runs like the project manager)",
    );
    // Only its own room is offered under "Operations it may work in".
    const grants = el.querySelector(".rg-office-agent__grants");
    expect(grants?.textContent).toContain("Apollo");
    expect(grants?.textContent).not.toContain("Borealis");
    await click(
      Array.from(el.querySelectorAll("button")).find(
        (b) => b.textContent === "Change…",
      ) as HTMLButtonElement,
    );
    await settle();
    expect(options(select("Job"))).toEqual(["Board helper"]);
    expect(text()).toContain("A board helper's job and room are for life");
  });

  test("no other agent can be turned into a board helper", async () => {
    withRooms();
    await show("owner", {
      "GET /api/office-agents": {
        body: response([agent({ id: "a2", name: "Number Two", owner: { kind: "office" } })]),
      },
    });
    const el = card("Number Two");
    await click(
      Array.from(el.querySelectorAll("button")).find(
        (b) => b.textContent === "Change…",
      ) as HTMLButtonElement,
    );
    await settle();
    expect(options(select("Job"))).not.toContain("Board helper");
  });
});

describe("the brief in the chat window", () => {
  const BRIEF: Brief = {
    agentId: "k1",
    operationId: "op-apollo",
    operationName: "Apollo",
    board: "issues",
    headline: "2 open issues.",
    lines: [
      "0 issues have a henchman on them; 2 have nobody assigned.",
      "#7 Login loops (2 h ago)",
    ],
    canEnqueue: true,
    generatedAt: 1,
  };
  const showBrief = async (routes: Parameters<typeof fakeFetch>[0]) => {
    const f = fakeFetch(routes);
    mounted.push(
      await mount(<KioskBrief api={createOfficeAgentsApi({ fetch: f.fetch })} agentId="k1" />),
    );
    await settle();
    return f;
  };

  test("the board in a headline and a few lines, and that it can queue for you", async () => {
    const f = await showBrief({ "GET /api/office-agents/k1/brief": { body: BRIEF } });
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/office-agents/k1/brief",
    ]);
    const el = document.querySelector('[data-testid="kiosk-brief"]');
    expect(el?.getAttribute("aria-label")).toBe("Issue board of Apollo");
    expect(el?.querySelector("strong")?.textContent).toBe("2 open issues.");
    expect(Array.from(el?.querySelectorAll("li") ?? []).map((li) => li.textContent)).toEqual(
      BRIEF.lines,
    );
    expect(text()).toContain("nothing is queued until you confirm");
  });

  test("someone who may only look is told it cannot queue for them", async () => {
    await showBrief({
      "GET /api/office-agents/k1/brief": { body: { ...BRIEF, canEnqueue: false } },
    });
    expect(text()).toContain("it cannot queue work for you here");
  });

  test("a board that cannot be read says so, and shows nothing of it", async () => {
    await showBrief({
      "GET /api/office-agents/k1/brief": { status: 404, body: { error: "not_found" } },
    });
    expect(document.querySelector('[data-testid="kiosk-brief"]')).toBeNull();
    expect(text()).toContain("The board cannot be read right now.");
  });
});

describe("a board helper's body", () => {
  const body = (post: OfficeAgentBody["post"]) => ({ ownerUserId: "", ownerName: "", post });

  test("is a small henchman called a board helper; every other body is as it was", () => {
    for (const post of ["issue_board", "pr_board", "queue_clipboard"] as const) {
      expect(isBoardHelper(body(post))).toBe(true);
      expect(bodyScale(body(post))).toBeLessThan(1);
      expect(bodyCaption(body(post), null)).toBe("Board helper");
    }
    for (const post of ["none", "reception"] as const) {
      expect(isBoardHelper(body(post))).toBe(false);
      expect(bodyScale(body(post))).toBe(1);
      expect(bodyCaption(body(post), null)).toBe("Office agent");
    }
  });
});

describe("what a helper proposes to queue", () => {
  const NOW = 1_800_000_000_000;
  const PROPOSAL: TaskProposal = {
    id: "p1",
    agentId: "k1",
    agentName: "Apollo issues",
    operationName: "Apollo",
    repo: "octo/hello",
    cardTitle: "Login loops",
    task: {
      operationId: "op-apollo",
      repoId: "r1",
      kind: "issue",
      refNumber: 7,
      prompt: "Fix the login loop.\nAdd a test.",
      provider: "claude-code",
      model: "sonnet",
    },
    status: "pending",
    createdAt: NOW,
    expiresAt: NOW + 12 * 60_000 + 5_000,
  };
  const showProposals = async (routes: Parameters<typeof fakeFetch>[0]) => {
    const f = fakeFetch(routes);
    mounted.push(
      await mount(
        <KioskProposals
          api={createOfficeAgentsApi({ fetch: f.fetch })}
          agentId="k1"
          pollMs={3_600_000}
          now={() => NOW}
        />,
      ),
    );
    await settle();
    return f;
  };
  const posts = (f: { calls: Array<{ method: string; path: string }> }) =>
    f.calls.filter((c) => c.method === "POST").map((c) => c.path);

  test("the whole task is shown, word for word, and nothing is sent until Confirm", async () => {
    let open = [PROPOSAL];
    const f = await showProposals({
      "GET /api/office-agents/k1/proposals": () => ({ body: { proposals: open } }),
      "POST /api/office-agents/k1/proposals/p1/confirm": () => {
        open = [];
        return { body: { taskId: "t1" } };
      },
    });
    const el = document.querySelector('[data-testid="kiosk-proposal"]');
    expect(el?.textContent).toContain("Nothing is queued yet.");
    expect(el?.textContent).toContain("Work on issue #7 Login loops");
    expect(el?.textContent).toContain("Apollo (octo/hello)");
    expect(el?.textContent).toContain(
      "claude-code, model sonnet, on the office's key, as your henchman",
    );
    expect(el?.querySelector("pre")?.textContent).toBe("Fix the login loop.\nAdd a test.");
    expect(el?.textContent).toContain("Expires in 12 min.");
    expect(posts(f)).toEqual([]);

    await click(button("Confirm and queue") as HTMLButtonElement);
    await settle();
    expect(posts(f)).toEqual(["/api/office-agents/k1/proposals/p1/confirm"]);
    expect(document.querySelector('[data-testid="kiosk-proposal"]')).toBeNull();
    expect(text()).toContain("Queued. It is on the room's task queue as yours.");
  });

  test("an issue task without a prompt says the office's own instructions are used", async () => {
    await showProposals({
      "GET /api/office-agents/k1/proposals": {
        body: { proposals: [{ ...PROPOSAL, task: { ...PROPOSAL.task, prompt: undefined } }] },
      },
    });
    expect(document.querySelector("pre")).toBeNull();
    expect(text()).toContain("the office's standard instructions for this issue");
  });

  test("Do not queue drops it; a refusal is said in words", async () => {
    let open = [PROPOSAL];
    const f = await showProposals({
      "GET /api/office-agents/k1/proposals": () => ({ body: { proposals: open } }),
      "POST /api/office-agents/k1/proposals/p1/confirm": {
        status: 410,
        body: { error: "proposal_expired" },
      },
      "POST /api/office-agents/k1/proposals/p1/dismiss": () => {
        open = [];
        return { status: 204 };
      },
    });
    await click(button("Confirm and queue") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("That proposal is too old. Ask the helper again.");
    await click(button("Do not queue") as HTMLButtonElement);
    await settle();
    expect(posts(f)).toEqual([
      "/api/office-agents/k1/proposals/p1/confirm",
      "/api/office-agents/k1/proposals/p1/dismiss",
    ]);
    expect(document.querySelector('[data-testid="kiosk-proposal"]')).toBeNull();
    expect(text()).not.toContain("Queued.");
  });
});
