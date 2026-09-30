/**
 * Mounted once in the HUD (#42): keeps the tab badge ("(2) Regulus Office")
 * in sync with my waiting robots and raises desktop notifications for my
 * robots. Clicking one takes me to the robot's floor and opens its panel.
 */
import type { NotifyEvent } from "@regulus/protocol";
import { useEffect } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { useConnectionStore } from "../../state/connection.ts";
import { useUiStore } from "../../state/ui.ts";
import { openAgentPanel } from "../agent/agentStore.ts";
import { createNotificationsApi } from "./api.ts";
import { badgeTitle, showDesktop } from "./desktop.ts";
import {
  type NotificationSyncDeps,
  startNotificationSync,
  useNotificationsStore,
} from "./notificationSync.ts";

function goToRobot(ev: NotifyEvent): void {
  const client = getOfficeClient();
  const ride = client.currentFloorId === ev.floorId ? Promise.resolve() : client.rideTo(ev.floorId);
  void ride.then(() => openAgentPanel(ev.agentId)).catch(() => undefined);
}

const liveDeps = (): NotificationSyncDeps => ({
  client: getOfficeClient(),
  api: createNotificationsApi(),
  connection: useConnectionStore,
  showDesktop,
  hasFocus: () => document.hasFocus(),
  toast: (input) => useUiStore.getState().toast(input),
  goToRobot,
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
