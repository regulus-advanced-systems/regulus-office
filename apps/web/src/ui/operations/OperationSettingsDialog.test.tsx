import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  BuildingState,
  OfficeUserInfo,
  OperationInfo,
  OperationMemberInfo,
  OperationSummary,
  UserRole,
} from "@regulus/protocol";
import { act } from "react";
import { rowPlacement, testWorld } from "../../scene/compound/testing.ts";
import { useBuildingStore } from "../../state/building.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { useOperationStore } from "../../state/operation.ts";
import { useOperationsStore } from "../../state/operations.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount as mountNode, useDom } from "../a11y/dom.ts";
import { type FakeCall, fakeFetch } from "../auth/fakeFetch.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import { OperationAddedPanel } from "../build-mode/OperationAddedPanel.tsx";
import { useBuildModeStore } from "../build-mode/store.ts";
import { QUICK_TRAVEL_OVERLAY, QuickTravelDialog } from "../hud/QuickTravel.tsx";
import { TopBar } from "../hud/TopBar.tsx";
import { createOperationsApi } from "./api.ts";
import { OperationSettingsDialogHost } from "./OperationSettingsDialog.tsx";
import { operationSettingsOverlay } from "./operationSettings.ts";

useDom();

const OPERATION_ID = "f1";

const operationInfo = (access: OperationInfo["access"]): OperationInfo => ({
  operationId: OPERATION_ID,
  name: "Hangar",
  slug: "hangar",
  index: 1,
  paletteId: "oak-sky",
  layoutTemplateId: "office-l2",
  archivedAt: null,
  access,
  repos: [],
});

const PEOPLE: OfficeUserInfo[] = [
  { userId: "u1", displayName: "Ada Owner", role: "owner" },
  { userId: "u2", displayName: "Ben Member", role: "member" },
  { userId: "u3", displayName: "Vic Viewer", role: "viewer" },
  { userId: "me", displayName: "Mia Manager", role: "member" },
];

/** A fake members API that keeps state like the server does. */
function fakeServer(initial: OperationMemberInfo[]) {
  let members = [...initial];
  const base = `/api/operations/${OPERATION_ID}/members`;
  const put = ({ path, body }: FakeCall) => {
    const userId = path.slice(base.length + 1);
    const access = (body as { access: OperationMemberInfo["access"] }).access;
    const name = PEOPLE.find((p) => p.userId === userId)?.displayName ?? userId;
    members = [
      ...members.filter((m) => m.userId !== userId),
      { userId, displayName: name, access },
    ];
    return { status: 204 };
  };
  const del = ({ path }: FakeCall) => {
    const userId = path.slice(base.length + 1);
    members = members.filter((m) => m.userId !== userId);
    return { status: 204 };
  };
  return fakeFetch({
    [`GET ${base}`]: () => ({ body: { members } }),
    "GET /api/users": { body: { users: PEOPLE } },
    [`PUT ${base}/u2`]: put,
    [`PUT ${base}/u3`]: put,
    [`DELETE ${base}/u2`]: del,
  });
}

const signedInAs = (role: UserRole) =>
  useSessionStore.setState({
    status: "authenticated",
    user: { id: "me", displayName: "Mia Manager", role },
    error: null,
  });

const mounted: Mounted[] = [];
async function mount(node: Parameters<typeof mountNode>[0]) {
  const m = await mountNode(node);
  mounted.push(m);
  await settle();
  return m;
}

const dialog = () => document.querySelector('[role="dialog"]');
const labelled = <T extends Element>(label: string) =>
  document.querySelector<T & HTMLElement>(`[aria-label="${label}"]`);

async function choose(select: HTMLSelectElement | null, value: string) {
  if (!select) throw new Error("no select");
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

async function openPanel() {
  await act(async () => useUiStore.getState().openOverlay(operationSettingsOverlay(OPERATION_ID)));
  await settle();
}

describe("operation settings panel", () => {
  beforeEach(() => {
    signedInAs("member");
  });
  afterEach(async () => {
    for (const m of mounted.splice(0)) await m.unmount();
    await settle();
    await act(async () => {
      useUiStore.setState({ overlay: null });
      useOperationsStore.getState().clear();
      useOperationStore.getState().clear();
      useBuildingStore.getState().clear();
      useCompoundStore.setState({ world: null });
      useSessionStore.setState({ status: "unknown", user: null, error: null });
    });
    for (const el of document.querySelectorAll(".rg-backdrop")) el.remove();
  });

  test("members without manage get neither the panel nor its buttons", async () => {
    useOperationsStore.setState({ operations: [operationInfo("spawn")] });
    useOperationStore.setState({ operationId: OPERATION_ID });
    const f = fakeServer([]);
    await mount(
      <>
        <TopBar />
        <OperationSettingsDialogHost api={createOperationsApi({ fetch: f.fetch })} />
      </>,
    );
    expect(button("Operation settings")).toBeUndefined();
    await openPanel();
    expect(dialog()).toBeNull();
    expect(f.calls).toEqual([]);
    // The stray overlay is released so hotkeys work again.
    expect(useUiStore.getState().overlay).toBeNull();
  });

  test("an operation manager opens it from the top bar and from quick travel", async () => {
    useOperationsStore.setState({ operations: [operationInfo("manage")] });
    useOperationStore.setState({ operationId: OPERATION_ID });
    const summary = { operationId: OPERATION_ID, name: "Hangar", index: 1, paletteId: "oak-sky" };
    useBuildingStore.setState({
      state: {
        operations: { [OPERATION_ID]: summary as OperationSummary },
      } as unknown as BuildingState,
    });
    useCompoundStore.setState({
      world: testWorld([{ id: OPERATION_ID, name: "Hangar", placement: rowPlacement(4) }]),
    });
    useUiStore.getState().openOverlay(QUICK_TRAVEL_OVERLAY);
    const f = fakeServer([]);
    await mount(
      <>
        <TopBar />
        <QuickTravelDialog />
        <OperationSettingsDialogHost api={createOperationsApi({ fetch: f.fetch })} />
      </>,
    );
    const gear = labelled<HTMLButtonElement>("Operation settings: Hangar");
    if (!gear) throw new Error("no quick travel gear");
    await click(gear);
    await settle();
    expect(dialog()?.textContent).toContain("Who can use Hangar");
    await click(button("Done") as HTMLButtonElement);
    expect(dialog()).toBeNull();

    const top = button("Operation settings");
    if (!top) throw new Error("no top bar button");
    await click(top);
    await settle();
    expect(dialog()?.textContent).toContain("People with access");
  });

  test("grant, change and revoke", async () => {
    useOperationsStore.setState({ operations: [operationInfo("manage")] });
    const f = fakeServer([{ userId: "me", displayName: "Mia Manager", access: "manage" }]);
    await mount(<OperationSettingsDialogHost api={createOperationsApi({ fetch: f.fetch })} />);
    await openPanel();
    expect(text()).toContain("Owners and admins can always manage every operation: Ada Owner.");
    expect(text()).toContain("Mia Manager (you)");

    // Candidates: not owners/admins and not people already on the operation.
    const picker = labelled("People to add");
    expect(picker?.textContent).toContain("Ben Member");
    expect(picker?.textContent).toContain("Vic Viewer");
    expect(picker?.textContent).not.toContain("Ada Owner");
    expect(picker?.textContent).not.toContain("Mia Manager");

    // Grant: tick Ben and Vic, choose Manage; Vic, an office viewer, is sent view.
    for (const box of picker?.querySelectorAll("input[type=checkbox]") ?? []) await click(box);
    await choose(labelled("Access for the people you add"), "manage");
    await click(button("Add 2 people") as HTMLButtonElement);
    await settle();
    const puts = f.calls.filter((c) => c.method === "PUT");
    expect(puts.map((c) => [c.path, c.body])).toEqual([
      [`/api/operations/${OPERATION_ID}/members/u2`, { access: "manage" }],
      [`/api/operations/${OPERATION_ID}/members/u3`, { access: "view" }],
    ]);
    const list = labelled("People with access");
    expect(list?.textContent).toContain("Ben Member");
    expect(list?.textContent).toContain("Office viewer: can only watch");
    expect(labelled("People to add")).toBeNull();
    expect(text()).toContain("Everyone in the office can already use this operation.");
    expect(text()).toContain("Added Ben Member, Vic Viewer.");

    // Change Ben to Spawn henchmen.
    await choose(labelled("Access for Ben Member"), "spawn");
    expect(f.calls.at(-3)).toMatchObject({ method: "PUT", body: { access: "spawn" } });
    expect(labelled<HTMLSelectElement>("Access for Ben Member")?.value).toBe("spawn");
    expect(text()).toContain("Ben Member now has Spawn henchmen access.");

    // Revoke Ben.
    await click(labelled("Remove Ben Member") as HTMLButtonElement);
    await settle();
    expect(f.calls.some((c) => c.method === "DELETE")).toBe(true);
    expect(labelled("People with access")?.textContent).not.toContain("Ben Member");
    expect(labelled("People to add")?.textContent).toContain("Ben Member");
    expect(text()).toContain("Ben Member no longer has access.");
  });

  test("a refused call is explained", async () => {
    useOperationsStore.setState({ operations: [operationInfo("manage")] });
    const f = fakeFetch({
      [`GET /api/operations/${OPERATION_ID}/members`]: { body: { members: [] } },
      "GET /api/users": { body: { users: PEOPLE } },
      [`PUT /api/operations/${OPERATION_ID}/members/u2`]: {
        status: 403,
        body: { error: "operation_manage_required" },
      },
    });
    await mount(<OperationSettingsDialogHost api={createOperationsApi({ fetch: f.fetch })} />);
    await openPanel();
    const ben = Array.from(document.querySelectorAll("label")).find((l) =>
      l.textContent?.includes("Ben Member"),
    );
    await click(ben?.querySelector("input") as HTMLInputElement);
    await click(button("Add 1 person") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("You need manage access to this operation");
  });

  test("after a room is placed, Add people opens the new operation's settings", async () => {
    signedInAs("owner");
    useOperationsStore.setState({ operations: [operationInfo("manage")] });
    const f = fakeServer([]);
    const api = createOperationsApi({ fetch: f.fetch });
    await mount(
      <>
        <OperationAddedPanel operationId={OPERATION_ID} api={api} />
        <OperationSettingsDialogHost api={api} />
      </>,
    );
    expect(text()).toContain("Operation set up");
    await click(button("Add people…") as HTMLButtonElement);
    await settle();
    expect(useUiStore.getState().overlay).toBe(operationSettingsOverlay(OPERATION_ID));
    expect(text()).toContain("Who can use Hangar");
    // The status panel closes itself (its host then unmounts it).
    expect(useBuildModeStore.getState().added).toBeNull();
  });
});
