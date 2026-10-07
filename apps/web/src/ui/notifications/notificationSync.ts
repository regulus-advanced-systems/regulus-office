/**
 * Folds the server's notification messages into the browser (#42):
 * `notify.attention` sets the tab badge, `notify.event` raises a desktop
 * notification (or a toast while the office tab has focus) when my
 * preferences and quiet hours allow; a click on either goes to the henchman. Preferences and the badge are
 * (re)loaded over REST whenever the building connection comes up, because a
 * room message sent before the client listens would be lost.
 */
import {
  NOTIFY_ATTENTION_MESSAGE,
  NOTIFY_EVENT_MESSAGE,
  type NotificationPrefs,
  NotifyAttention,
  NotifyEvent,
} from "@regulus/protocol";
import { create } from "zustand";
import type { OfficeClient } from "../../net/officeClient.ts";
import type { useConnectionStore } from "../../state/connection.ts";
import type { ToastInput } from "../toast/toastQueue.ts";
import type { NotificationsApi } from "./api.ts";
import { notificationBody, notificationTitle, wantsDesktop } from "./desktop.ts";

export interface NotificationsState {
  prefs: NotificationPrefs | null;
  /** My henchmen waiting for me (tab badge). */
  attention: string[];
  setPrefs(prefs: NotificationPrefs): void;
  setAttention(agentIds: string[]): void;
}

export const useNotificationsStore = create<NotificationsState>()((set) => ({
  prefs: null,
  attention: [],
  setPrefs: (prefs) => set({ prefs }),
  setAttention: (attention) => set({ attention }),
}));

export interface NotificationSyncDeps {
  client: Pick<OfficeClient, "onBuildingMessage">;
  api: Pick<NotificationsApi, "prefs" | "attention">;
  connection: Pick<typeof useConnectionStore, "getState" | "subscribe">;
  store?: typeof useNotificationsStore;
  /** Show a desktop notification; false when the browser did not. */
  showDesktop(ev: NotifyEvent, onClick: () => void): boolean;
  hasFocus(): boolean;
  toast(input: ToastInput): void;
  goToHenchman(ev: NotifyEvent): void;
  now?: () => Date;
}

export function startNotificationSync(deps: NotificationSyncDeps): () => void {
  const store = deps.store ?? useNotificationsStore;
  const now = deps.now ?? (() => new Date());

  const reload = async () => {
    const [prefs, attention] = await Promise.all([deps.api.prefs(), deps.api.attention()]);
    if (prefs.ok) store.getState().setPrefs(prefs.data);
    if (attention.ok) store.getState().setAttention(attention.data.agentIds);
  };

  const onEvent = (payload: unknown) => {
    const parsed = NotifyEvent.safeParse(payload);
    const prefs = store.getState().prefs;
    if (!parsed.success || !prefs) return;
    const ev = parsed.data;
    if (!wantsDesktop(ev, prefs, now())) return;
    const open = () => deps.goToHenchman(ev);
    if (!deps.hasFocus() && deps.showDesktop(ev, open)) return;
    deps.toast({
      kind: ev.event === "error" ? "warning" : "info",
      title: notificationTitle(ev),
      message: notificationBody(ev) || " ",
      // The toast takes you there too: the henchman's room and its request (#256).
      open: { label: "Take me there", run: open },
    });
  };

  const onAttention = (payload: unknown) => {
    const parsed = NotifyAttention.safeParse(payload);
    if (parsed.success) store.getState().setAttention(parsed.data.agentIds);
  };

  const offs = [
    deps.client.onBuildingMessage(NOTIFY_EVENT_MESSAGE, onEvent),
    deps.client.onBuildingMessage(NOTIFY_ATTENTION_MESSAGE, onAttention),
  ];
  let last = deps.connection.getState().status;
  if (last === "connected") void reload();
  offs.push(
    deps.connection.subscribe((state) => {
      if (state.status === "connected" && last !== "connected") void reload();
      last = state.status;
    }),
  );
  return () => {
    for (const off of offs) off();
  };
}
