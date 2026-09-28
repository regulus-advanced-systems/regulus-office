import { describe, expect, test } from "bun:test";
import { act } from "react";
import { MemoryRouter } from "react-router";
import { useUiStore } from "../../state/ui.ts";
import { click, mount, useDom } from "../a11y/dom.ts";
import { UiKitPage } from "./UiKitPage.tsx";

useDom();

describe("/ui-kit", () => {
  test("renders every section and the live toast/dialog plumbing works", async () => {
    const m = await mount(
      <MemoryRouter>
        <UiKitPage />
      </MemoryRouter>,
    );
    for (const id of ["tokens", "buttons", "panels", "feedback", "hud"]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    // Static previews: four toast kinds and two inline modals.
    expect(document.querySelectorAll(".rg-toast").length).toBe(4);
    expect(document.querySelectorAll(".rg-modal").length).toBe(2);

    const pushInfo = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("push info"),
    );
    await click(pushInfo as HTMLElement);
    expect(document.querySelectorAll("[role=status]").length).toBeGreaterThanOrEqual(1);
    await act(async () => useUiStore.getState().clearToasts());

    // Seeding fake floors fills the elevator.
    const seed = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Seed fake floors"),
    );
    await click(seed as HTMLElement);
    expect(document.querySelectorAll(".rg-list__item").length).toBe(3);
    expect(document.querySelector(".rg-list__item[aria-current=true]")?.textContent).toContain(
      "Regulus Web",
    );
    await m.unmount();
  });
});
