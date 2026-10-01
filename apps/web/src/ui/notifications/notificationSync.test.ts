import { beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFY_ATTENTION_MESSAGE,
  NOTIFY_EVENT_MESSAGE,
  type NotifyEvent,
} from "@regulus/protocol";
import { useConnectionStore } from "../../state/connection.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import type { ToastInput } from "../toast/toastQueue.ts";
import { createNotificationsApi } from "./api.ts";
import { startNotificationSync, useNotificationsStore } from "./notificationSync.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));

function harness(opts: { focus?: boolean; desktopOk?: boolean } = {}) {
  const listeners = new Map<string, (p: unknown) => void>();
  const shown: NotifyEvent[] = [];
  const toasts: ToastInput[] = [];
  const visited: string[] = [];
  const f = fakeFetch({
    "GET /api/notifications/prefs": { body: DEFAULT_NOTIFICATION_PREFS },
    "GET /api/notifications/attention": { body: { agentIds: ["a1", "a2"] } },
  });
  const stop = startNotificationSync({
    client: {
      onBuildingMessage: (type, listener) => {
        listeners.set(type, listener);
        return () => listeners.delete(type);
      },
    },
    api: createNotificationsApi({ fetch: f.fetch }),
    connection: useConnectionStore,
    showDesktop: (ev, onClick) => {
      shown.push(ev);
      onClick();
      return opts.desktopOk ?? true;
    },
    hasFocus: () => opts.focus ?? false,
    toast: (t) => toasts.push(t),
    goToHenchman: (ev) => visited.push(ev.agentId),
    now: () => new Date(2026, 8, 30, 12, 0),
  });
  const emit = (type: string, payload: unknown) => listeners.get(type)?.(payload);
  return { stop, emit, shown, toasts, visited, f, listeners };
}

const event = (extra: Partial<NotifyEvent> = {}): NotifyEvent => ({
  id: "1",
  event: "needs_input",
  agentId: "a1",
  operationId: "f1",
  operationName: "Web app",
  henchmanName: "Mia's Codex henchman",
  ownerName: "Mia",
  provider: "codex",
  taskTitle: "Fix it",
  prNumber: 0,
  prUrl: "",
  own: true,
  ts: 1,
  ...extra,
});

beforeEach(() => {
  useConnectionStore.setState({ status: "idle" });
  useNotificationsStore.setState({ prefs: null, attention: [] });
});

describe("notification sync", () => {
  test("loads prefs and the badge whenever the building connection comes up", async () => {
    const h = harness();
    expect(h.f.calls).toHaveLength(0);
    useConnectionStore.getState().set({ status: "connected" });
    await flush();
    expect(useNotificationsStore.getState().attention).toEqual(["a1", "a2"]);
    expect(useNotificationsStore.getState().prefs).toEqual(DEFAULT_NOTIFICATION_PREFS);
    useConnectionStore.getState().set({ status: "reconnecting" });
    useConnectionStore.getState().set({ status: "connected" });
    await flush();
    expect(h.f.calls).toHaveLength(4);
    h.stop();
    expect(h.listeners.size).toBe(0);
  });

  test("attention messages replace the badge list; junk is ignored", () => {
    const h = harness();
    h.emit(NOTIFY_ATTENTION_MESSAGE, { agentIds: ["x"] });
    h.emit(NOTIFY_ATTENTION_MESSAGE, { agentIds: "nope" });
    expect(useNotificationsStore.getState().attention).toEqual(["x"]);
    h.stop();
  });

  test("events become desktop notifications in the background, toasts in focus", () => {
    useNotificationsStore.setState({ prefs: DEFAULT_NOTIFICATION_PREFS });
    const bg = harness();
    bg.emit(NOTIFY_EVENT_MESSAGE, event());
    expect(bg.shown.map((e) => e.agentId)).toEqual(["a1"]);
    expect(bg.visited).toEqual(["a1"]);
    expect(bg.toasts).toHaveLength(0);
    bg.stop();
    const fg = harness({ focus: true });
    fg.emit(NOTIFY_EVENT_MESSAGE, event({ event: "error" }));
    expect(fg.shown).toHaveLength(0);
    expect(fg.toasts[0]).toMatchObject({
      kind: "warning",
      title: "Mia's Codex henchman hit an error",
    });
    fg.stop();
  });

  test("respects preferences and falls back to a toast when the browser refuses", () => {
    useNotificationsStore.setState({ prefs: DEFAULT_NOTIFICATION_PREFS });
    const h = harness({ desktopOk: false });
    h.emit(NOTIFY_EVENT_MESSAGE, event({ event: "pr_opened" }));
    expect(h.shown).toHaveLength(0);
    h.emit(NOTIFY_EVENT_MESSAGE, event());
    expect(h.toasts).toHaveLength(1);
    h.emit(NOTIFY_EVENT_MESSAGE, { event: "done" });
    expect(h.toasts).toHaveLength(1);
    h.stop();
  });
});
