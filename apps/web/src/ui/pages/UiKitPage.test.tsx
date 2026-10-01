import { beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { MemoryRouter } from "react-router";
import { useFloorsStore } from "../../state/floors.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, mount, useDom } from "../a11y/dom.ts";
import { UiKitPage } from "./UiKitPage.tsx";

useDom();

describe("/ui-kit", () => {
  // The elevator filters by the REST floor list; start without one. The page mounts the live
  // Toaster, which shows the shared store's queue: drop toasts an earlier test left (#229).
  beforeEach(() =>
    act(() => {
      useFloorsStore.getState().clear();
      useUiStore.getState().clearToasts();
    }),
  );

  test("renders every section and the live toast/dialog plumbing works", async () => {
    const m = await mount(
      <MemoryRouter>
        <UiKitPage />
      </MemoryRouter>,
    );
    for (const id of ["tokens", "buttons", "panels", "feedback", "hud"]) {
      expect(m.container.querySelector(`#${id}`)).not.toBeNull();
    }
    // Static previews: four toast kinds and two inline modals.
    expect(m.container.querySelectorAll(".rg-toast").length).toBe(4);
    expect(m.container.querySelectorAll(".rg-modal").length).toBe(2);

    const pushInfo = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("push info"),
    );
    await click(pushInfo as HTMLElement);
    expect(document.querySelectorAll("[role=status]").length).toBeGreaterThanOrEqual(1);
    await act(async () => useUiStore.getState().clearToasts());

    // The rooms panel (#186, the elevator's successor) says where you are and offers quick travel.
    const seed = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Seed fake operations"),
    );
    await click(seed as HTMLElement);
    const rooms = m.container.querySelector('nav[aria-label="Rooms"]');
    expect(rooms?.textContent).toContain("You are in Lobby");
    expect(rooms?.textContent).toContain("Quick travel (F)");
    await m.unmount();
  });
});
