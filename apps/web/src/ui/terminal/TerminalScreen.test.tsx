/**
 * #164: the terminal box's "Copy selection" / "Copy screen" buttons, and what the owner
 * sees when the browser refuses the clipboard every way (the text, selected, to copy by hand).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { click, type Mounted, mount, press, useDom } from "../a11y/dom.ts";
import type { ClipboardApi } from "./clipboard.ts";
import { FakeHost } from "./fakeHost.ts";
import { TerminalScreen } from "./TerminalScreen.tsx";
import { INITIAL_TERMINAL_STATE, type TerminalUiState } from "./terminalState.ts";

useDom();

const state: TerminalUiState = { ...INITIAL_TERMINAL_STATE, status: "open", mode: "watch" };
const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
const settle = () => act(async () => new Promise((r) => setTimeout(r, 5)));

let written: string[];
let host: FakeHost;
let mounted: Mounted | null = null;
const originalExec = () => document.execCommand;
let restoreExec: (() => void) | null = null;

async function render(clipboard: ClipboardApi) {
  host = new FakeHost();
  const element = document.createElement("div");
  mounted = await mount(
    <TerminalScreen
      state={state}
      host={host}
      element={element}
      setElement={() => {}}
      granted
      testId="terminal-screen"
      clipboardDeps={{ clipboard, mac: false }}
    />,
  );
}

beforeEach(() => {
  written = [];
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  restoreExec?.();
  restoreExec = null;
});

const accepting: ClipboardApi = { writeText: async (t) => void written.push(t) };
const refusing: ClipboardApi = {
  writeText: async () => {
    throw new DOMException("denied", "NotAllowedError");
  },
};

describe("TerminalScreen copy buttons (#164)", () => {
  test("Copy selection follows the selection; Copy screen copies what is on screen", async () => {
    await render(accepting);
    const selection = () => byTestId("terminal-copy-selection") as HTMLButtonElement;
    expect(selection().disabled).toBe(true);
    await act(async () => host.select("npm test"));
    expect(selection().disabled).toBe(false);
    await click(selection());
    await settle();
    expect(written).toEqual(["npm test"]);
    expect(byTestId("terminal-flash").textContent).toBe("Copied");

    host.screenText = "❯ claude\n  all green";
    await click(byTestId("terminal-copy-screen"));
    await settle();
    expect(written).toEqual(["npm test", "❯ claude\n  all green"]);
    await act(async () => host.select(""));
    expect(selection().disabled).toBe(true);
  });

  test("a clipboard the browser refuses every way: the text is shown selected, no false Copied", async () => {
    const original = originalExec();
    document.execCommand = (() => false) as never;
    restoreExec = () => {
      document.execCommand = original;
    };
    await render(refusing);
    host.screenText = "the whole screen";
    await click(byTestId("terminal-copy-screen"));
    await settle();
    expect(byTestId("terminal-flash")).toBeNull();
    const alert = byTestId("terminal-copy-failed");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Couldn't copy");
    expect(alert.textContent).toContain("Ctrl+C");
    const area = alert.querySelector("textarea") as HTMLTextAreaElement;
    expect(area.value).toBe("the whole screen");
    expect(document.activeElement).toBe(area);
    expect(area.selectionEnd - area.selectionStart).toBe("the whole screen".length);
    // Escape closes only this box.
    let reachedDialog = false;
    const onKey = () => {
      reachedDialog = true;
    };
    document.addEventListener("keydown", onKey);
    await press(area, "Escape");
    document.removeEventListener("keydown", onKey);
    expect(reachedDialog).toBe(false);
    expect(byTestId("terminal-copy-failed")).toBeNull();
  });

  test("refused writeText but a working copy command still copies (Copied)", async () => {
    const original = originalExec();
    const seen = { copied: null as string | null };
    document.execCommand = (() => {
      const event = new Event("copy", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { setData: (_: string, text: string) => void (seen.copied = text) },
      });
      document.body.dispatchEvent(event);
      return true;
    }) as never;
    restoreExec = () => {
      document.execCommand = original;
    };
    await render(refusing);
    await act(async () => host.select("https://claude.ai/oauth/authorize?x=1"));
    await click(byTestId("terminal-copy-selection"));
    await settle();
    expect(seen.copied).toBe("https://claude.ai/oauth/authorize?x=1");
    expect(byTestId("terminal-flash").textContent).toBe("Copied");
    expect(byTestId("terminal-copy-failed")).toBeNull();
  });
});
