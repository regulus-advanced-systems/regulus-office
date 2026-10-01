/**
 * Mounted once in the HUD (#42): keeps the tab badge ("(2) Regulus Office")
 * in sync with my waiting henchmen and raises desktop notifications for my
 * henchmen. Clicking one quick-travels me into the henchman's room (#186) and
 * opens its panel.
 */
import type { NotifyEvent } from "@regulus/protocol";
import { useEffect } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { useConnectionStore } from "../../state/connection.ts";
import { useOperationStore } from "../../state/operation.ts";
import { travelTo } from "../../state/travel.ts";
import { useUiStore } from "../../state/ui.ts";
import { openAgentPanel } from "../agent/agentStore.ts";
import { createNotificationsApi } from "./api.ts";
import { badgeTitle, showDesktop } from "./desktop.ts";
import {
  type NotificationSyncDeps,
  startNotificationSync,
  useNotificationsStore,
} from "./notificationSync.ts";

/** Resolves once the room's OperationRoom is the one the player is in (or after `ms`). */
export function whenInRoom(operationId: string, ms = 15_000): Promise<boolean> {
  return new Promise((resolve) => {
    const here = () => useOperationStore.getState().state?.operationId === operationId;
    if (here()) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, ms);
    const off = useOperationStore.subscribe(() => {
      if (!here()) return;
      clearTimeout(timer);
      off();
      resolve(true);
    });
  });
}

function goToHenchman(ev: NotifyEvent): void {
  if (getOfficeClient().currentOperationId !== ev.operationId)
    travelTo(ev.operationId, { walkIn: true });
  void whenInRoom(ev.operationId).then((ok) => ok && openAgentPanel(ev.agentId));
}

const liveDeps = (): NotificationSyncDeps => ({
  client: getOfficeClient(),
  api: createNotificationsApi(),
  connection: useConnectionStore,
  showDesktop,
  hasFocus: () => document.hasFocus(),
  toast: (input) => useUiStore.getState().toast(input),
  goToHenchman,
});

export function NotificationsHost({ deps = liveDeps }: { deps?: () => NotificationSyncDeps }) {
  useEffect(() => startNotificationSync(deps()), [deps]);
  const count = useNotificationsStore((s) => s.attention.length);
  useEffect(() => {
    document.title = badgeTitle(document.title, count);
  }, [count]);
  useEffect(
    () => () => {
      document.title = badgeTitle(document.title, 0);
    },
    [],
  );
  return null;
}
