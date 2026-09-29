import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  BuildingState,
  FloorInfo,
  FloorMemberInfo,
  FloorSummary,
  OfficeUserInfo,
  UserRole,
} from "@regulus/protocol";
import { act } from "react";
import { useBuildingStore } from "../../state/building.ts";
import { useFloorStore } from "../../state/floor.ts";
import { useFloorsStore } from "../../state/floors.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount as mountNode, useDom } from "../a11y/dom.ts";
import { type FakeCall, fakeFetch } from "../auth/fakeFetch.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import { ElevatorPanel } from "../hud/ElevatorPanel.tsx";
import { TopBar } from "../hud/TopBar.tsx";
import { ADD_FLOOR_OVERLAY, AddFloorDialogHost } from "./AddFloorDialog.tsx";
import { createFloorsApi } from "./api.ts";
import { FloorSettingsDialogHost } from "./FloorSettingsDialog.tsx";
import { floorSettingsOverlay } from "./floorSettings.ts";

useDom();

const FLOOR_ID = "f1";

const floorInfo = (access: FloorInfo["access"]): FloorInfo => ({
  floorId: FLOOR_ID,
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
function fakeServer(initial: FloorMemberInfo[]) {
  let members = [...initial];
  const base = `/api/floors/${FLOOR_ID}/members`;
  const put = ({ path, body }: FakeCall) => {
    const userId = path.slice(base.length + 1);
    const access = (body as { access: FloorMemberInfo["access"] }).access;
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
  await act(async () => useUiStore.getState().openOverlay(floorSettingsOverlay(FLOOR_ID)));
  await settle();
}

describe("floor settings panel", () => {
  beforeEach(() => {
    signedInAs("member");
  });
  afterEach(async () => {
    for (const m of mounted.splice(0)) await m.unmount();
    await settle();
    await act(async () => {
      useUiStore.setState({ overlay: null });
      useFloorsStore.getState().clear();
      useFloorStore.getState().clear();
      useBuildingStore.getState().clear();
      useSessionStore.setState({ status: "unknown", user: null, error: null });
    });
    for (const el of document.querySelectorAll(".rg-backdrop")) el.remove();
  });

  test("members without manage get neither the panel nor its buttons", async () => {
    useFloorsStore.setState({ floors: [floorInfo("spawn")] });
    useFloorStore.setState({ floorId: FLOOR_ID });
    const f = fakeServer([]);
    await mount(
      <>
        <TopBar />
        <FloorSettingsDialogHost api={createFloorsApi({ fetch: f.fetch })} />
      </>,
    );
    expect(button("Floor settings")).toBeUndefined();
    await openPanel();
    expect(dialog()).toBeNull();
    expect(f.calls).toEqual([]);
    // The stray overlay is released so hotkeys work again.
    expect(useUiStore.getState().overlay).toBeNull();
  });

  test("a floor manager opens it from the top bar and the elevator", async () => {
    useFloorsStore.setState({ floors: [floorInfo("manage")] });
    useFloorStore.setState({ floorId: FLOOR_ID });
    const summary = { floorId: FLOOR_ID, name: "Hangar", index: 1, paletteId: "oak-sky" };
    useBuildingStore.setState({
      state: { floors: { [FLOOR_ID]: summary as FloorSummary } } as unknown as BuildingState,
    });
    const f = fakeServer([]);
    await mount(
      <>
        <TopBar />
        <ElevatorPanel />
        <FloorSettingsDialogHost api={createFloorsApi({ fetch: f.fetch })} />
      </>,
    );
    const gear = labelled<HTMLButtonElement>("Floor settings: Hangar");
    if (!gear) throw new Error("no elevator gear");
    await click(gear);
    await settle();
    expect(dialog()?.textContent).toContain("Who can use Hangar");
    await click(button("Done") as HTMLButtonElement);
    expect(dialog()).toBeNull();

    const top = button("Floor settings");
    if (!top) throw new Error("no top bar button");
    await click(top);
    await settle();
    expect(dialog()?.textContent).toContain("People with access");
  });

  test("grant, change and revoke", async () => {
    useFloorsStore.setState({ floors: [floorInfo("manage")] });
    const f = fakeServer([{ userId: "me", displayName: "Mia Manager", access: "manage" }]);
    await mount(<FloorSettingsDialogHost api={createFloorsApi({ fetch: f.fetch })} />);
    await openPanel();
    expect(text()).toContain("Owners and admins can always manage every floor: Ada Owner.");
    expect(text()).toContain("Mia Manager (you)");

    // Candidates: not owners/admins and not people already on the floor.
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
      [`/api/floors/${FLOOR_ID}/members/u2`, { access: "manage" }],
      [`/api/floors/${FLOOR_ID}/members/u3`, { access: "view" }],
    ]);
    const list = labelled("People with access");
    expect(list?.textContent).toContain("Ben Member");
    expect(list?.textContent).toContain("Office viewer: can only watch");
    expect(labelled("People to add")).toBeNull();
    expect(text()).toContain("Everyone in the office can already use this floor.");
    expect(text()).toContain("Added Ben Member, Vic Viewer.");

    // Change Ben to Spawn robots.
    await choose(labelled("Access for Ben Member"), "spawn");
    expect(f.calls.at(-3)).toMatchObject({ method: "PUT", body: { access: "spawn" } });
    expect(labelled<HTMLSelectElement>("Access for Ben Member")?.value).toBe("spawn");
    expect(text()).toContain("Ben Member now has Spawn robots access.");

    // Revoke Ben.
    await click(labelled("Remove Ben Member") as HTMLButtonElement);
    await settle();
    expect(f.calls.some((c) => c.method === "DELETE")).toBe(true);
    expect(labelled("People with access")?.textContent).not.toContain("Ben Member");
    expect(labelled("People to add")?.textContent).toContain("Ben Member");
    expect(text()).toContain("Ben Member no longer has access.");
  });

  test("a refused call is explained", async () => {
    useFloorsStore.setState({ floors: [floorInfo("manage")] });
    const f = fakeFetch({
      [`GET /api/floors/${FLOOR_ID}/members`]: { body: { members: [] } },
      "GET /api/users": { body: { users: PEOPLE } },
      [`PUT /api/floors/${FLOOR_ID}/members/u2`]: {
        status: 403,
        body: { error: "floor_manage_required" },
      },
    });
    await mount(<FloorSettingsDialogHost api={createFloorsApi({ fetch: f.fetch })} />);
    await openPanel();
    const ben = Array.from(document.querySelectorAll("label")).find((l) =>
      l.textContent?.includes("Ben Member"),
    );
    await click(ben?.querySelector("input") as HTMLInputElement);
    await click(button("Add 1 person") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("You need manage access to this floor");
  });

  test("after Add floor, Add people opens the new floor's settings", async () => {
    signedInAs("owner");
    useFloorsStore.setState({ floors: [floorInfo("manage")] });
    const f = fakeServer([]);
    const api = createFloorsApi({ fetch: f.fetch });
    await mount(
      <>
        <AddFloorDialogHost api={api} />
        <FloorSettingsDialogHost api={api} />
      </>,
    );
    await act(async () => useUiStore.getState().openOverlay(ADD_FLOOR_OVERLAY));
    const form = document.querySelector('form[aria-label="Add floor"]') as HTMLFormElement;
    (form.querySelector('input[name="name"]') as HTMLInputElement).value = "Hangar";
    (form.querySelector('input[name^="repo-"]') as HTMLInputElement).value = "octo/hello";
    const created = fakeFetch({ "POST /api/floors": { status: 201, body: floorInfo("manage") } });
    // Creating goes through its own fake; the settings panel keeps the members fake.
    await mounted[0]?.rerender(
      <>
        <AddFloorDialogHost api={createFloorsApi({ fetch: created.fetch })} />
        <FloorSettingsDialogHost api={api} />
      </>,
    );
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(text()).toContain("Floor added");
    await click(button("Add people…") as HTMLButtonElement);
    await settle();
    expect(useUiStore.getState().overlay).toBe(floorSettingsOverlay(FLOOR_ID));
    expect(dialog()?.textContent).toContain("Who can use Hangar");
  });
});
