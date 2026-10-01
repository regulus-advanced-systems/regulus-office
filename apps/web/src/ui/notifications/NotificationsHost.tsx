/**
 * Mounted once in the HUD (#42): keeps the tab badge ("(2) Regulus Office")
 * in sync with my waiting robots and raises desktop notifications for my
 * robots. Clicking one quick-travels me into the robot's room (#186) and
 * opens its panel.
 */
import type { NotifyEvent } from "@regulus/protocol";
import { useEffect } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { useConnectionStore } from "../../state/connection.ts";
import { useFloorStore } from "../../state/floor.ts";
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

/** Resolves once the room's FloorRoom is the one the player is in (or after `ms`). */
export function whenInRoom(floorId: string, ms = 15_000): Promise<boolean> {
  return new Promise((resolve) => {
    const here = () => useFloorStore.getState().state?.floorId === floorId;
    if (here()) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, ms);
    const off = useFloorStore.subscribe(() => {
      if (!here()) return;
      clearTimeout(timer);
      off();
      resolve(true);
    });
  });
}

function goToRobot(ev: NotifyEvent): void {
  if (getOfficeClient().currentFloorId !== ev.floorId) travelTo(ev.floorId, { walkIn: true });
  void whenInRoom(ev.floorId).then((ok) => ok && openAgentPanel(ev.agentId));
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
