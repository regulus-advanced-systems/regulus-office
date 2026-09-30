import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CommandRejected, FloorState, RobotState } from "@regulus/protocol";
import { act } from "react";
import { useFloorStore } from "../../state/floor.ts";
import { useFloorsStore } from "../../state/floors.ts";

import { useSessionStore } from "../../state/session.ts";
import { type SpawnPrefill, useSpawnStore } from "../../state/spawn.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import { PROVIDERS_OVERLAY, useProvidersPanel } from "../providers/providersStore.ts";
import type { CredentialProfilesApi, LoginStatus } from "./api.ts";
import { SPAWN_OVERLAY, type SpawnClient, SpawnDialogHost } from "./SpawnDialog.tsx";
import type { SpawnPayload } from "./spawnForm.ts";

useDom();

const floorState = (robots: Record<string, RobotState> = {}): FloorState => ({
  floorId: "f1",
  name: "Apollo",
  slug: "apollo",
  paletteId: "oak-sky",
  layoutTemplateId: "office-l2",
  repos: [{ repoId: "r1", owner: "octo", name: "hello", defaultBranch: "main", isPrimary: true }],
  robots,
  desks: {},
  decor: {},
  queue: [],
  issues: {},
  pulls: {},
  services: {},
  whiteboardVersion: 0,
  carriedCards: {},
  queueSettings: { maxRunning: 2, maxPerOwner: 2 },
});

const robot = (seatId: string, ownerUserId: string): RobotState => ({
  agentId: "a-new",
  ownerUserId,
  ownerName: "Ante",
  repoId: "r1",
  seatId,
  provider: "claude-code",
  model: "opus",
  effort: "",
  permissionMode: "auto",
  status: "starting",
  action: "none",
  taskTitle: "Fix the bug",
  taskSummary: "",
  issueNumber: 0,
  prNumber: 0,
  worktreeBranch: "",
  handRaised: false,
  statusReason: "",
  bubbleEmits: { toolCalls: 0, fileEdits: 0, testRuns: 0, toolFailures: 0 },
  lastActivityAt: 0,
});

function fakeClient() {
  const sent: SpawnPayload[] = [];
  let listener: ((n: CommandRejected) => void) | null = null;
  const client: SpawnClient = {
    send: (_type, payload) => sent.push(payload),
    onRejected: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
  };
  return { client, sent, reject: (n: CommandRejected) => listener?.(n) };
}

/** Fake credentials API: Claude Code not logged in but an office key; Codex logged in. */
function fakeApi(
  logins: LoginStatus = { "claude-code": false, codex: true },
): CredentialProfilesApi {
  return {
    loginStatus: async () => logins,
    list: async (provider) => ({
      ok: true,
      profiles:
        provider === "claude-code"
          ? [
              {
                id: `office:${provider}`,
                label: "Team key",
                provider,
                authKind: "api_key",
                owner: "office",
              },
            ]
          : [],
    }),
  };
}
const api = fakeApi();

async function openAt(seatId = "desk-1-seat", prefill?: SpawnPrefill) {
  await act(async () => useSpawnStore.getState().openSpawn(seatId, prefill));
  await settle();
}

const radio = (value: string) =>
  document.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
const moreToggle = () => button("More options");
/** What has focus, as a short string (comparing DOM nodes makes failures unreadable). */
const focused = () => {
  const el = document.activeElement;
  return el instanceof HTMLInputElement ? el.value : `${el?.tagName}:${el?.textContent}`;
};

async function submitForm() {
  const form = document.querySelector('form[aria-label="Spawn robot"]');
  if (!form) throw new Error("no spawn form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

let mounted: Mounted | null = null;

beforeEach(() => {
  useSessionStore.setState({
    status: "authenticated",
    user: { id: "u1", displayName: "Ante", role: "member" },
    error: null,
  });
  useFloorStore.setState({ floorId: "f1", state: floorState() });
  useFloorsStore.setState({ floors: null });
  useSpawnStore.setState({ request: null });
  useUiStore.getState().clearToasts();
  localStorage.clear();
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe("spawn dialog", () => {
  test("asks for model and effort, focuses the model, and never shows a secret field", async () => {
    const { client } = fakeClient();
    mounted = await mount(<SpawnDialogHost api={api} client={client} />);
    expect(text()).not.toContain("Spawn a robot");
    await openAt();
    expect(text()).toContain("Spawn a robot");
    expect(useUiStore.getState().overlay).toBe(SPAWN_OVERLAY);
    // One repo: preselected, named next to the desk, not asked for.
    expect(document.querySelector(".rg-spawn__desk")?.textContent).toBe(
      "Desk desk-1-seat · octo/hello",
    );
    expect(document.querySelector('input[name$="-repo"]')).toBeNull();
    expect(focused()).toBe("claude-code:opus");
    expect(radio("claude-code:opus")?.checked).toBe(true);
    const effort = document.querySelector<HTMLInputElement>('input[name$="-effort"]:checked');
    expect(effort?.value).toBe("medium");
    // Collapsed by default: no prompt, credential or worktree fields.
    expect(moreToggle()?.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  test("models are grouped by provider in one radio group", async () => {
    const { client } = fakeClient();
    mounted = await mount(<SpawnDialogHost api={api} client={client} />);
    await openAt();
    const groups = Array.from(document.querySelectorAll('[role="group"]')).map((g) => ({
      name: document.getElementById(g.getAttribute("aria-labelledby") ?? "")?.textContent,
      models: Array.from(g.querySelectorAll<HTMLInputElement>('input[type="radio"]')).map(
        (r) => r.value,
      ),
    }));
    expect(groups).toEqual([
      {
        name: "Claude Code",
        models: [
          "claude-code:opus",
          "claude-code:sonnet",
          "claude-code:haiku",
          "claude-code:fable",
        ],
      },
      { name: "Codex", models: ["codex:gpt-6-sol", "codex:gpt-6-astra", "codex:gpt-6-luna"] },
    ]);
    const names = new Set(
      Array.from(document.querySelectorAll<HTMLInputElement>('input[name$="-model"]')).map(
        (r) => r.name,
      ),
    );
    expect(names.size).toBe(1);
    // Picking a model shows its own effort levels.
    await click(radio("claude-code:haiku") as HTMLInputElement);
    expect(text()).toContain("Haiku has no effort setting.");
    await click(radio("codex:gpt-6-astra") as HTMLInputElement);
    const efforts = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name$="-effort"]'),
    ).map((r) => r.value);
    expect(efforts).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
  });

  test("the defaults spawn: own login, worktree on, empty prompt", async () => {
    const { client, sent } = fakeClient();
    const both = fakeApi({ "claude-code": true, codex: true });
    mounted = await mount(<SpawnDialogHost api={both} client={client} />);
    await openAt();
    await submitForm();
    expect(sent).toEqual([
      {
        floorId: "f1",
        repoId: "r1",
        seatId: "desk-1-seat",
        provider: "claude-code",
        model: "opus",
        effort: "medium",
        prompt: "",
        autoWorktree: true,
      },
    ]);
  });

  test("without a Claude login the office key is used by default", async () => {
    const { client, sent } = fakeClient();
    mounted = await mount(<SpawnDialogHost api={api} client={client} />);
    await openAt();
    await submitForm();
    expect(sent[0]?.profileId).toBe("office:claude-code");
    await click(moreToggle() as HTMLButtonElement);
    const select = document.querySelector<HTMLSelectElement>('select[id$="-profileId"]');
    expect(select?.value).toBe("office:claude-code");
    expect(Array.from(select?.options ?? []).map((o) => o.textContent)).toEqual([
      "Your Claude Code login (not connected)",
      "Office key: Team key",
    ]);
  });

  test("More options picks the permission mode per provider; auto mode by default (#166)", async () => {
    const { client, sent } = fakeClient();
    mounted = await mount(<SpawnDialogHost api={api} client={client} />);
    await openAt();
    await click(moreToggle() as HTMLButtonElement);
    const mode = () => document.querySelector<HTMLSelectElement>('select[id$="-permissionMode"]');
    const labels = () => Array.from(mode()?.options ?? []).map((o) => o.textContent);
    expect(mode()?.value).toBe("auto");
    expect(labels()).toEqual(["Auto mode (default)", "Ask for everything", "Accept edits"]);
    expect(text()).toContain("Claude approves low-risk actions itself");

    await act(async () => {
      const select = mode() as HTMLSelectElement;
      select.value = "default";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(text()).toContain("raises its hand before every edit and command");
    await submitForm();
    expect(sent[0]?.permissionMode).toBe("default");

    // Codex has its own approval policies; switching provider resets the pick.
    await click(radio("codex:gpt-6-sol") as HTMLInputElement);
    expect(mode()?.value).toBe("on-request");
    expect(labels()).toEqual(["Ask outside the sandbox (default)", "Never ask"]);
  });

  test("an unconnected provider's models are disabled, with a Connect link", async () => {
    const { client } = fakeClient();
    const none: CredentialProfilesApi = {
      loginStatus: async () => ({ "claude-code": false, codex: true }),
      list: async () => ({ ok: true, profiles: [] }),
    };
    mounted = await mount(<SpawnDialogHost api={none} client={client} />);
    await openAt();
    expect(radio("claude-code:opus")?.disabled).toBe(true);
    expect(radio("codex:gpt-6-sol")?.disabled).toBe(false);
    // The first usable provider's default model is preselected (and focused).
    expect(radio("codex:gpt-6-sol")?.checked).toBe(true);
    expect(focused()).toBe("codex:gpt-6-sol");
    expect(button("Connect Codex")).toBeUndefined();
    const connect = button("Connect Claude Code");
    if (!connect) throw new Error("no connect link");
    await click(connect);
    await settle();
    expect(useProvidersPanel.getState().focus).toBe("claude-code");
    expect(useUiStore.getState().overlay).toBe(PROVIDERS_OVERLAY);
    expect(useSpawnStore.getState().request).toBeNull();
  });

  test("More options is remembered per user", async () => {
    const { client } = fakeClient();
    mounted = await mount(<SpawnDialogHost api={api} client={client} />);
    await openAt();
    await click(moreToggle() as HTMLButtonElement);
    expect(moreToggle()?.getAttribute("aria-expanded")).toBe("true");
    for (const label of ["Prompt", "Task title", "Issue", "Credentials", "Own worktree"])
      expect(text()).toContain(label);
    await click(button("Cancel") as HTMLButtonElement);
    await openAt("desk-2-seat");
    expect(moreToggle()?.getAttribute("aria-expanded")).toBe("true");
    await click(button("Cancel") as HTMLButtonElement);

    // Another user on this browser starts collapsed.
    await act(async () =>
      useSessionStore.setState({ user: { id: "u2", displayName: "Bo", role: "member" } }),
    );
    await openAt("desk-3-seat");
    expect(moreToggle()?.getAttribute("aria-expanded")).toBe("false");
  });

  test("the prompt, title and issue from More options are sent", async () => {
    const { client, sent } = fakeClient();
    mounted = await mount(<SpawnDialogHost api={api} client={client} />);
    // A carried issue card prefills the dialog (M2) and opens More options.
    await openAt("desk-1-seat", { issueNumber: 7, prompt: "Fix the bug" });
    expect(moreToggle()?.getAttribute("aria-expanded")).toBe("true");
    await submitForm();
    expect(sent[0]).toMatchObject({ prompt: "Fix the bug", issueNumber: 7 });
  });

  test("several repos are listed; repos still cloning cannot be picked", async () => {
    const { client } = fakeClient();
    useFloorsStore.setState({
      floors: [
        {
          floorId: "f1",
          repos: [
            { repoId: "r1", owner: "octo", name: "hello", cloneStatus: "ready", isPrimary: true },
            { repoId: "r2", owner: "octo", name: "new", cloneStatus: "cloning", isPrimary: false },
          ],
        },
      ] as never,
    });
    mounted = await mount(<SpawnDialogHost api={api} client={client} />);
    await openAt();
    expect(radio("r1")?.checked).toBe(true);
    expect(radio("r2")?.disabled).toBe(true);
    expect(text()).toContain("Not cloned yet");
  });

  test("sends agent.spawn, shows the rejection, then closes when our robot sits down", async () => {
    const { client, sent, reject } = fakeClient();
    mounted = await mount(<SpawnDialogHost api={api} client={client} />);
    await openAt();
    await submitForm();
    expect(sent).toHaveLength(1);
    expect(button("Spawning…")?.disabled).toBe(true);

    await act(async () => reject({ type: "agent.spawn", reason: "desk is taken" }));
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("desk is taken");
    expect(button("Spawn robot")?.disabled).toBe(false);

    await submitForm();
    expect(sent).toHaveLength(2);
    // Someone else's robot at another desk does not count.
    await act(async () =>
      useFloorStore.setState({ state: floorState({ x: robot("desk-9", "u2") }) }),
    );
    expect(useSpawnStore.getState().request).not.toBeNull();
    await act(async () =>
      useFloorStore.setState({ state: floorState({ "a-new": robot("desk-1-seat", "u1") }) }),
    );
    await settle();
    expect(useSpawnStore.getState().request).toBeNull();
    expect(text()).not.toContain("Spawn a robot");
    expect(useUiStore.getState().toastQueue.toasts.map((t) => t.title)).toContain("Robot spawned");
  });

  test("closing with Cancel clears the request", async () => {
    const { client } = fakeClient();
    mounted = await mount(<SpawnDialogHost api={api} client={client} />);
    await openAt("desk-2-seat");
    await click(button("Cancel") as HTMLButtonElement);
    expect(useSpawnStore.getState().request).toBeNull();
    expect(useUiStore.getState().overlay).toBeNull();
  });
});
