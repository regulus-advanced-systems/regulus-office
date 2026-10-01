import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { UserRole } from "@regulus/protocol";
import { act } from "react";
import { testWorld } from "../../scene/compound/testing.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { useFloorsStore } from "../../state/floors.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount as mountNode, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { settle, text } from "../auth/testDom.tsx";
import { createCompoundApi } from "../build-mode/api.ts";
import { confirmBuild } from "../build-mode/BuildModeHost.tsx";
import { BUILD_MODE_OVERLAY, useBuildModeStore } from "../build-mode/store.ts";
import { ADD_FLOOR_OVERLAY, AddFloorDialogHost } from "./AddFloorDialog.tsx";

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

const nameField = () =>
  document.getElementById(
    Array.from(document.querySelectorAll("label"))
      .find((l) => l.textContent === "Floor name")
      ?.getAttribute("for") ?? "",
  );

async function submit() {
  const form = document.querySelector('form[aria-label="Add floor"]');
  await act(async () => {
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

describe("Add floor dialog", () => {
  beforeEach(() => {
    act(() => useUiStore.setState({ overlay: null }));
    useFloorsStore.getState().clear();
    useCompoundStore.getState().set(testWorld([]));
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
      useBuildModeStore.getState().cancel();
      useBuildModeStore.setState({ added: null, watching: null, returnZoom: null });
      useCompoundStore.getState().set(null);
    });
    for (const el of document.querySelectorAll(".rg-backdrop")) el.remove();
  });

  test("members never get the dialog", async () => {
    signedInAs("member");
    await mount(<AddFloorDialogHost />);
    await act(async () => useUiStore.getState().openOverlay(ADD_FLOOR_OVERLAY));
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  test("an admin names the floor and its repos, then picks the spot in build mode", async () => {
    signedInAs("admin");
    await mount(<AddFloorDialogHost />);
    await act(async () => useUiStore.getState().openOverlay(ADD_FLOOR_OVERLAY));
    expect(text()).toContain("Add floor");
    expect(text()).not.toContain("Size");

    await typeInto(nameField(), "Apollo");
    await typeInto(byLabel("Repo 1"), "octo/hello");
    await typeInto(byLabel("Access token for repo 1"), TOKEN);
    await submit();

    // Build mode holds the request (token included) until the room is placed; the page does not.
    const intent = useBuildModeStore.getState().intent;
    expect(intent).toEqual({
      kind: "create",
      request: { name: "Apollo", repos: [{ repo: "octo/hello", token: TOKEN }] },
    });
    expect(useUiStore.getState().overlay).toBe(BUILD_MODE_OVERLAY);
    expect(document.body.innerHTML).not.toContain(TOKEN);
    // The ghost starts on a free spot of the compound.
    expect(useBuildModeStore.getState().ghost.y).toBeGreaterThan(0);
  });

  test("a refusal build mode cannot fix goes back to the dialog, without the token", async () => {
    signedInAs("owner");
    await mount(<AddFloorDialogHost />);
    await act(async () => useUiStore.getState().openOverlay(ADD_FLOOR_OVERLAY));
    await typeInto(nameField(), "X");
    await typeInto(byLabel("Repo 1"), "https://gitlab.com/o/r");
    await typeInto(byLabel("Access token for repo 1"), TOKEN);
    await submit();
    const f = fakeFetch({
      "POST /api/compound/rooms": { status: 400, body: { error: "unsupported_host", repo: 0 } },
    });
    await act(() => confirmBuild(createCompoundApi({ fetch: f.fetch })));
    await settle();
    expect(f.calls[0]?.body).toMatchObject({ name: "X", placement: { width: 8, depth: 8 } });
    expect(useBuildModeStore.getState().intent).toBeNull();
    expect(useUiStore.getState().overlay).toBe(ADD_FLOOR_OVERLAY);
    expect(text()).toContain("repo 1 is not on github.com");
    expect((nameField() as HTMLInputElement).value).toBe("X");
    expect((byLabel("Repo 1") as HTMLInputElement).value).toBe("https://gitlab.com/o/r");
    expect((byLabel("Access token for repo 1") as HTMLInputElement).value).toBe("");
  });
});
