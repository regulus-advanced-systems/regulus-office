import { describe, expect, test } from "bun:test";
import { act } from "react";
import { useUiStore } from "../../state/ui.ts";
import { click, mount, useDom } from "../a11y/dom.ts";
import { FirstPersonSettings } from "./FirstPersonSettings.tsx";
import { DEFAULT_SETTINGS } from "./settingsStorage.ts";

useDom();

/**
 * Drive a React-controlled range input. react-dom is imported before happy-dom
 * registers, so it uses its no-`input`-event fallback: the change is picked up
 * from a keyup on the focused element whose value moved.
 */
function setRange(input: HTMLInputElement, value: number) {
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, String(value));
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true }));
}

describe("FirstPersonSettings", () => {
  test("sliders update the FOV and sensitivity settings; reset restores them", async () => {
    await act(async () => useUiStore.getState().updateSettings({ ...DEFAULT_SETTINGS }));
    const m = await mount(<FirstPersonSettings />);
    const [fov, sens] = Array.from(
      document.querySelectorAll<HTMLInputElement>('[data-testid="settings-first-person"] input'),
    );
    if (!fov || !sens) throw new Error("sliders missing");
    expect(fov.min).toBe("50");
    expect(fov.max).toBe("75");
    expect(fov.value).toBe("60");
    expect(sens.value).toBe("1");
    expect(document.body.textContent).not.toContain("Use recommended");

    await act(async () => setRange(fov, 68));
    await act(async () => setRange(sens, 1.5));
    expect(useUiStore.getState().settings.fpvFov).toBe(68);
    expect(useUiStore.getState().settings.mouseSensitivity).toBe(1.5);
    expect(document.body.textContent).toContain("68°");

    const reset = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Use recommended"),
    );
    if (!reset) throw new Error("reset button missing");
    await click(reset);
    expect(useUiStore.getState().settings.fpvFov).toBe(60);
    expect(useUiStore.getState().settings.mouseSensitivity).toBe(1);
    await m.unmount();
  });
});
