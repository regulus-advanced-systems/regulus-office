/**
 * Danger zone of Operation settings and Settings → Operations (#150): only office
 * owners and admins see them; archive, restore, and delete with the typed
 * name, the henchmen in the way and "Send all home".
 */
import { afterEach, describe, expect, test } from "bun:test";
import type { OperationHenchmanInfo, OperationInfo, UserRole } from "@regulus/protocol";
import { act } from "react";
import { useOperationsStore } from "../../state/operations.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount as mountNode, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { inputByLabel, settle, text } from "../auth/testDom.tsx";
import { OperationsSection } from "../settings/OperationsSection.tsx";
import { createOperationsApi } from "./api.ts";
import { OperationSettingsDialogHost } from "./OperationSettingsDialog.tsx";
import { operationSettingsOverlay } from "./operationSettings.ts";

useDom();

const OPERATION_ID = "f1";
const BASE = `/api/operations/${OPERATION_ID}`;

const operationInfo = (archivedAt: number | null = null): OperationInfo => ({
  operationId: OPERATION_ID,
  name: "Hangar",
  slug: "hangar",
  index: 1,
  paletteId: "oak-sky",
  layoutTemplateId: "office-l2",
  archivedAt,
  access: "manage",
  repos: [],
});

const HENCHMAN: OperationHenchmanInfo = {
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
  await act(async () => useUiStore.getState().openOverlay(operationSettingsOverlay(OPERATION_ID)));
  await settle();
}

/**
 * A controlled input. react-dom is imported before happy-dom registers, so it
 * uses its no-`input`-event fallback: a keyup on the focused element whose
 * value moved (as in FirstPersonSettings.test.tsx).
 */
async function typeName(value: string) {
  const input = inputByLabel("Type the operation name to confirm");
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
    useOperationsStore.getState().clear();
    useSessionStore.setState({ status: "unknown", user: null, error: null });
  });
  for (const el of document.querySelectorAll(".rg-backdrop")) el.remove();
});

const membersRoutes = {
  [`GET ${BASE}/members`]: { body: { members: [] } },
  "GET /api/users": { body: { users: [] } },
};

describe("Operation settings danger zone", () => {
  test("an operation manager who is not an owner or admin does not get it", async () => {
    signedInAs("member");
    useOperationsStore.setState({ operations: [operationInfo()] });
    const f = fakeFetch(membersRoutes);
    await mount(<OperationSettingsDialogHost api={createOperationsApi({ fetch: f.fetch })} />);
    await openPanel();
    expect(dialog()?.textContent).toContain("Who can use Hangar");
    expect(document.querySelector('[aria-label="Danger zone"]')).toBeNull();
    expect(exactButton("Archive operation")).toBeUndefined();
  });

  test("an admin archives the operation; the dialog closes when it leaves the list", async () => {
    signedInAs("admin");
    useOperationsStore.setState({ operations: [operationInfo()] });
    const f = fakeFetch({
      ...membersRoutes,
      [`POST ${BASE}/archive`]: { status: 204 },
      "GET /api/operations": { body: { operations: [] } },
    });
    await mount(<OperationSettingsDialogHost api={createOperationsApi({ fetch: f.fetch })} />);
    await openPanel();
    await click(exactButton("Archive operation") as HTMLButtonElement);
    await settle();
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toContain(`POST ${BASE}/archive`);
    expect(dialog()).toBeNull();
  });

  test("delete needs the name, lists the henchmen, sends them home, then deletes", async () => {
    signedInAs("owner");
    useOperationsStore.setState({ operations: [operationInfo()] });
    let henchmenHome = false;
    const f = fakeFetch({
      ...membersRoutes,
      [`POST ${BASE}/send-home`]: () => {
        henchmenHome = true;
        return { body: { sentHome: 1, failed: [] } };
      },
      [`DELETE ${BASE}`]: () =>
        henchmenHome
          ? { status: 204 }
          : { status: 409, body: { error: "operation_has_henchmen", henchmen: [HENCHMAN] } },
      "GET /api/operations": { body: { operations: [] } },
    });
    await mount(<OperationSettingsDialogHost api={createOperationsApi({ fetch: f.fetch })} />);
    await openPanel();
    await click(exactButton("Delete operation…") as HTMLButtonElement);
    const remove = () => exactButton("Delete operation") as HTMLButtonElement;
    expect(text()).toContain("Nothing on GitHub is deleted.");
    expect(remove().disabled).toBe(true);
    await typeName("hangar");
    expect(remove().disabled).toBe(true);
    await typeName("Hangar");
    expect(remove().disabled).toBe(false);

    await click(remove());
    await settle();
    const henchmen = document.querySelector('[aria-label="Henchmen in this operation"]');
    expect(henchmen?.textContent).toContain("Fix the login page (Ben Member, working)");
    expect(text()).toContain("Henchmen are still working in this operation.");
    await click(exactButton("Send all home") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("Sent 1 henchman home. You can delete the operation now.");
    expect(document.querySelector('[aria-label="Henchmen in this operation"]')).toBeNull();

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

describe("Settings → Operations", () => {
  test("members see nothing and nothing is fetched", async () => {
    signedInAs("member");
    const f = fakeFetch({});
    await mount(<OperationsSection api={createOperationsApi({ fetch: f.fetch })} />);
    expect(document.querySelector('[aria-label="Operations"]')).toBeNull();
    expect(f.calls).toEqual([]);
  });

  test("owners list archived operations and restore one", async () => {
    signedInAs("owner");
    let archived = [operationInfo(Date.UTC(2026, 8, 29))];
    const f = fakeFetch({
      "GET /api/operations/archived": () => ({ body: { operations: archived } }),
      [`POST ${BASE}/restore`]: () => {
        archived = [];
        return { body: operationInfo() };
      },
      "GET /api/operations": { body: { operations: [operationInfo()] } },
    });
    await mount(<OperationsSection api={createOperationsApi({ fetch: f.fetch })} />);
    const list = document.querySelector('[aria-label="Archived operations"]');
    expect(list?.textContent).toContain("Hangar");
    await click(document.querySelector('[aria-label="Restore Hangar"]') as HTMLButtonElement);
    await settle();
    expect(text()).toContain("Hangar is back in the compound.");
    expect(text()).toContain("No archived operations.");
    expect(useOperationsStore.getState().operations?.map((fl) => fl.name)).toEqual(["Hangar"]);
  });

  test("an archived operation can be deleted from there too", async () => {
    signedInAs("admin");
    let archived = [operationInfo(Date.UTC(2026, 8, 29))];
    const f = fakeFetch({
      "GET /api/operations/archived": () => ({ body: { operations: archived } }),
      [`DELETE ${BASE}`]: () => {
        archived = [];
        return { status: 204 };
      },
    });
    await mount(<OperationsSection api={createOperationsApi({ fetch: f.fetch })} />);
    await click(document.querySelector('[aria-label="Delete Hangar…"]') as HTMLButtonElement);
    await typeName("Hangar");
    await click(exactButton("Delete operation") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("Hangar was deleted.");
    expect(text()).toContain("No archived operations.");
  });
});
