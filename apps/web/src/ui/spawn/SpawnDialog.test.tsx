import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CommandRejected, FloorState, RobotState } from "@regulus/protocol";
import { act } from "react";
import { useFloorStore } from "../../state/floor.ts";
import { useFloorsStore } from "../../state/floors.ts";
import { useProvidersPanel } from "../../state/providersPanel.ts";
import { useSessionStore } from "../../state/session.ts";
import { useSpawnStore } from "../../state/spawn.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import type { CredentialProfilesApi } from "./api.ts";
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
  status: "starting",
  action: "none",
  taskTitle: "Fix the bug",
  taskSummary: "",
  issueNumber: 0,
  prNumber: 0,
  worktreeBranch: "",
  handRaised: false,
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

const api: CredentialProfilesApi = {
  list: async (provider) => ({
    ok: true,
    profiles: [
      {
        id: `office:${provider}`,
        label: "Team key",
        provider,
        authKind: "api_key",
        owner: "office",
      },
    ],
  }),
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
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe("spawn dialog", () => {
  test("opens for a desk with the credential choices and never a secret field", async () => {
    const { client } = fakeClient();
    mounted = await mount(<SpawnDialogHost api={api} client={client} />);
    expect(text()).not.toContain("Spawn a robot");
    await act(async () => useSpawnStore.getState().openSpawn("desk-1-seat"));
    await settle();
    expect(text()).toContain("Spawn a robot");
    expect(text()).toContain("desk-1-seat");
    expect(useUiStore.getState().overlay).toBe(SPAWN_OVERLAY);
    const options = Array.from(document.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toContain("Your Claude Code login");
    expect(options).toContain("Office key: Team key");
    expect(options).toContain("Gemini CLI (M4)");
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  test("validation errors stop the send", async () => {
    const { client, sent } = fakeClient();
    mounted = await mount(<SpawnDialogHost api={api} client={client} />);
    await act(async () => useSpawnStore.getState().openSpawn("desk-1-seat"));
    await settle();
    await submitForm();
    expect(sent).toHaveLength(0);
    expect(text()).toContain("Tell the robot what to do.");
  });

  test("sends agent.spawn, shows the rejection, then closes when our robot sits down", async () => {
    const { client, sent, reject } = fakeClient();
    mounted = await mount(<SpawnDialogHost api={api} client={client} />);
    // A carried issue card prefills the dialog (M2); here it also saves typing.
    await act(async () =>
      useSpawnStore.getState().openSpawn("desk-1-seat", { issueNumber: 7, prompt: "Fix the bug" }),
    );
    await settle();
    await submitForm();
    expect(sent).toEqual([
      {
        floorId: "f1",
        repoId: "r1",
        seatId: "desk-1-seat",
        provider: "claude-code",
        model: "opus",
        prompt: "Fix the bug",
        autoWorktree: true,
        issueNumber: 7,
      },
    ]);
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

  test("offers Connect <provider> when the human has no profile of their own", async () => {
    const { client } = fakeClient();
    mounted = await mount(<SpawnDialogHost api={api} client={client} />);
    await act(async () => useSpawnStore.getState().openSpawn("desk-1-seat"));
    await settle();
    const connect = button("Connect Claude Code");
    if (!connect) throw new Error("no connect link");
    await click(connect);
    expect(useProvidersPanel.getState().provider).toBe("claude-code");
  });

  test("closing with Cancel clears the request", async () => {
    const { client } = fakeClient();
    mounted = await mount(<SpawnDialogHost api={api} client={client} />);
    await act(async () => useSpawnStore.getState().openSpawn("desk-2-seat"));
    await settle();
    const cancel = button("Cancel");
    if (!cancel) throw new Error("no cancel");
    await click(cancel);
    expect(useSpawnStore.getState().request).toBeNull();
    expect(useUiStore.getState().overlay).toBeNull();
  });
});
