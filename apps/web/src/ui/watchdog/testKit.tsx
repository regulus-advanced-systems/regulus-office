/** Fixtures and DOM helpers shared by the Settings → Watchdog tests (#253). Only imported by tests. */
import type {
  UserRole,
  WatchdogFindingView,
  WatchdogHostView,
  WatchdogReport,
  WatchdogSettingsView,
} from "@regulus/protocol";
import { act } from "react";
import { useSessionStore } from "../../state/session.ts";
import { type Mounted, mount } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { settle } from "../auth/testDom.tsx";
import { createWatchdogApi } from "./api.ts";
import { WatchdogSection } from "./WatchdogSection.tsx";

export const NOW = Date.now();
export const KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nFAKEFAKEFAKE\n-----END OPENSSH PRIVATE KEY-----";

export const finding = (over: Partial<WatchdogFindingView>): WatchdogFindingView => ({
  id: "f1",
  title: "Orders handler reads id of undefined",
  evidence:
    "TypeError: Cannot read properties of undefined\n    at handler (/srv/app/orders.js:42)",
  disposition: "propose_fix",
  reason: "A missing null check in the orders route.",
  operationId: "op-apollo",
  sources: [
    {
      kind: "sentry",
      label: "WEB-1A",
      url: "https://sentry.io/organizations/acme/issues/?query=WEB-1A",
    },
    { kind: "pm2", label: "api on prod-1" },
  ],
  firstSeenAt: NOW - 3_600_000,
  lastSeenAt: NOW - 120_000,
  seenCount: 0,
  regressions: 0,
  noise: false,
  canMarkNoise: true,
  fix: { state: "awaiting_approval", summary: "Guard req.user.", auto: false, canDecide: true },
  sentryComment: "posted",
  ...over,
});
export const DISMISSED = finding({
  id: "f2",
  title: "Payments upstream timing out",
  disposition: "dismiss",
  reason: "A known third-party outage.",
  sources: [{ kind: "pm2", label: "api on prod-1" }],
  fix: { state: "none", summary: "", auto: false, canDecide: false },
  sentryComment: "none",
});
export const report = (over: Partial<WatchdogReport> = {}): WatchdogReport => ({
  configured: true,
  enabled: true,
  agent: { id: "a1", name: "Cerberus", status: "ready", stoppedByPerson: false },
  running: false,
  nextRoundAt: NOW + 30 * 60_000,
  rounds: [
    {
      id: "r2",
      trigger: "schedule",
      state: "done",
      startedAt: NOW - 120_000,
      findingIds: ["f1"],
      summaries: ["api has two faults.", "Not read: prod-2: the connection was refused"],
    },
    {
      id: "r1",
      trigger: "manual",
      state: "failed",
      startedAt: NOW - 4_000_000,
      findingIds: [],
      summaries: [],
      error: "1 of its 2 parts did not finish",
    },
  ],
  findings: [finding({}), DISMISSED],
  canRunNow: false,
  canConfigure: false,
  ...over,
});
export const HOST: WatchdogHostView = {
  id: "h1",
  label: "prod-1",
  host: "vps.example.com",
  port: 22,
  username: "watchdog",
  hasKey: true,
  pinned: ["ssh-ed25519 SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
  pinnedBy: "learned",
  offered: [],
  apps: [
    { id: "p1", name: "api", operationId: null, operationHidden: true, watched: true },
    { id: "p2", name: "worker", operationId: null, operationHidden: false, watched: true },
  ],
};
export const SETTINGS: WatchdogSettingsView = {
  enabled: true,
  agentId: "a1",
  agents: [{ id: "a1", name: "Cerberus" }],
  intervalMinutes: 60,
  fixMode: "ask",
  fixProvider: "claude-code",
  fixModel: "opus",
  autoFixPerRound: 1,
  autoFixPerDay: 3,
  autoFixBy: null,
  sentry: {
    host: "sentry.io",
    organization: "acme",
    hasToken: true,
    projects: [{ id: "s1", slug: "web", operationId: null, operationHidden: true, watched: true }],
  },
  hosts: [HOST],
  canStore: true,
};

const mounted: Mounted[] = [];
/** After each test: unmount, and sign nobody in. */
export async function cleanup() {
  for (const m of mounted.splice(0)) await m.unmount();
  await settle();
  useSessionStore.setState({ status: "unknown", user: null, error: null });
}

export async function show(role: UserRole, routes: Parameters<typeof fakeFetch>[0]) {
  useSessionStore.setState({
    status: "authenticated",
    user: { id: "u1", displayName: "Ante", role },
    error: null,
  });
  const f = fakeFetch(routes);
  const nudges = new Map<string, () => void>();
  mounted.push(
    await mount(
      <WatchdogSection
        api={createWatchdogApi({ fetch: f.fetch })}
        onNudge={(type, listener) => {
          nudges.set(type, listener);
          return () => nudges.delete(type);
        }}
      />,
    ),
  );
  await settle();
  return { ...f, nudges };
}

export async function type(el: Element | null | undefined, value: string) {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
    throw new Error("no field");
  }
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
    el.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true }));
  });
  await settle();
}
export const field = (label: string) => {
  const l = Array.from(document.querySelectorAll("label")).find(
    (x) => x.textContent?.trim() === label,
  );
  return document.getElementById(l?.getAttribute("for") ?? "");
};
