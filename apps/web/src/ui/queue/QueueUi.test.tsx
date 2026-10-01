import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CommandRejected, FloorAccess, FloorState, QueueTask } from "@regulus/protocol";
import { QUEUE_RESULT_MESSAGE } from "@regulus/protocol";
import { act } from "react";
import { useFloorStore } from "../../state/floor.ts";
import { useFloorsStore } from "../../state/floors.ts";
import { useSessionStore } from "../../state/session.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { button, settle, submit, text } from "../auth/testDom.tsx";
import type { CredentialProfilesApi } from "../spawn/api.ts";
import { QueuePanel, type QueueSend } from "./QueuePanel.tsx";
import { type QueueClient, QueueTaskDialog } from "./QueueTaskDialog.tsx";
import { useQueueStore } from "./queueStore.ts";

useDom();

const task = (over: Partial<QueueTask>): QueueTask => ({
  id: "t1",
  position: 0,
  kind: "freeform",
  refNumber: 0,
  repoId: "r1",
  title: "Task",
  prompt: "do it",
  provider: "claude-code",
  model: "opus",
  effort: "medium",
  permissionMode: "",
  autoWorktree: true,
  state: "queued",
  agentId: "",
  prNumber: 0,
  reason: "",
  createdBy: "u-mia",
  ownerName: "Mia",
  createdAt: 1,
  startedAt: 0,
  finishedAt: 0,
  ...over,
});

const floorState = (queue: QueueTask[]): FloorState => ({
  floorId: "f1",
  name: "Apollo",
  slug: "apollo",
  paletteId: "oak-sky",
  layoutTemplateId: "office-l2",
  repos: [{ repoId: "r1", owner: "octo", name: "hello", defaultBranch: "main", isPrimary: true }],
  robots: {},
  desks: {},
  decor: {},
  queue,
  issues: {},
  pulls: {},
  services: {},
  whiteboardVersion: 0,
  carriedCards: {},
  queueSettings: { maxRunning: 1, maxPerOwner: 1 },
  deskCount: 1,
  decorStyle: "ops_room",
});

const as = (id: string, access: FloorAccess) => {
  useSessionStore.setState({
    status: "authenticated",
    user: { id, displayName: id, role: "member" },
    error: null,
  });
  useFloorsStore.setState({
    floors: [
      {
        floorId: "f1",
        name: "Apollo",
        slug: "apollo",
        index: 1,
        paletteId: "oak-sky",
        layoutTemplateId: "office-l2",
        archivedAt: null,
        access,
        repos: [],
      },
    ],
  });
};

const api: CredentialProfilesApi = {
  loginStatus: async () => ({ "claude-code": true }),
  list: async () => ({ ok: true, profiles: [] }),
};

let mounted: Mounted | null = null;
beforeEach(() => {
  useFloorStore.setState({
    floorId: "f1",
    state: floorState([
      task({ id: "a", title: "Mine first", position: 0 }),
      task({ id: "b", title: "Theirs", position: 1, createdBy: "u-otto", ownerName: "Otto" }),
      task({
        id: "c",
        title: "Broke",
        position: 2,
        state: "failed",
        reason: "the robot hit an error",
      }),
    ]),
  });
  useQueueStore.setState({ panelOpen: true, add: null });
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe("queue panel (#37)", () => {
  test("a member moves and cancels their own tasks and retries their failed one", async () => {
    as("u-mia", "spawn");
    const sent: [string, unknown][] = [];
    const send: QueueSend = (type, payload) => sent.push([type, payload]);
    mounted = await mount(<QueuePanel send={send} />);
    await settle();
    expect(text()).toContain("the robot hit an error");
    expect(button("Move “Theirs” up")).toBeUndefined();
    expect(document.querySelectorAll('[data-task="b"] button')).toHaveLength(0);
    const down = document.querySelector('[aria-label="Move “Mine first” down"]');
    if (!down) throw new Error("no move button");
    await click(down);
    const retry = button("Retry");
    if (!retry) throw new Error("no retry");
    await click(retry);
    expect(sent).toEqual([
      ["queue.reorder", { taskId: "a", position: 1 }],
      ["queue.retry", { taskId: "c" }],
    ]);
    expect(document.querySelector('form[aria-label="Queue settings"]')).toBeNull();
  });

  test("a room manager may reorder anyone's task and change the settings, not retry", async () => {
    as("u-max", "manage");
    const sent: [string, unknown][] = [];
    mounted = await mount(<QueuePanel send={(type, payload) => sent.push([type, payload])} />);
    await settle();
    expect(document.querySelector('[aria-label="Move “Theirs” up"]')).not.toBeNull();
    expect(button("Retry")).toBeUndefined();
    const save = button("Save");
    expect(save?.disabled).toBe(true);
    const running = document.querySelector<HTMLSelectElement>("form select");
    if (!running) throw new Error("no settings select");
    await act(async () => {
      running.value = "3";
      running.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await submit("Queue settings");
    expect(sent).toEqual([["queue.settings", { maxRunning: 3, maxPerOwner: 1 }]]);
  });

  test("a viewer sees the queue but gets no buttons", async () => {
    as("u-vic", "view");
    mounted = await mount(<QueuePanel send={() => {}} />);
    await settle();
    expect(text()).toContain("Mine first");
    expect(document.querySelectorAll(".rg-queue__task button")).toHaveLength(0);
    expect(button("Queue a task")).toBeUndefined();
  });
});

describe("queue a task dialog (#37)", () => {
  function fakeClient() {
    const sent: unknown[] = [];
    let rejected: ((n: CommandRejected) => void) | null = null;
    let result: ((p: unknown) => void) | null = null;
    const client: QueueClient = {
      send: (_t, payload) => sent.push(payload),
      onRejected: (l) => {
        rejected = l;
        return () => {};
      },
      onFloorMessage: (type, l) => {
        if (type === QUEUE_RESULT_MESSAGE) result = l;
        return () => {};
      },
    };
    return {
      client,
      sent,
      reject: (n: CommandRejected) => rejected?.(n),
      ok: () => result?.({ type: "queue.add", taskId: "t9" }),
    };
  }

  test("a freeform task needs a prompt", async () => {
    as("u-mia", "spawn");
    const c = fakeClient();
    mounted = await mount(<QueueTaskDialog api={api} client={c.client} />);
    await settle();
    await submit("Queue a task");
    expect(c.sent).toHaveLength(0);
    expect(text()).toContain("needs a prompt");
  });

  test("a card's task is queued as the human, then the panel opens", async () => {
    as("u-mia", "spawn");
    useQueueStore.setState({ panelOpen: false, add: {} });
    const c = fakeClient();
    mounted = await mount(
      <QueueTaskDialog
        api={api}
        client={c.client}
        prefill={{
          kind: "pr",
          refNumber: 9,
          repoId: "r1",
          taskTitle: "PR #9 Speed",
          prompt: "Pick it up",
        }}
      />,
    );
    await settle();
    expect(text()).toContain("PR #9");
    await submit("Queue a task");
    expect(c.sent).toEqual([
      expect.objectContaining({
        floorId: "f1",
        repoId: "r1",
        kind: "pr",
        refNumber: 9,
        title: "PR #9 Speed",
        prompt: "Pick it up",
        provider: "claude-code",
      }),
    ]);
    await act(async () => c.ok());
    expect(useQueueStore.getState()).toMatchObject({ panelOpen: true, add: null });
  });
});
