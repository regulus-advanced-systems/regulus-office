import { describe, expect, test } from "bun:test";
import { act } from "react";
import { useViewStore } from "../../state/view.ts";
import { click, mount, useDom } from "../a11y/dom.ts";
import { DEFAULT_HOTKEYS, dispatchHotkey } from "../hotkeys/registry.ts";
import { useViewHotkey, ViewToggle, viewHint } from "./ViewToggle.tsx";

useDom();

function HotkeyHost() {
  useViewHotkey();
  return null;
}

const reset = () =>
  act(async () =>
    useViewStore.setState({
      mode: "third_person",
      cameraMode: "third_person",
      fade: null,
      pointerLocked: false,
    }),
  );

describe("ViewToggle", () => {
  test("button reflects and flips the view store", async () => {
    await reset();
    const m = await mount(<ViewToggle />);
    const button = document.querySelector("button[aria-pressed]") as HTMLButtonElement;
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.textContent).toContain("V");
    expect(document.querySelector(".rg-viewtoggle__hint")).toBeNull();
    await click(button);
    expect(useViewStore.getState().mode).toBe("first_person");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".rg-viewtoggle__hint")?.textContent).toBe(viewHint(false));
    await act(async () => useViewStore.getState().setPointerLocked(true));
    expect(document.querySelector(".rg-viewtoggle__hint")?.textContent).toBe(viewHint(true));
    await click(button);
    expect(useViewStore.getState().mode).toBe("third_person");
    await m.unmount();
  });

  test("the toggleView hotkey event toggles once; other hotkeys are ignored", async () => {
    await reset();
    const m = await mount(<HotkeyHost />);
    const toggleView = DEFAULT_HOTKEYS.find((b) => b.id === "toggleView");
    const floorMenu = DEFAULT_HOTKEYS.find((b) => b.id === "floorMenu");
    if (!toggleView || !floorMenu) throw new Error("default hotkeys missing");
    await act(async () => dispatchHotkey(floorMenu));
    expect(useViewStore.getState().mode).toBe("third_person");
    await act(async () => dispatchHotkey(toggleView));
    expect(useViewStore.getState().mode).toBe("first_person");
    await act(async () => dispatchHotkey(toggleView));
    expect(useViewStore.getState().mode).toBe("third_person");
    await m.unmount();
    await act(async () => dispatchHotkey(toggleView));
    expect(useViewStore.getState().mode).toBe("third_person");
  });
});
