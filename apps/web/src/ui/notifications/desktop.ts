/**
 * Desktop notifications and the tab badge (#42), as small pure pieces plus
 * thin wrappers around the browser's Notification API and document.title.
 * Nothing here holds more than the henchman name, operation, status, task title and
 * PR link that the server already limited `notify.event` to.
 */
import {
  NOTIFICATION_EVENT_LABELS,
  type NotificationPrefs,
  type NotifyEvent,
} from "@regulus/protocol";

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Is `date` (browser local time) inside the quiet hours? Ranges may wrap midnight. */
export function inQuietHours(prefs: NotificationPrefs, date: Date): boolean {
  const q = prefs.quietHours;
  if (!q.enabled) return false;
  const start = minutes(q.start);
  const end = minutes(q.end);
  const now = date.getHours() * 60 + date.getMinutes();
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** Should this event raise a desktop notification for me now? */
export function wantsDesktop(ev: NotifyEvent, prefs: NotificationPrefs, date: Date): boolean {
  if (inQuietHours(prefs, date)) return false;
  if (!ev.own) return prefs.adminErrors && ev.event === "error";
  return prefs.desktop[ev.event];
}

export function notificationTitle(ev: NotifyEvent): string {
  return `${ev.henchmanName} ${NOTIFICATION_EVENT_LABELS[ev.event]}`;
}

export function notificationBody(ev: NotifyEvent): string {
  const lines = [ev.operationName ? `Operation: ${ev.operationName}` : "", ev.taskTitle];
  if (ev.prNumber > 0) lines.push(`Pull request #${ev.prNumber}`);
  return lines.filter(Boolean).join("\n");
}

/** "(2) Regulus Office": the badge in the tab title. */
export function badgeTitle(baseTitle: string, count: number): string {
  const plain = baseTitle.replace(/^\(\d+\+?\)\s+/, "");
  if (count <= 0) return plain;
  return `(${count > 99 ? "99+" : count}) ${plain}`;
}

export type DesktopPermission = NotificationPermission | "unsupported";

export function desktopPermission(): DesktopPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** Ask the browser (must run from a click). */
export async function requestDesktopPermission(): Promise<DesktopPermission> {
  if (desktopPermission() === "unsupported") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return desktopPermission();
  }
}

/** Show one notification; `onClick` focuses the office on that henchman. Returns false if not shown. */
export function showDesktop(ev: NotifyEvent, onClick: () => void): boolean {
  if (desktopPermission() !== "granted") return false;
  try {
    const n = new Notification(notificationTitle(ev), {
      body: notificationBody(ev),
      // One notification per henchman and event: a newer one replaces it.
      tag: `regulus-${ev.agentId}-${ev.event}`,
    });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}
