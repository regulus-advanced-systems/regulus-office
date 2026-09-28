import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { FloorInfo, UserRole } from "@regulus/protocol";
import { act } from "react";
import { useFloorsStore } from "../../state/floors.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount as mountNode, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import { ADD_FLOOR_OVERLAY, AddFloorDialogHost } from "./AddFloorDialog.tsx";
import { createFloorsApi } from "./api.ts";

useDom();

const TOKEN = "github_pat_FAKE_for_tests_0123456789";

const signedInAs = (role: UserRole) =>
  useSessionStore.setState({
    status: "authenticated",
    user: { id: "u1", displayName: "Ante", role },
    error: null,
  });

/** The form is uncontrolled: setting the DOM value is what typing does. */
async function typeInto(el: Element | null, value: string) {
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  await act(async () => {
    el.value = value;
  });
}

const mounted: Mounted[] = [];
async function mount(node: Parameters<typeof mountNode>[0]) {
  const m = await mountNode(node);
  mounted.push(m);
  return m;
}

const byLabel = (label: string) => document.querySelector(`[aria-label="${label}"]`);

function created(body: { name: string }): FloorInfo {
  return {
    floorId: "f1",
    name: body.name,
    slug: "apollo",
    index: 1,
    paletteId: "oak-sky",
    layoutTemplateId: "office-l2",
    archivedAt: null,
    access: "manage",
    repos: [
      {
        repoId: "r1",
        owner: "octo",
        name: "hello",
        url: "https://github.com/octo/hello",
        defaultBranch: "main",
        isPrimary: true,
        cloneStatus: "cloning",
        cloneError: null,
        hasCredential: true,
      },
    ],
  };
}

describe("Add floor dialog", () => {
  beforeEach(() => {
    act(() => useUiStore.setState({ overlay: null }));
    useFloorsStore.getState().clear();
  });
  // Leave nothing behind for other test files sharing this process: unmount
  // (removing the portalled modal), flush React's scheduler, reset stores.
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

  test("members never get the dialog", async () => {
    signedInAs("member");
    await mount(<AddFloorDialogHost api={createFloorsApi({ fetch: fakeFetch({}).fetch })} />);
    await act(async () => useUiStore.getState().openOverlay(ADD_FLOOR_OVERLAY));
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  test("an admin creates a floor with a token, then sees clone status", async () => {
    signedInAs("admin");
    const f = fakeFetch({
      "POST /api/floors": ({ body }) => ({ status: 201, body: created(body as { name: string }) }),
    });
    await mount(<AddFloorDialogHost api={createFloorsApi({ fetch: f.fetch })} />);
    await act(async () => useUiStore.getState().openOverlay(ADD_FLOOR_OVERLAY));
    expect(text()).toContain("Add floor");

    const nameInput = Array.from(document.querySelectorAll("label"))
      .find((l) => l.textContent === "Floor name")
      ?.getAttribute("for");
    await typeInto(document.getElementById(nameInput ?? ""), "Apollo");
    await typeInto(byLabel("Repo 1"), "octo/hello");
    await typeInto(byLabel("Access token for repo 1"), TOKEN);
    const form = document.querySelector('form[aria-label="Add floor"]');
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(f.calls[0]?.body).toEqual({
      name: "Apollo",
      tier: "medium",
      repos: [{ repo: "octo/hello", token: TOKEN }],
    });
    expect(text()).toContain("Floor added");
    expect(text()).toContain("octo/hello");
    expect(text()).toContain("Cloning…");
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(useFloorsStore.getState().floors?.map((x) => x.floorId)).toEqual(["f1"]);
    const done = button("Done");
    if (done) await click(done);
    expect(useUiStore.getState().overlay).toBeNull();
  });

  test("server errors are explained", async () => {
    signedInAs("owner");
    const f = fakeFetch({
      "POST /api/floors": { status: 400, body: { error: "unsupported_host", repo: 0 } },
    });
    await mount(<AddFloorDialogHost api={createFloorsApi({ fetch: f.fetch })} />);
    await act(async () => useUiStore.getState().openOverlay(ADD_FLOOR_OVERLAY));
    const nameId = Array.from(document.querySelectorAll("label"))
      .find((l) => l.textContent === "Floor name")
      ?.getAttribute("for");
    await typeInto(document.getElementById(nameId ?? ""), "X");
    await typeInto(byLabel("Repo 1"), "https://gitlab.com/o/r");
    const form = document.querySelector('form[aria-label="Add floor"]');
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(text()).toContain("repo 1 is not on github.com");
  });
});
