/**
 * Linked tasks in the browser (#257): the wording, the parts under a queue
 * task, the rooms a task may also go to, and creating and stopping one.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  CreateLinkedTaskRequest,
  LinkedTaskPart,
  LinkedTaskView,
  OperationAccess,
  OperationInfo,
  OperationState,
  QueueTask,
} from "@regulus/protocol";
import { useOperationStore } from "../../../state/operation.ts";
import { useOperationsStore } from "../../../state/operations.ts";
import { useSessionStore } from "../../../state/session.ts";
import { click, type Mounted, mount, useDom } from "../../a11y/dom.ts";
import { button, settle, submit, text } from "../../auth/testDom.tsx";
import { buildBoard } from "../../boards/columns.ts";
import type { CredentialProfilesApi } from "../../spawn/api.ts";
import { QueuePanel } from "../QueuePanel.tsx";
import { type QueueClient, QueueTaskDialog } from "../QueueTaskDialog.tsx";
import { useQueueStore } from "../queueStore.ts";
import type { LinkedTasksApi } from "./api.ts";
import { LinkedTaskBlock, PASS_ON_WARNING } from "./LinkedTaskBlock.tsx";
import {
  indexLinked,
  linkableRooms,
  linkedHeadline,
  linkedNameTag,
  linkedPullChips,
  linkedRequest,
} from "./linkedModel.ts";
import { queueSignature, refreshLinked, useLinkedStore } from "./linkedStore.ts";

useDom();

const part = (over: Partial<LinkedTaskPart>): LinkedTaskPart => ({
  taskId: "t-web",
  operationId: "web",
  roomName: "Web",
  repo: "octo/web",
  state: "running",
  reason: "",
  agentId: "a-web",
  henchmanName: "Boris",
  prNumber: 0,
  prUrl: "",
  prState: "none",
  prNote: "",
  ...over,
});

const view = (over: Partial<LinkedTaskView> = {}): LinkedTaskView => ({
  id: "L1",
  title: "Add orders",
  createdBy: "u-ada",
  ownerName: "Ada",
  parts: [
    part({}),
    part({
      taskId: "t-api",
      operationId: "api",
      roomName: "Api",
      repo: "octo/api",
      agentId: "a-api",
      henchmanName: "Olga",
      state: "done",
      prNumber: 12,
      prUrl: "https://github.com/octo/api/pull/12",
      prState: "draft",
    }),
  ],
  work: "working",
  pulls: "some_open",
  mayStop: true,
  ...over,
});

const room = (
  operationId: string,
  levelId: string,
  access: OperationAccess,
  over: Partial<OperationInfo> = {},
): OperationInfo => ({
  operationId,
  levelId,
  name: operationId[0]?.toUpperCase() + operationId.slice(1),
  slug: operationId,
  index: 1,
  paletteId: "oak-sky",
  layoutTemplateId: "t",
  archivedAt: null,
  access,
  repos: [
    {
      repoId: `r-${operationId}`,
      owner: "octo",
      name: operationId,
      url: `https://github.com/octo/${operationId}`,
      defaultBranch: "main",
      isPrimary: true,
      cloneStatus: "ready",
      cloneError: null,
      hasCredential: false,
    },
  ],
  ...over,
});

const ROOMS = [
  room("web", "octo", "spawn"),
  room("api", "octo", "manage"),
  room("docs", "octo", "view"),
  room("old", "octo", "spawn", { archivedAt: 1 }),
  room("far", "acme", "spawn"),
];

describe("linked task wording", () => {
  test("the headline counts the parts it was given and gives the combined state", () => {
    expect(linkedHeadline(view())).toBe("Across 2 rooms · at work · 1 of 2 pull requests open");
  });

  test("a henchman's name tag names the other rooms; an ordinary henchman keeps its name", () => {
    const { byAgent, byTask } = indexLinked([view()]);
    expect(linkedNameTag("Boris", "a-web", byAgent.get("a-web"))).toBe("Boris · with Api");
    expect(linkedNameTag("Olga", "a-api", byAgent.get("a-api"))).toBe("Olga · with Web");
    expect(linkedNameTag("Igor", "a-x", byAgent.get("a-x"))).toBe("Igor");
    expect(byTask.get("t-api")?.id).toBe("L1");
    expect(linkedNameTag("Boris", "a-web", byAgent.get("a-web")).length).toBeLessThanOrEqual(32);
  });

  test("a PR card of a part carries a chip; other cards do not", () => {
    const chips = linkedPullChips([view()], "api");
    expect(chips.get(12)).toBe("Linked: Web · 1 of 2 pull requests open");
    expect(linkedPullChips([view()], "web").size).toBe(0);
    const pull = {
      repoId: "r-api",
      number: 12,
      title: "Orders",
      state: "open",
      labels: [],
      assignees: [],
      author: "ada",
      url: "",
      updatedAt: 1,
      isDraft: true,
      checksState: "none" as const,
      reviewState: "none" as const,
      headRef: "office/x",
      baseRef: "main",
    };
    const board = buildBoard("pr", {
      issues: {},
      pulls: { a: pull, b: { ...pull, number: 13 } } as never,
      repos: [],
      linkedPulls: chips,
    });
    const cards = board.flatMap((c) => c.cards);
    expect(cards.find((c) => c.number === 12)?.linked).toContain("Linked: Web");
    expect(cards.find((c) => c.number === 13)?.linked).toBe("");
  });

  test("a task may also go to rooms on this level where the viewer may work", () => {
    expect(linkableRooms(ROOMS, "web").map((r) => r.operationId)).toEqual(["api"]);
    expect(linkableRooms(ROOMS, "far")).toEqual([]);
    expect(linkableRooms(ROOMS, null)).toEqual([]);
  });

  test("a linked request needs a prompt and takes no issue", () => {
    const spawn = {
      operationId: "web",
      provider: "claude-code" as const,
      model: "opus",
      prompt: "Go",
    };
    const also = { operationIds: ["api"], namePrivateRepos: false };
    expect(linkedRequest(spawn, also)).toEqual({
      ok: true,
      request: {
        operationIds: ["web", "api"],
        prompt: "Go",
        provider: "claude-code",
        model: "opus",
        namePrivateRepos: false,
      },
    });
    expect(linkedRequest({ ...spawn, prompt: " " }, also).ok).toBe(false);
    expect(linkedRequest({ ...spawn, issueNumber: 4 }, also).ok).toBe(false);
  });

  test("the queue signature changes with a task's state, henchman or PR", () => {
    const t = { id: "t", state: "queued", agentId: "", prNumber: 0 };
    const base = queueSignature([t]);
    expect(queueSignature([{ ...t }])).toBe(base);
    expect(queueSignature([{ ...t, state: "running" }])).not.toBe(base);
    expect(queueSignature([{ ...t, prNumber: 3 }])).not.toBe(base);
    expect(queueSignature(undefined)).toBe("");
  });
});

const task = (over: Partial<QueueTask>): QueueTask => ({
  id: "t-web",
  position: 0,
  kind: "freeform",
  refNumber: 0,
  repoId: "r-web",
  title: "Add orders",
  prompt: "Add orders",
  provider: "claude-code",
  model: "opus",
  effort: "",
  permissionMode: "",
  autoWorktree: true,
  state: "running",
  agentId: "a-web",
  prNumber: 0,
  reason: "",
  createdBy: "u-ada",
  ownerName: "Ada",
  createdAt: 1,
  startedAt: 1,
  finishedAt: 0,
  ...over,
});

const operationState = (queue: QueueTask[]): OperationState => ({
  operationId: "web",
  name: "Web",
  slug: "web",
  paletteId: "oak-sky",
  layoutTemplateId: "t",
  repos: [{ repoId: "r-web", owner: "octo", name: "web", defaultBranch: "main", isPrimary: true }],
  henchmen: {},
  desks: {},
  decor: {},
  queue,
  issues: {},
  pulls: {},
  services: {},
  whiteboardVersion: 0,
  carriedCards: {},
  queueSettings: { maxRunning: 2, maxPerOwner: 2 },
  deskCount: 1,
  decorStyle: "ops_room",
});

function fakeLinkedApi(tasks: LinkedTaskView[] = []) {
  const created: CreateLinkedTaskRequest[] = [];
  const stopped: string[] = [];
  const released: string[] = [];
  const auto: boolean[] = [];
  const api: LinkedTasksApi = {
    list: async () => ({ ok: true, data: { tasks } }),
    create: async (req) => {
      created.push(req);
      return { ok: true, data: { id: "L9", taskIds: ["x", "y"] } };
    },
    stop: async (id) => {
      stopped.push(id);
      return { ok: true, data: { id, stopped: 2, refused: 0 } };
    },
    releaseNote: async (id, noteId) => {
      released.push(noteId);
      return { ok: true, data: { id } };
    },
    setAutoNotes: async (id, on) => {
      auto.push(on);
      return { ok: true, data: { id } };
    },
  };
  return { api, created, stopped, released, auto };
}

let mounted: Mounted | null = null;
beforeEach(() => {
  useSessionStore.setState({
    status: "authenticated",
    user: { id: "u-ada", displayName: "Ada", role: "member" },
    error: null,
  });
  useOperationsStore.setState({ operations: ROOMS });
  useOperationStore.setState({
    operationId: "web",
    state: operationState([task({}), task({ id: "t-plain", title: "Plain", agentId: "" })]),
  });
  useQueueStore.setState({ panelOpen: true, add: null });
  useLinkedStore.getState().set("web", []);
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe("the queue panel with linked tasks", () => {
  test("a part shows its task's parts and state; an ordinary task shows nothing more", async () => {
    useLinkedStore.getState().set("web", [view()]);
    mounted = await mount(<QueuePanel send={() => {}} />);
    await settle();
    const block = document.querySelector('[data-task="t-web"] [data-linked="L1"]');
    expect(block?.textContent).toContain("Across 2 rooms");
    expect(block?.textContent).toContain("Web (this room)");
    expect(block?.textContent).toContain("octo/api");
    expect(block?.querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/octo/api/pull/12",
    );
    expect(document.querySelector('[data-task="t-plain"] [data-linked]')).toBeNull();
  });

  test("without a view (one visible part) the task looks like any other", async () => {
    mounted = await mount(<QueuePanel send={() => {}} />);
    await settle();
    expect(document.querySelector("[data-linked]")).toBeNull();
    expect(text()).not.toContain("Across");
    expect(button("Stop the whole task")).toBeUndefined();
  });

  test("only someone who may stop it gets the button", async () => {
    useLinkedStore.getState().set("web", [view({ mayStop: false })]);
    mounted = await mount(<QueuePanel send={() => {}} />);
    await settle();
    expect(button("Stop the whole task")).toBeUndefined();
  });
});

describe("the owner's notes (review 1)", () => {
  const note = { id: "n1", taskId: "t-api", body: "[api] POST /orders", createdAt: 1 };

  test("the owner reads the notes, is told who can read one passed on, and passes one on", async () => {
    const linked = fakeLinkedApi();
    const owned = view({ autoNotes: false, notes: [{ ...note, releasedAt: 0 }] });
    mounted = await mount(
      <LinkedTaskBlock view={owned} taskId="t-web" operationId="web" api={linked.api} />,
    );
    await settle();
    const row = document.querySelector('[data-note="n1"]');
    expect(row?.textContent).toContain("Api");
    expect(row?.textContent).toContain("[api] POST /orders");
    expect(text()).toContain(PASS_ON_WARNING);
    expect(PASS_ON_WARNING).toContain("people who cannot see the room it came from");
    const auto = document.querySelector<HTMLInputElement>(".rg-queue__linked-notes input");
    expect(auto?.checked).toBe(false);
    const pass = button("Pass on to the other parts");
    if (!pass) throw new Error("no pass-on button");
    await click(pass);
    await settle();
    expect(linked.released).toEqual(["n1"]);
    // The pressed button goes away: the focus stays in the panel, so Escape still closes it.
    expect(document.activeElement?.getAttribute("data-linked")).toBe("L1");
  });

  test("a note already passed on has no button", async () => {
    const owned = view({ autoNotes: true, notes: [{ ...note, releasedAt: 5 }] });
    mounted = await mount(
      <LinkedTaskBlock view={owned} taskId="t-web" operationId="web" api={fakeLinkedApi().api} />,
    );
    await settle();
    expect(button("Pass on to the other parts")).toBeUndefined();
    expect(document.querySelector('[data-note="n1"]')?.textContent).toContain("passed on");
  });

  test("someone who is not the owner is sent no notes and sees no notes section", async () => {
    mounted = await mount(
      <LinkedTaskBlock
        view={view({ mayStop: false })}
        taskId="t-web"
        operationId="web"
        api={fakeLinkedApi().api}
      />,
    );
    await settle();
    expect(document.querySelector(".rg-queue__linked-notes")).toBeNull();
    expect(text()).not.toContain("Notes for you");
  });
});

describe("refreshing", () => {
  test("another room's linked tasks never stay, and a slower answer for the old room is dropped", async () => {
    let release: (() => void) | undefined;
    const slow: LinkedTasksApi = {
      ...fakeLinkedApi().api,
      list: (operationId) =>
        new Promise((resolve) => {
          const answer = () =>
            resolve({ ok: true, data: { tasks: operationId === "web" ? [view()] : [] } });
          if (operationId === "web") release = answer;
          else answer();
        }),
    };
    const first = refreshLinked("web", slow);
    await refreshLinked("api", slow);
    release?.();
    await first;
    expect(useLinkedStore.getState().operationId).toBe("api");
    expect(useLinkedStore.getState().views).toEqual([]);
    await refreshLinked(null, slow);
    expect(useLinkedStore.getState().operationId).toBeNull();
  });

  test("a failed refresh for a new room leaves it empty", async () => {
    useLinkedStore.getState().set("web", [view()]);
    const failing: LinkedTasksApi = {
      ...fakeLinkedApi().api,
      list: async () => ({ ok: false, status: 0, code: "network_error" }),
    };
    await refreshLinked("api", failing);
    expect(useLinkedStore.getState().views).toEqual([]);
  });
});

describe("queueing a task across rooms", () => {
  const profiles: CredentialProfilesApi = {
    loginStatus: async () => ({ "claude-code": true }),
    list: async () => ({ ok: true, profiles: [] }),
  };
  const client = () => {
    const sent: unknown[] = [];
    const c: QueueClient = {
      send: (_t, payload) => sent.push(payload),
      onRejected: () => () => {},
      onOperationMessage: () => () => {},
    };
    return { c, sent };
  };

  test("offers only rooms on this level where the viewer may work; none for a card", async () => {
    const { c } = client();
    mounted = await mount(
      <QueueTaskDialog api={profiles} client={c} linkedApi={fakeLinkedApi().api} />,
    );
    await settle();
    const labels = [...document.querySelectorAll(".rg-queue__also-rooms label")].map((l) =>
      l.textContent?.trim(),
    );
    expect(labels).toEqual(["Api octo/api"]);
    await mounted.unmount();
    mounted = await mount(
      <QueueTaskDialog
        api={profiles}
        client={c}
        linkedApi={fakeLinkedApi().api}
        prefill={{ kind: "issue", refNumber: 4, repoId: "r-web" }}
      />,
    );
    await settle();
    expect(document.querySelector(".rg-queue__also")).toBeNull();
  });

  test("ticking a room sends one linked task over both rooms instead of a queue task", async () => {
    const { c, sent } = client();
    const linked = fakeLinkedApi();
    useQueueStore.setState({ panelOpen: false, add: {} });
    mounted = await mount(
      <QueueTaskDialog
        api={profiles}
        client={c}
        linkedApi={linked.api}
        prefill={{ kind: "freeform", prompt: "Add orders to both" }}
      />,
    );
    await settle();
    const box = document.querySelector('.rg-queue__also-rooms input[type="checkbox"]');
    if (!box) throw new Error("no room to tick");
    await click(box);
    // Review 7: naming private repos is offered, and off unless ticked.
    expect(text()).toContain("Also name private repos");
    const naming = [...document.querySelectorAll<HTMLInputElement>(".rg-queue__also-link input")];
    expect(naming.map((i) => i.checked)).toEqual([false]);
    await submit("Queue a task");
    await settle();
    expect(sent).toEqual([]);
    expect(linked.created).toEqual([
      expect.objectContaining({
        operationIds: ["web", "api"],
        prompt: "Add orders to both",
        provider: "claude-code",
        namePrivateRepos: false,
      }),
    ]);
    expect(useQueueStore.getState()).toMatchObject({ panelOpen: true, add: null });
  });

  test("with no room ticked the task is queued in this room as before", async () => {
    const { c, sent } = client();
    const linked = fakeLinkedApi();
    mounted = await mount(
      <QueueTaskDialog
        api={profiles}
        client={c}
        linkedApi={linked.api}
        prefill={{ kind: "freeform", prompt: "Just here" }}
      />,
    );
    await settle();
    await submit("Queue a task");
    expect(linked.created).toEqual([]);
    expect(sent).toEqual([expect.objectContaining({ operationId: "web", kind: "freeform" })]);
  });
});
