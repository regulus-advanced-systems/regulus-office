/**
 * Meeting room UI (#50): watching a meeting (everyone), its controls (the
 * starter; an admin gets only the emergency stop), the start dialog, and the
 * live sync from `meeting.changed`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  MEETING_CHANGED_MESSAGE,
  type MeetingDetail,
  type MeetingSummary,
  type OperationState,
  type StartMeetingRequest,
} from "@regulus/protocol";
import { act } from "react";
import { useOperationStore } from "../../state/operation.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import type { CredentialProfilesApi } from "../spawn/api.ts";
import type { MeetingsApi } from "./api.ts";
import { MeetingPanel } from "./MeetingPanel.tsx";
import { MeetingStartDialog } from "./MeetingStartDialog.tsx";
import { useMeetingStore } from "./meetingStore.ts";
import { syncMeetings } from "./meetingSync.ts";

useDom();

const summary = (over: Partial<MeetingSummary> = {}): MeetingSummary => ({
  id: "m1",
  operationId: "f1",
  repoId: "r1",
  pattern: "debate",
  title: "Pick a cache",
  status: "running",
  reason: "",
  startedBy: "u-mia",
  starterName: "Mia",
  round: 1,
  rounds: 2,
  step: 1,
  steps: 5,
  tokensUsed: 120_000,
  tokenBudget: 1_000_000,
  output: "pull_request",
  prNumber: 0,
  branch: "office/meeting-pick-a-cache",
  outputUrl: "",
  members: [
    {
      position: 0,
      role: "proposer",
      name: "Proposer",
      agentId: "a1",
      seatId: "d1s1",
      provider: "claude-code",
      model: "opus",
      status: "idle",
    },
    {
      position: 1,
      role: "challenger",
      name: "Challenger",
      agentId: "a2",
      seatId: "d1s2",
      provider: "codex",
      model: "gpt-6-sol",
      status: "working",
    },
    {
      position: 2,
      role: "judge",
      name: "Judge",
      agentId: "a3",
      seatId: "d1s3",
      provider: "claude-code",
      model: "sonnet",
      status: "idle",
    },
  ],
  speaking: [1],
  createdAt: 1,
  updatedAt: 2,
  finishedAt: 0,
  ...over,
});

const detail = (over: Partial<MeetingDetail> = {}): MeetingDetail => ({
  ...summary(),
  topic: "Pick a cache for the board sync",
  turns: [
    {
      step: 0,
      round: 1,
      position: 0,
      kind: "open",
      status: "done",
      text: "Use an LRU cache.",
      tokens: 60_000,
      startedAt: 1,
      finishedAt: 2,
    },
    {
      step: 1,
      round: 1,
      position: 1,
      kind: "open",
      status: "running",
      text: "",
      tokens: 0,
      startedAt: 2,
      finishedAt: 0,
    },
  ],
  canControl: false,
  canEmergencyStop: false,
  ...over,
});

function fakeApi(d: MeetingDetail) {
  const calls: unknown[][] = [];
  const api: MeetingsApi = {
    list: async () => ({ ok: true, data: { meetings: [summary()], canStart: true } }),
    active: async () => ({ ok: true, data: { meetings: [summary()] } }),
    detail: async () => ({ ok: true, data: d }),
    start: async (req: StartMeetingRequest) => {
      calls.push(["start", req]);
      return { ok: true, data: summary({ id: "m2", status: "starting" }) };
    },
    act: async (id, action) => {
      calls.push(["act", id, action]);
      return { ok: true, data: summary({ status: action === "pause" ? "paused" : "stopped" }) };
    },
  };
  return { api, calls };
}

const operationState = (): OperationState =>
  ({
    operationId: "f1",
    name: "Apollo",
    slug: "apollo",
    paletteId: "oak-sky",
    layoutTemplateId: "t",
    repos: [{ repoId: "r1", owner: "octo", name: "hello", defaultBranch: "main", isPrimary: true }],
    henchmen: {},
    desks: { d1s1: { seatId: "d1s1", agentId: "" }, d1s2: { seatId: "d1s2", agentId: "" } },
    decor: {},
    queue: [],
    issues: {},
    pulls: {},
    services: {},
    whiteboardVersion: 0,
    carriedCards: {},
    queueSettings: { maxRunning: 1, maxPerOwner: 1 },
    deskCount: 1,
    decorStyle: "ops_room",
  }) as OperationState;

let mounted: Mounted | null = null;
beforeEach(() => {
  useOperationStore.setState({ operationId: "f1", state: operationState() });
  useMeetingStore.setState({
    active: { m1: summary() },
    list: null,
    panel: { meetingId: "m1" },
    starting: false,
    detail: null,
  });
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe("meeting panel (#50)", () => {
  test("a watcher sees who has the floor and the transcript, and no controls", async () => {
    const { api, calls } = fakeApi(detail());
    useMeetingStore.setState({ detail: detail() });
    mounted = await mount(<MeetingPanel api={api} />);
    await settle();
    expect(text()).toContain("In session");
    expect(text()).toContain("round 1 of 2");
    expect(text()).toContain("has the floor");
    expect(text()).toContain("Use an LRU cache.");
    expect(text()).toContain("120k of 1M tokens");
    expect(button("Pause")).toBeUndefined();
    expect(button("Stop meeting")).toBeUndefined();
    expect(button("Emergency stop")).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("the starter pauses and stops", async () => {
    const d = detail({ canControl: true });
    const { api, calls } = fakeApi(d);
    useMeetingStore.setState({ detail: d });
    mounted = await mount(<MeetingPanel api={api} />);
    await settle();
    const pause = button("Pause");
    if (!pause) throw new Error("no pause");
    await click(pause);
    await settle();
    expect(calls).toEqual([["act", "m1", "pause"]]);
    expect(useMeetingStore.getState().active.m1?.status).toBe("paused");
    expect(button("Resume")).toBeDefined();
  });

  test("an office admin who did not call it only gets the emergency stop", async () => {
    const d = detail({ canEmergencyStop: true });
    const { api, calls } = fakeApi(d);
    useMeetingStore.setState({ detail: d });
    mounted = await mount(<MeetingPanel api={api} />);
    await settle();
    expect(button("Pause")).toBeUndefined();
    const stop = button("Emergency stop");
    if (!stop) throw new Error("no emergency stop");
    await click(stop);
    await settle();
    expect(calls).toEqual([["act", "m1", "stop"]]);
  });
});

describe("start dialog (#50)", () => {
  test("needs a task, then starts as the caller and opens the meeting", async () => {
    const { api, calls } = fakeApi(detail());
    const profiles: CredentialProfilesApi = {
      loginStatus: async () => ({ "claude-code": true, codex: true }),
      list: async () => ({ ok: true, profiles: [] }),
    };
    useMeetingStore.setState({ panel: null, starting: true });
    mounted = await mount(<MeetingStartDialog api={api} profiles={profiles} />);
    await settle();
    expect(text()).toContain("Round 1: Proposer opens → Challenger opens");
    const start = button("Start meeting");
    if (!start) throw new Error("no start");
    await click(start);
    await settle();
    expect(text()).toContain("Say what the meeting should work on.");
    expect(calls).toEqual([]);
    const topic = document.querySelector<HTMLTextAreaElement>("textarea");
    if (!topic) throw new Error("no topic");
    await act(async () => {
      topic.focus();
      const set = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      set?.call(topic, "Pick a cache");
      topic.dispatchEvent(new window.Event("input", { bubbles: true }));
      // react-dom loaded before happy-dom registered: its keyup fallback reports the change.
      topic.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true }));
    });
    await click(start);
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toMatchObject({
      operationId: "f1",
      repoId: "r1",
      pattern: "debate",
      topic: "Pick a cache",
      members: [
        { provider: "claude-code", model: "opus" },
        { provider: "codex", model: "gpt-6-sol" },
      ],
    });
    expect(useMeetingStore.getState().panel).toEqual({ meetingId: "m2" });
  });
});

describe("meeting sync (#50)", () => {
  test("loads live meetings and the room's list, folds in meeting.changed", async () => {
    const { api } = fakeApi(detail());
    let listener: ((p: unknown) => void) | null = null;
    useMeetingStore.setState({ active: {}, panel: null, list: null });
    const stop = syncMeetings({
      api,
      client: {
        onOperationMessage: (type, l) => {
          if (type === MEETING_CHANGED_MESSAGE) listener = l;
          return () => {};
        },
      },
      pollMs: 60_000,
    });
    await settle();
    expect(Object.keys(useMeetingStore.getState().active)).toEqual(["m1"]);
    expect(useMeetingStore.getState().list?.canStart).toBe(true);
    (listener as ((p: unknown) => void) | null)?.(summary({ status: "done", finishedAt: 9 }));
    expect(useMeetingStore.getState().active).toEqual({});
    expect(useMeetingStore.getState().list?.meetings[0]?.status).toBe("done");
    (listener as ((p: unknown) => void) | null)?.({ junk: true });
    expect(useMeetingStore.getState().list?.meetings).toHaveLength(1);
    stop();
  });
});
