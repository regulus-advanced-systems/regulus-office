import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { FloorState, RobotState, UserRole } from "@regulus/protocol";
import { act } from "react";
import { useFloorStore } from "../../state/floor.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { FakeHost } from "./fakeHost.ts";
import { FakeSocket } from "./fakeSocket.ts";
import type { TerminalDeps } from "./host.ts";
import { PANEL_PRIORITY, usePanelBudget } from "./panelBudget.ts";
import { MODAL_PANEL_ID, TerminalModal } from "./TerminalModal.tsx";

useDom();

const deps: TerminalDeps = {
  createHost: async () => new FakeHost(),
  socket: FakeSocket.factory,
  wsBase: () => "ws://office",
};

const robot = (ownerUserId: string): RobotState =>
  ({
    agentId: "a1",
    ownerUserId,
    provider: "claude-code",
    ownerName: "Rita",
    seatId: "s1",
    taskTitle: "Fix login",
  }) as unknown as RobotState;

function signIn(id: string, role: UserRole) {
  useSessionStore.setState({ status: "authenticated", user: { id, displayName: id, role } });
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 5)));
const text = (id: string) => document.querySelector(`[data-testid=${id}]`)?.textContent ?? "";
const button = (label: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(label));

async function openModal(): Promise<Mounted> {
  const m = await mount(<TerminalModal agentId="a1" onClose={() => {}} deps={deps} />);
  await settle();
  return m;
}

async function serverHello(mode: "watch" | "control", viewers = 1, peers?: unknown[]) {
  await act(async () => {
    const ws = FakeSocket.last();
    ws.open();
    ws.text({ type: "hello", mode, cols: 160, rows: 45, viewers, peers });
  });
}

beforeEach(() => {
  FakeSocket.all = [];
  FakeHost.all = [];
  useFloorStore.setState({
    floorId: "f1",
    state: { robots: { a1: robot("rita") } } as unknown as FloorState,
  });
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("TerminalModal", () => {
  test("a member watching someone else's robot: watch only, faces, viewers, typing", async () => {
    signIn("mo", "member");
    const m = await openModal();
    expect(FakeSocket.last().url).toBe("ws://office/ws/term/a1?mode=watch");
    await serverHello("watch", 2, [
      { userId: "mo", name: "Mo", mode: "watch" },
      { userId: "rita", name: "Rita Owner", mode: "control" },
    ]);
    expect(text("terminal-mode")).toBe("Watching");
    expect(button("Take control")).toBeUndefined();
    expect(text("terminal-viewers")).toBe("2 viewers");
    const faces = Array.from(document.querySelectorAll(".rg-term__face")).map((f) => f.textContent);
    expect(faces).toEqual(["MO", "RO"]);
    await act(async () => FakeSocket.last().bytes("hello world"));
    expect(FakeHost.all[0]?.written).toBe("hello world");
    expect(FakeHost.all[0]?.readOnly).toBe(true);
    expect(FakeHost.all[0]?.grid).toEqual([160, 45]);
    // Watchers keep the fixed size: nothing (no resize) goes to the server.
    expect(FakeSocket.last().sent).toEqual([]);

    await act(async () => FakeSocket.last().text({ type: "typing", userId: "rita", name: "Rita" }));
    expect(text("terminal-typing")).toBe("Rita is typing…");
    await act(async () => FakeSocket.last().text({ type: "viewers", viewers: 1 }));
    expect(text("terminal-viewers")).toBe("1 viewer");
    await m.unmount();
  });

  test("the robot's owner takes control, types, and releases it", async () => {
    signIn("rita", "member");
    const m = await openModal();
    await serverHello("watch");
    const take = button("Take control");
    expect(take).toBeDefined();
    await click(take as HTMLElement);
    await settle();
    const [first, second] = FakeSocket.all;
    expect(first?.closedWith).toBe(1000);
    expect(second?.url).toBe("ws://office/ws/term/a1?mode=control");
    expect(FakeHost.all[0]?.disposed).toBe(true);
    await serverHello("control");
    expect(text("terminal-mode")).toBe("In control");
    const host = FakeHost.all.at(-1) as FakeHost;
    expect(host.readOnly).toBe(false);
    // In control the terminal fills its box and tmux reflows to it, within the agent's size.
    expect(second?.sent[0]).toBe(JSON.stringify({ type: "resize", cols: 120, rows: 30 }));
    host.type("ls\r");
    expect(new TextDecoder().decode(second?.sent[1] as Uint8Array)).toBe("ls\r");
    await click(button("Release control") as HTMLElement);
    await settle();
    // Leaving control puts the shared window back to the size watchers expect.
    expect(second?.sent.at(-1)).toBe(JSON.stringify({ type: "resize", cols: 160, rows: 45 }));
    expect(second?.closedWith).toBe(1000);
    expect(FakeSocket.last().url).toEndWith("mode=watch");
    await m.unmount();
  });

  test("an admin may take control; the server refusing it falls back to watch", async () => {
    signIn("adm", "admin");
    const m = await openModal();
    await serverHello("watch");
    await click(button("Take control") as HTMLElement);
    await settle();
    // Refused before upgrade (e.g. 403): the socket never opens.
    await act(async () => FakeSocket.last().drop(1006));
    await settle();
    expect(FakeSocket.last().url).toEndWith("mode=watch");
    await serverHello("watch");
    expect(text("terminal-mode")).toBe("Watching");
    expect(document.body.textContent).toContain("Control was refused");
    await m.unmount();
  });

  test("viewers never get the control button, even on their own robot", async () => {
    signIn("rita", "viewer");
    const m = await openModal();
    await serverHello("watch");
    expect(button("Take control")).toBeUndefined();
    await m.unmount();
  });

  test("session end and unavailable are shown", async () => {
    signIn("mo", "member");
    const m = await openModal();
    await serverHello("watch");
    await act(async () => FakeSocket.last().drop(4000));
    expect(text("terminal-screen")).toContain("The session ended.");
    await m.unmount();
  });

  test("counts as a live panel, mutes hotkeys, and cleans up on close", async () => {
    signIn("mo", "member");
    const budget = usePanelBudget.getState();
    budget.request("laptop-x", PANEL_PRIORITY.laptop);
    budget.request("laptop-y", PANEL_PRIORITY.laptop);
    const m = await openModal();
    const granted = usePanelBudget.getState().granted;
    expect(granted.size).toBe(2);
    expect(granted.has(MODAL_PANEL_ID)).toBe(true);
    expect(useUiStore.getState().overlay).toBe("terminal");
    await serverHello("watch");
    const ws = FakeSocket.last();
    await m.unmount();
    expect(ws.closedWith).toBe(1000);
    expect(FakeHost.all.every((h) => h.disposed)).toBe(true);
    expect(usePanelBudget.getState().granted.has(MODAL_PANEL_ID)).toBe(false);
    expect(useUiStore.getState().overlay).toBeNull();
    budget.release("laptop-x");
    budget.release("laptop-y");
  });

  describe("copy, paste and expand (#156)", () => {
    let written: string[] = [];
    let clipboardText = "";
    beforeEach(() => {
      written = [];
      clipboardText = "code-from-clipboard";
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (t: string) => void written.push(t),
          readText: async () => clipboardText,
        },
      });
      localStorage.clear();
    });
    const xtermEl = () => document.querySelector(".rg-term__xterm") as HTMLElement;
    const flash = () => text("terminal-flash");

    test("a watcher selects text: it is copied, with a Copied flash", async () => {
      signIn("mo", "member");
      const m = await openModal();
      await serverHello("watch");
      const host = FakeHost.all.at(-1) as FakeHost;
      host.selection = "npm test\nall green";
      await act(async () => {
        xtermEl().dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
      });
      await settle();
      expect(written).toEqual(["npm test\nall green"]);
      expect(flash()).toBe("Copied");
      // Ctrl+C copies for a watcher (no interrupt to send) and stays out of the dialog.
      const ctrlC = new KeyboardEvent("keydown", {
        key: "c",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => void xtermEl().dispatchEvent(ctrlC));
      await settle();
      expect(ctrlC.defaultPrevented).toBe(true);
      expect(written).toHaveLength(2);
      // Right-click offers Copy but no Paste.
      await act(async () => {
        xtermEl().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      });
      const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map(
        (b) => b.textContent,
      );
      expect(items).toEqual(["Copy"]);
      expect(host.pasted).toEqual([]);
      await m.unmount();
    });

    test("a controller copies with Ctrl+Shift+C and pastes only in control", async () => {
      signIn("rita", "member");
      const m = await openModal();
      await serverHello("watch");
      await click(button("Take control") as HTMLElement);
      await settle();
      await serverHello("control");
      const host = FakeHost.all.at(-1) as FakeHost;
      host.selection = "https://example.com/x";
      const copy = new KeyboardEvent("keydown", {
        key: "C",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => void xtermEl().dispatchEvent(copy));
      await settle();
      expect(copy.defaultPrevented).toBe(true);
      expect(written).toEqual(["https://example.com/x"]);
      // Ctrl+Shift+V: kept from xterm (not ^V) but the browser's paste is not prevented.
      const paste = new KeyboardEvent("keydown", {
        key: "V",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      let reachedTerminal = false;
      const inner = document.createElement("textarea");
      xtermEl().appendChild(inner);
      inner.addEventListener("keydown", () => {
        reachedTerminal = true;
      });
      await act(async () => void inner.dispatchEvent(paste));
      expect(paste.defaultPrevented).toBe(false);
      expect(reachedTerminal).toBe(false);
      // Plain Ctrl+C still reaches the terminal (the interrupt).
      const ctrlC = new KeyboardEvent("keydown", {
        key: "c",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => void inner.dispatchEvent(ctrlC));
      expect(reachedTerminal).toBe(true);
      // The menu's Paste types the clipboard into the terminal.
      await act(async () => {
        xtermEl().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      });
      await click(Array.from(document.querySelectorAll('[role="menuitem"]')).at(-1) as HTMLElement);
      await settle();
      expect(host.pasted).toEqual(["code-from-clipboard"]);
      const sent = FakeSocket.last().sent.filter((f): f is Uint8Array => typeof f !== "string");
      expect(new TextDecoder().decode(sent.at(-1))).toBe("code-from-clipboard");
      await m.unmount();
    });

    test("expand grows the dialog, is remembered per user and applied next time", async () => {
      signIn("mo", "member");
      window.innerWidth = 1920;
      window.innerHeight = 1080;
      const m = await openModal();
      const frame = () => document.querySelector(".rg-modal") as HTMLElement;
      const screen = () => document.querySelector('[data-testid="terminal-screen"]') as HTMLElement;
      expect(frame().style.getPropertyValue("--rg-modal-width")).toBe("1040px");
      expect(screen().style.height).toBe("560px");
      await click(document.querySelector('[data-testid="terminal-expand"]') as HTMLElement);
      expect(frame().style.getPropertyValue("--rg-modal-width")).toBe(`${1152 + 60}px`);
      expect(screen().style.height).toBe("648px");
      expect(localStorage.getItem("regulus.terminal.expanded.mo")).toBe("1");
      await m.unmount();
      const again = await openModal();
      expect(document.querySelector('[data-expanded="true"]')).not.toBeNull();
      expect(screen().style.height).toBe("648px");
      await click(document.querySelector('[data-testid="terminal-expand"]') as HTMLElement);
      expect(screen().style.height).toBe("560px");
      expect(localStorage.getItem("regulus.terminal.expanded.mo")).toBeNull();
      await again.unmount();
      window.innerWidth = 1024;
      window.innerHeight = 768;
    });
  });
  test("#158: the robot's owner gets the sign-in link bar when Claude asks to sign in; watchers never", async () => {
    const url = "https://claude.ai/oauth/authorize?code=true&client_id=FAKE&state=FAKEstate";
    const printLink = async () => {
      const host = FakeHost.all.at(-1) as FakeHost;
      host.cols = 160;
      host.lines = [
        { text: " Select login method:", wrapped: false },
        { text: url, wrapped: false },
      ];
      await act(async () => FakeSocket.last().bytes("output"));
      await act(async () => new Promise((r) => setTimeout(r, 350)));
    };
    const bar = () => document.querySelector('[data-testid="robot-sign-in-link"]');

    signIn("mo", "member");
    let m = await openModal();
    await serverHello("watch");
    await printLink();
    expect(bar()).toBeNull();
    await m.unmount();
    document.body.innerHTML = "";

    signIn("rita", "member");
    m = await openModal();
    await serverHello("watch");
    expect(bar()).toBeNull(); // nothing until the CLI prints a link
    await printLink();
    const open = bar()?.querySelector("a") as HTMLAnchorElement;
    expect(open.getAttribute("href")).toBe(url);
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
    const frames = FakeSocket.last().sent.filter((f) => typeof f === "string");
    expect(frames.every((f) => !String(f).includes("claude.ai"))).toBe(true);
    await m.unmount();
  });
});
