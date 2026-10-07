import { describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { click, mount, press, useDom } from "../ui/a11y/dom.ts";
import { Modal } from "../ui/components/Modal.tsx";
import { useUiStore } from "./ui.ts";
import { anyWindowOpen, isWindowOpen, useWindowStore } from "./windows.ts";

useDom();

/** One modal that can open a second one, as a settings dialog opens a confirm. */
function Two() {
  const [first, setFirst] = useState(false);
  const [second, setSecond] = useState(false);
  return (
    <>
      <button type="button" id="open" onClick={() => setFirst(true)}>
        open
      </button>
      <Modal open={first} onClose={() => setFirst(false)} title="First">
        <button type="button" id="more" onClick={() => setSecond(true)}>
          more
        </button>
      </Modal>
      <Modal open={second} onClose={() => setSecond(false)} title="Second">
        second
      </Modal>
      <Modal open inline onClose={() => {}} title="Preview">
        an inline ui-kit preview is not a window
      </Modal>
    </>
  );
}

const byId = (id: string) => document.getElementById(id) as HTMLElement;

describe("open windows (#282)", () => {
  test("a HUD overlay or any modal is an open window", () => {
    expect(isWindowOpen(null, 0)).toBe(false);
    expect(isWindowOpen("issue-board", 0)).toBe(true);
    expect(isWindowOpen(null, 1)).toBe(true);
  });

  test("every Modal counts itself, however it is closed, and one opened from another", async () => {
    const m = await mount(<Two />);
    expect(useWindowStore.getState().modals).toBe(0);
    expect(anyWindowOpen()).toBe(false);

    await click(byId("open"));
    expect(useWindowStore.getState().modals).toBe(1);
    expect(anyWindowOpen()).toBe(true);

    // A second window from the first: a window stays open throughout.
    await click(byId("more"));
    expect(useWindowStore.getState().modals).toBe(2);
    // Escape closes the one on top, the X closes the other.
    await press(document.activeElement as Element, "Escape");
    expect(useWindowStore.getState().modals).toBe(1);
    expect(anyWindowOpen()).toBe(true);
    await click(document.querySelector("body > .rg-backdrop .rg-modal__close") as HTMLElement);
    expect(useWindowStore.getState().modals).toBe(0);
    expect(anyWindowOpen()).toBe(false);

    // Unmounted while open (its host went away): the count still comes back.
    await click(byId("open"));
    expect(useWindowStore.getState().modals).toBe(1);
    await m.unmount();
    expect(useWindowStore.getState().modals).toBe(0);
  });

  test("windows that are not a Modal count through the HUD overlay", async () => {
    await act(async () => useUiStore.getState().openOverlay("terminal"));
    expect(anyWindowOpen()).toBe(true);
    await act(async () => useUiStore.getState().closeOverlay("terminal"));
    expect(anyWindowOpen()).toBe(false);
  });
});
