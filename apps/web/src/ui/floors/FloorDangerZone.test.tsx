/**
 * Danger zone of Floor settings and Settings → Floors (#150): only office
 * owners and admins see them; archive, restore, and delete with the typed
 * name, the robots in the way and "Send all home".
 */
import { afterEach, describe, expect, test } from "bun:test";
import type { FloorInfo, FloorRobotInfo, UserRole } from "@regulus/protocol";
import { act } from "react";
import { useFloorsStore } from "../../state/floors.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount as mountNode, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { inputByLabel, settle, text } from "../auth/testDom.tsx";
import { FloorsSection } from "../settings/FloorsSection.tsx";
import { createFloorsApi } from "./api.ts";
import { FloorSettingsDialogHost } from "./FloorSettingsDialog.tsx";
import { floorSettingsOverlay } from "./floorSettings.ts";

useDom();

const FLOOR_ID = "f1";
const BASE = `/api/floors/${FLOOR_ID}`;

const floorInfo = (archivedAt: number | null = null): FloorInfo => ({
  floorId: FLOOR_ID,
  name: "Hangar",
  slug: "hangar",
  index: 1,
  paletteId: "oak-sky",
  layoutTemplateId: "office-l2",
  archivedAt,
  access: "manage",
  repos: [],
});

const ROBOT: FloorRobotInfo = {
  agentId: "a1",
  ownerUserId: "u2",
  ownerName: "Ben Member",
  status: "working",
  taskTitle: "Fix the login page",
  running: true,
};

const signedInAs = (role: UserRole) =>
  useSessionStore.setState({
    status: "authenticated",
    user: { id: "me", displayName: "Me", role },
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
const exactButton = (label: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);

async function openPanel() {
  await act(async () => useUiStore.getState().openOverlay(floorSettingsOverlay(FLOOR_ID)));
  await settle();
}

/**
 * A controlled input. react-dom is imported before happy-dom registers, so it
 * uses its no-`input`-event fallback: a keyup on the focused element whose
 * value moved (as in FirstPersonSettings.test.tsx).
 */
async function typeName(value: string) {
  const input = inputByLabel("Type the floor name to confirm");
  await act(async () => {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true }));
  });
}

afterEach(async () => {
  for (const m of mounted.splice(0)) await m.unmount();
  await settle();
  await act(async () => {
    useUiStore.setState({ overlay: null });
    useFloorsStore.getState().clear();
    useSessionStore.setState({ status: "unknown", user: null, error: null });
  });
  for (const el of document.querySelectorAll(".rg-backdrop")) el.remove();
});

const membersRoutes = {
  [`GET ${BASE}/members`]: { body: { members: [] } },
  "GET /api/users": { body: { users: [] } },
};

describe("Floor settings danger zone", () => {
  test("a floor manager who is not an owner or admin does not get it", async () => {
    signedInAs("member");
    useFloorsStore.setState({ floors: [floorInfo()] });
    const f = fakeFetch(membersRoutes);
    await mount(<FloorSettingsDialogHost api={createFloorsApi({ fetch: f.fetch })} />);
    await openPanel();
    expect(dialog()?.textContent).toContain("Who can use Hangar");
    expect(document.querySelector('[aria-label="Danger zone"]')).toBeNull();
    expect(exactButton("Archive floor")).toBeUndefined();
  });

  test("an admin archives the floor; the dialog closes when it leaves the list", async () => {
    signedInAs("admin");
    useFloorsStore.setState({ floors: [floorInfo()] });
    const f = fakeFetch({
      ...membersRoutes,
      [`POST ${BASE}/archive`]: { status: 204 },
      "GET /api/floors": { body: { floors: [] } },
    });
    await mount(<FloorSettingsDialogHost api={createFloorsApi({ fetch: f.fetch })} />);
    await openPanel();
    await click(exactButton("Archive floor") as HTMLButtonElement);
    await settle();
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toContain(`POST ${BASE}/archive`);
    expect(dialog()).toBeNull();
  });

  test("delete needs the name, lists the robots, sends them home, then deletes", async () => {
    signedInAs("owner");
    useFloorsStore.setState({ floors: [floorInfo()] });
    let robotsHome = false;
    const f = fakeFetch({
      ...membersRoutes,
      [`POST ${BASE}/send-home`]: () => {
        robotsHome = true;
        return { body: { sentHome: 1, failed: [] } };
      },
      [`DELETE ${BASE}`]: () =>
        robotsHome
          ? { status: 204 }
          : { status: 409, body: { error: "floor_has_robots", robots: [ROBOT] } },
      "GET /api/floors": { body: { floors: [] } },
    });
    await mount(<FloorSettingsDialogHost api={createFloorsApi({ fetch: f.fetch })} />);
    await openPanel();
    await click(exactButton("Delete floor…") as HTMLButtonElement);
    const remove = () => exactButton("Delete floor") as HTMLButtonElement;
    expect(text()).toContain("Nothing on GitHub is deleted.");
    expect(remove().disabled).toBe(true);
    await typeName("hangar");
    expect(remove().disabled).toBe(true);
    await typeName("Hangar");
    expect(remove().disabled).toBe(false);

    await click(remove());
    await settle();
    const robots = document.querySelector('[aria-label="Robots on this floor"]');
    expect(robots?.textContent).toContain("Fix the login page (Ben Member, working)");
    expect(text()).toContain("Robots are still on this floor.");
    await click(exactButton("Send all home") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("Sent 1 robot home. You can delete the floor now.");
    expect(document.querySelector('[aria-label="Robots on this floor"]')).toBeNull();

    await click(remove());
    await settle();
    const deletes = f.calls.filter((c) => c.method === "DELETE");
    expect(deletes.map((c) => c.body)).toEqual([
      { confirmName: "Hangar" },
      { confirmName: "Hangar" },
    ]);
    expect(dialog()).toBeNull();
  });
});

describe("Settings → Floors", () => {
  test("members see nothing and nothing is fetched", async () => {
    signedInAs("member");
    const f = fakeFetch({});
    await mount(<FloorsSection api={createFloorsApi({ fetch: f.fetch })} />);
    expect(document.querySelector('[aria-label="Floors"]')).toBeNull();
    expect(f.calls).toEqual([]);
  });

  test("owners list archived floors and restore one", async () => {
    signedInAs("owner");
    let archived = [floorInfo(Date.UTC(2026, 8, 29))];
    const f = fakeFetch({
      "GET /api/floors/archived": () => ({ body: { floors: archived } }),
      [`POST ${BASE}/restore`]: () => {
        archived = [];
        return { body: floorInfo() };
      },
      "GET /api/floors": { body: { floors: [floorInfo()] } },
    });
    await mount(<FloorsSection api={createFloorsApi({ fetch: f.fetch })} />);
    const list = document.querySelector('[aria-label="Archived floors"]');
    expect(list?.textContent).toContain("Hangar");
    await click(document.querySelector('[aria-label="Restore Hangar"]') as HTMLButtonElement);
    await settle();
    expect(text()).toContain("Hangar is back in the elevator.");
    expect(text()).toContain("No archived floors.");
    expect(useFloorsStore.getState().floors?.map((fl) => fl.name)).toEqual(["Hangar"]);
  });

  test("an archived floor can be deleted from there too", async () => {
    signedInAs("admin");
    let archived = [floorInfo(Date.UTC(2026, 8, 29))];
    const f = fakeFetch({
      "GET /api/floors/archived": () => ({ body: { floors: archived } }),
      [`DELETE ${BASE}`]: () => {
        archived = [];
        return { status: 204 };
      },
    });
    await mount(<FloorsSection api={createFloorsApi({ fetch: f.fetch })} />);
    await click(document.querySelector('[aria-label="Delete Hangar…"]') as HTMLButtonElement);
    await typeName("Hangar");
    await click(exactButton("Delete floor") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("Hangar was deleted.");
    expect(text()).toContain("No archived floors.");
  });
});
