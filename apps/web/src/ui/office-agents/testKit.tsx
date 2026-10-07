/** Fixtures and DOM helpers shared by the Settings → Agents tests. Only imported by tests. */
import type {
  HumanRequest,
  OfficeAgentRunsOnResponse,
  OfficeAgentsResponse,
  OfficeAgentView,
  UserRole,
} from "@regulus/protocol";
import { act } from "react";
import { useSessionStore } from "../../state/session.ts";
import { type Mounted, mount } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { settle } from "../auth/testDom.tsx";
import { createOfficeAgentsApi } from "./api.ts";
import { OfficeAgentsSection } from "./OfficeAgentsSection.tsx";

export const NOW = 1_800_000_000_000;
export const agent = (over: Partial<OfficeAgentView>): OfficeAgentView => ({
  id: "a1",
  name: "Hermes",
  owner: { kind: "user", userId: "u1", displayName: "Ante" },
  engine: "cli-session",
  role: "pm",
  preset: "coordinator",
  provider: "claude-code",
  model: "sonnet",
  runsOn: { kind: "login", officeKey: false },
  appearance: "standard",
  status: "ready",
  lastActivityAt: NOW - 5 * 60_000,
  createdAt: NOW - 86_400_000,
  canTalk: true,
  canConfigure: true,
  config: { instructions: "", grants: [], tokens: [] },
  ...over,
});
export const SHARED = agent({
  id: "a2",
  name: "Number Two",
  owner: { kind: "office" },
  status: "stopped",
  canConfigure: false,
  config: undefined,
});
export const SOMEONES = agent({
  id: "a3",
  name: "Mias helper",
  owner: { kind: "user", userId: "u9", displayName: "Mia" },
  canTalk: false,
  canConfigure: false,
  config: undefined,
});
export const response = (agents: OfficeAgentView[]): OfficeAgentsResponse => ({
  agents,
  settings: { personalAgentCap: 3, managerDailySpawnCap: 10, sharedMessagesPerHour: 20 },
  engines: ["cli-session"],
});
export const LOGIN = (connected: boolean | null) => ({
  provider: "claude-code",
  connected,
  checkedAt: NOW,
});
const KEY = { owner: "me", provider: "claude-code" } as const;
export const RUNS_ON: OfficeAgentRunsOnResponse = {
  personal: [
    { ...KEY, kind: "login", label: "" },
    { ...KEY, kind: "deepseek", label: "My DeepSeek", profileId: "p-ds" },
  ],
  shared: [
    { ...KEY, owner: "office", kind: "anthropic", label: "Office Anthropic", profileId: "o-an" },
    { ...KEY, owner: "office", kind: "deepseek", label: "Watchdog key", profileId: "o-ds" },
  ],
};
export const QUESTION: HumanRequest = {
  id: "r1",
  agentId: "a1",
  agentName: "Hermes",
  forUserId: "u1",
  question: "Ship on Friday?",
  options: ["Yes", "No"],
  status: "pending",
  createdAt: NOW,
};

export const mounted: Mounted[] = [];
/** Each test file registers this with `afterEach`. */
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
  const f = fakeFetch({
    "GET /api/office-agents/requests": { body: { requests: [] } },
    "GET /api/office-agents/runs-on": { body: RUNS_ON },
    "GET /api/provider-logins": { body: { providers: [LOGIN(true)] } },
    ...routes,
  });
  mounted.push(
    await mount(
      <OfficeAgentsSection api={createOfficeAgentsApi({ fetch: f.fetch })} now={() => NOW} />,
    ),
  );
  await settle();
  return f;
}

export const card = (name: string) => {
  const el = document.querySelector<HTMLElement>(`article[aria-label=${JSON.stringify(name)}]`);
  if (!el) throw new Error(`no card ${name}`);
  return el;
};
export const select = (label: string) => {
  const l = Array.from(document.querySelectorAll("label")).find(
    (x) => x.textContent?.trim() === label,
  );
  const el = document.getElementById(l?.getAttribute("for") ?? "");
  if (!(el instanceof HTMLSelectElement)) throw new Error(`no select "${label}"`);
  return el;
};
export const choose = async (el: HTMLSelectElement, value: string) => {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
};
const group = (legend: string) => {
  const el = Array.from(document.querySelectorAll("fieldset")).find(
    (f) => f.querySelector("legend")?.textContent === legend,
  );
  if (!el) throw new Error(`no group "${legend}"`);
  return el;
};
/** The radio whose option starts with this title. */
export const radio = (title: string) => {
  const label = Array.from(document.querySelectorAll("label")).find(
    (l) =>
      l.querySelector('input[type="radio"]') &&
      l
        .querySelector(".rg-spawn__option-title, .rg-skin-gallery__label")
        ?.textContent?.startsWith(title),
  );
  return label?.querySelector("input") as HTMLInputElement;
};
/** Titles of a radio group's options (with the Cheap / Strong mark), without the help line. */
export const radioLabels = (legend: string) =>
  Array.from(group(legend).querySelectorAll("label")).map(
    (l) =>
      l.querySelector(".rg-spawn__option-title, .rg-skin-gallery__label")?.textContent?.trim() ??
      "",
  );
export const within = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
