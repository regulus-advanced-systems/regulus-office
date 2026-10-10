import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { useUiStore } from "../../state/ui.ts";
import { useWindowStore } from "../../state/windows.ts";
import { click, type Mounted, mount, press, useDom } from "../a11y/dom.ts";
import { settle } from "../auth/testDom.tsx";
import { Modal } from "../components/Modal.tsx";
import { SEARCH_OVERLAY_ID, useSearchStore } from "../search/searchStore.ts";
import { CommandPaletteHost } from "./CommandPalette.tsx";
import type { PaletteEntry } from "./entries.ts";
import { isTypingTarget, PALETTE_OVERLAY, paletteKeyAction } from "./hotkey.ts";
import { publish, resetStores } from "./testKit.ts";

useDom();

/** Ctrl+K (or another chord) on `target`; returns the event to see who took it. */
async function chord(target: EventTarget, init: KeyboardEventInit = { ctrlKey: true }) {
  const event = new window.KeyboardEvent("keydown", {
    key: "k",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  await settle(2);
  return event as KeyboardEvent;
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    // react-dom loaded before happy-dom registered: its keyup fallback reports the change.
    input.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true }));
  });
}

const overlay = () => useUiStore.getState().overlay;
const input = () => document.querySelector<HTMLInputElement>('[data-testid="palette-input"]');
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const optionTitles = () =>
  options().map((o) => o.querySelector(".rg-palette__title")?.textContent ?? "");
const activeTitle = () => {
  const id = input()?.getAttribute("aria-activedescendant");
  const el = id ? document.getElementById(id) : null;
  expect(el?.getAttribute("aria-selected")).toBe("true");
  return el?.querySelector(".rg-palette__title")?.textContent ?? null;
};

let mounted: Mounted | null = null;
const extra: HTMLElement[] = [];
/** Something in the page that can hold focus, outside React. */
function add<T extends HTMLElement>(el: T, parent: HTMLElement = document.body): T {
  parent.appendChild(el);
  if (parent === document.body) extra.push(el);
  return el;
}

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  for (const el of extra.splice(0)) el.remove();
  resetStores();
});

describe("Ctrl+K: whose key it is (#261)", () => {
  test("the rule: Ctrl or Cmd with K alone, nothing open, nothing being typed into", () => {
    const idle = { key: "k", ctrlKey: true, overlay: null, modals: 0 };
    expect(paletteKeyAction(idle)).toBe("open");
    expect(paletteKeyAction({ ...idle, key: "K" })).toBe("open");
    expect(paletteKeyAction({ ...idle, ctrlKey: false, metaKey: true })).toBe("open");
    expect(paletteKeyAction({ ...idle, ctrlKey: false })).toBeNull();
    expect(paletteKeyAction({ ...idle, shiftKey: true })).toBeNull();
    expect(paletteKeyAction({ ...idle, altKey: true })).toBeNull();
    expect(paletteKeyAction({ ...idle, key: "j" })).toBeNull();
    expect(paletteKeyAction({ ...idle, repeat: true })).toBeNull();
    expect(paletteKeyAction({ ...idle, defaultPrevented: true })).toBeNull();
    expect(paletteKeyAction({ ...idle, typing: true })).toBeNull();
    expect(paletteKeyAction({ ...idle, modals: 1 })).toBeNull();
    for (const open of ["terminal", "whiteboard", "settings", "build-mode", "board", "search"])
      expect(paletteKeyAction({ ...idle, overlay: open })).toBeNull();
    // Open: the same chord closes it, from its own text field too.
    expect(paletteKeyAction({ ...idle, overlay: PALETTE_OVERLAY, typing: true, modals: 1 })).toBe(
      "close",
    );
  });

  test("on the page or the canvas it opens the palette and is consumed; again closes it", async () => {
    mounted = await mount(<CommandPaletteHost />);
    const canvas = add(document.createElement("canvas"));
    const opened = await chord(canvas);
    expect(opened.defaultPrevented).toBe(true);
    expect(overlay()).toBe(PALETTE_OVERLAY);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Command palette");
    // The text field has the keyboard.
    expect(document.activeElement).toBe(input());
    const closed = await chord(input() as HTMLInputElement);
    expect(closed.defaultPrevented).toBe(true);
    expect(overlay()).toBeNull();
    expect(input()).toBeNull();
    // Cmd+K on a Mac.
    await chord(document.body, { metaKey: true });
    expect(overlay()).toBe(PALETTE_OVERLAY);
  });

  test("a focused terminal keeps Ctrl+K (kill to end of line): not opened, not prevented, not stopped", async () => {
    mounted = await mount(<CommandPaletteHost />);
    // xterm.js as it is in the page: keys go to a hidden textarea inside `.xterm`.
    const xterm = add(document.createElement("div"));
    xterm.className = "terminal xterm";
    const helper = add(document.createElement("textarea"), xterm);
    helper.className = "xterm-helper-textarea";
    // And its screen, should a key ever come from there.
    const screen = add(document.createElement("div"), xterm);
    screen.className = "xterm-screen";
    screen.tabIndex = 0;
    const seen: string[] = [];
    const after = (e: Event) => seen.push((e as KeyboardEvent).key);
    window.addEventListener("keydown", after);
    try {
      for (const el of [helper, screen]) {
        el.focus();
        expect(isTypingTarget(el)).toBe(true);
        const event = await chord(el);
        expect(event.defaultPrevented).toBe(false);
        expect(overlay()).toBeNull();
      }
      // The events went on to later listeners untouched.
      expect(seen).toEqual(["k", "k"]);
    } finally {
      window.removeEventListener("keydown", after);
    }
  });

  test("text fields and editable text keep it", async () => {
    mounted = await mount(<CommandPaletteHost />);
    const field = add(document.createElement("input"));
    const area = add(document.createElement("textarea"));
    const select = add(document.createElement("select"));
    const editable = add(document.createElement("div"));
    editable.contentEditable = "true";
    Object.defineProperty(editable, "isContentEditable", { value: true });
    for (const el of [field, area, select, editable]) {
      el.focus();
      const event = await chord(el);
      expect(event.defaultPrevented).toBe(false);
      expect(overlay()).toBeNull();
    }
    // A plain button is not typing: the palette opens from it.
    const button = add(document.createElement("button"));
    button.focus();
    expect((await chord(button)).defaultPrevented).toBe(true);
    expect(overlay()).toBe(PALETTE_OVERLAY);
  });

  test("the whiteboard keeps it (Excalidraw: insert link), by its overlay and by its own element", async () => {
    mounted = await mount(<CommandPaletteHost />);
    const board = add(document.createElement("div"));
    board.className = "excalidraw";
    const canvas = add(document.createElement("canvas"), board);
    canvas.tabIndex = 0;
    canvas.focus();
    // Even were it mounted with no overlay claimed: the element alone is enough.
    expect((await chord(canvas)).defaultPrevented).toBe(false);
    expect(overlay()).toBeNull();
    // As it is really mounted, it holds the overlay; then a key from anywhere is left alone.
    await act(async () => useUiStore.getState().openOverlay("whiteboard"));
    expect((await chord(document.body)).defaultPrevented).toBe(false);
    expect(overlay()).toBe("whiteboard");
  });

  test("an open terminal window, or any other dialog, keeps it wherever the focus is", async () => {
    mounted = await mount(
      <>
        <CommandPaletteHost />
        <Modal open onClose={() => undefined} title="Some dialog">
          <button type="button">In the dialog</button>
        </Modal>
      </>,
    );
    expect(useWindowStore.getState().modals).toBe(1);
    expect((await chord(document.body)).defaultPrevented).toBe(false);
    expect(overlay()).toBeNull();
    await mounted.unmount();
    mounted = await mount(<CommandPaletteHost />);
    await act(async () => useUiStore.getState().openOverlay("terminal"));
    expect((await chord(document.body)).defaultPrevented).toBe(false);
    expect(overlay()).toBe("terminal");
  });
});

describe("the palette by keyboard (#261)", () => {
  const picked: string[] = [];
  const run = (e: PaletteEntry) => picked.push(e.id);
  beforeEach(() => {
    picked.length = 0;
  });

  async function openWith() {
    publish();
    mounted = await mount(<CommandPaletteHost run={run} />);
    await chord(document.body);
    return input() as HTMLInputElement;
  }

  test("lists what the stores hold for this viewer; Down, Up and Enter pick without leaving the field", async () => {
    const field = await openWith();
    expect(optionTitles()).toEqual([
      "Keyboard shortcuts",
      "Go to Octo Org",
      "Go to Lobby",
      "Go to War room",
      "Go to Break room",
      "Go to Lift landing",
      "Go to Apollo",
      "Settings: You",
      "Settings: Agents",
      "Settings: Notifications",
      "Settings: Display and sound",
    ]);
    expect(field.getAttribute("role")).toBe("combobox");
    expect(activeTitle()).toBe("Keyboard shortcuts");
    await press(field, "ArrowDown");
    expect(activeTitle()).toBe("Go to Octo Org");
    await press(field, "ArrowUp");
    await press(field, "ArrowUp");
    // Wraps to the end.
    expect(activeTitle()).toBe("Settings: Display and sound");
    expect(document.activeElement).toBe(field);
    await press(field, "Enter");
    expect(picked).toEqual(["settings:display"]);
    expect(overlay()).toBeNull();
  });

  test("typing narrows the list and starts again at the best match; the last row hands over to search", async () => {
    const field = await openWith();
    await press(field, "ArrowDown");
    await type(field, "apollo");
    expect(optionTitles()).toEqual(["Go to Apollo", "Search chat and terminals for “apollo”"]);
    expect(activeTitle()).toBe("Go to Apollo");
    await press(field, "Enter");
    expect(picked).toEqual(["room:lv-octo:apollo"]);
  });

  test("a room the viewer may not enter is not found by its name", async () => {
    publish([]);
    mounted = await mount(<CommandPaletteHost run={run} />);
    await chord(document.body);
    await type(input() as HTMLInputElement, "apollo");
    expect(optionTitles()).toEqual(["Search chat and terminals for “apollo”"]);
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Go to Apollo");
  });

  test("nothing matches: it says so, and Enter on the search row opens search with the words", async () => {
    mounted = await mount(<CommandPaletteHost />);
    await chord(document.body);
    const field = input() as HTMLInputElement;
    await type(field, "segfault");
    expect(optionTitles()).toEqual(["Search chat and terminals for “segfault”"]);
    await press(field, "Enter");
    expect(overlay()).toBe(SEARCH_OVERLAY_ID);
    expect(useSearchStore.getState().query).toBe("segfault");
  });

  test("Escape closes it; a click on a row picks it too", async () => {
    const field = await openWith();
    await press(field, "Escape");
    expect(overlay()).toBeNull();
    expect(picked).toEqual([]);
    await chord(document.body);
    const row = options().find((o) => o.textContent?.includes("Go to Apollo"));
    await click(row as HTMLElement);
    expect(picked).toEqual(["room:lv-octo:apollo"]);
    expect(overlay()).toBeNull();
  });

  test("the list is read when it opens: a fixed snapshot can be passed in", async () => {
    mounted = await mount(
      <CommandPaletteHost
        run={run}
        sources={() => ({
          travel: [],
          people: [],
          rooms: {},
          currentOperationId: null,
          operations: [],
          viewer: null,
          agents: [],
        })}
      />,
    );
    await chord(document.body);
    expect(optionTitles()).toEqual([
      "Keyboard shortcuts",
      "Settings: You",
      "Settings: Agents",
      "Settings: Notifications",
      "Settings: Display and sound",
    ]);
  });
});
