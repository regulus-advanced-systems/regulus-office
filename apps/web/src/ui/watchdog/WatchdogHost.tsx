/**
 * Mounted once in the HUD (#253): when the office says the watchdog ended a
 * round with findings this person may see (`watchdog.report`), a toast says
 * so, with a button that opens Settings on the Watchdog tab. The message
 * carries a count only; what was found is read from the office, which shows
 * each person what they may see.
 *
 * The office pushes only to people who are connected. So once, when this is
 * mounted, it asks the office what this person was not told of while they
 * were away, and says that the same way.
 */
import {
  WATCHDOG_ALERT_MESSAGE,
  WATCHDOG_REPORT_MESSAGE,
  WatchdogAlertPush,
  WatchdogReportPush,
} from "@regulus/protocol";
import { useEffect } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { useUiStore } from "../../state/ui.ts";
import { openSettingsAt } from "../settings/settingsTabs.ts";
import type { ToastInput } from "../toast/toastQueue.ts";
import { createWatchdogApi } from "./api.ts";

export interface WatchdogHostDeps {
  /** What this person missed while away, as a push would have said it; null: nothing, or not known. */
  missed?: () => Promise<unknown>;
  onMessage: (type: string, listener: (payload: unknown) => void) => () => void;
  toast: (input: ToastInput) => void;
  open: () => void;
}

/** The toast for one push; null for anything that is not one. */
export function reportToast(payload: unknown, open: () => void): ToastInput | null {
  const parsed = WatchdogReportPush.safeParse(payload);
  if (!parsed.success) return null;
  const { agentName, findings } = parsed.data;
  return {
    kind: "warning",
    title: `${agentName} is back from its round`,
    message: `${findings} finding${findings === 1 ? "" : "s"} for you to look at.`,
    durationMs: 0,
    open: { label: "Show", run: open },
  };
}

/** The toast for a host whose key changed (owners and admins only get this push). */
export function alertToast(payload: unknown, open: () => void): ToastInput | null {
  const parsed = WatchdogAlertPush.safeParse(payload);
  if (!parsed.success) return null;
  return {
    kind: "error",
    title: "A watched host shows another key",
    message: `${parsed.data.hostLabel} is not read until an admin looks at it.`,
    durationMs: 0,
    open: { label: "Show", run: open },
  };
}

export function startWatchdogReports(deps: WatchdogHostDeps): () => void {
  const offReport = deps.onMessage(WATCHDOG_REPORT_MESSAGE, (payload) => {
    const toast = reportToast(payload, deps.open);
    if (toast) deps.toast(toast);
  });
  const offAlert = deps.onMessage(WATCHDOG_ALERT_MESSAGE, (payload) => {
    const toast = alertToast(payload, deps.open);
    if (toast) deps.toast(toast);
  });
  let stopped = false;
  void deps.missed?.().then((payload) => {
    const toast = stopped ? null : reportToast(payload, deps.open);
    if (toast) deps.toast(toast);
  });
  return () => {
    stopped = true;
    offReport();
    offAlert();
  };
}

export function WatchdogHost() {
  useEffect(
    () =>
      startWatchdogReports({
        missed: async () => {
          const res = await createWatchdogApi().news();
          // The push's shape: a count of at least one, or nothing to say.
          return res.ok && res.data.findings > 0 ? { ...res.data, roundId: "missed" } : null;
        },
        onMessage: (type, listener) => getOfficeClient().onBuildingMessage(type, listener),
        toast: (input) => useUiStore.getState().toast(input),
        open: () => openSettingsAt("watchdog"),
      }),
    [],
  );
  return null;
}
