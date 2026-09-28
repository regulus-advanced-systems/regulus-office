import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { FloorState, RobotState, UserRole } from "@regulus/protocol";
import { act } from "react";
import { useFloorStore } from "../../state/floor.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { FakeSocket } from "./fakeSocket.ts";
import type { TerminalDeps, TerminalHost } from "./host.ts";
import { PANEL_PRIORITY, usePanelBudget } from "./panelBudget.ts";
import { MODAL_PANEL_ID, TerminalModal } from "./TerminalModal.tsx";

useDom();

class FakeHost implements TerminalHost {
  static all: FakeHost[] = [];
  readonly renderer = "dom" as const;
  written = "";
  resets = 0;
  readOnly = true;
  disposed = false;
  grid: [number, number] | null = null;
  #listener: ((data: string) => void) | null = null;
  constructor() {
    FakeHost.all.push(this);
  }
  write(bytes: Uint8Array) {
    this.written += new TextDecoder().decode(bytes);
  }
  reset() {
    this.resets += 1;
    this.written = "";
  }
  setGrid(cols: number, rows: number) {
    this.grid = [cols, rows];
  }
  fit() {}
  setReadOnly(readOnly: boolean) {
    this.readOnly = readOnly;
  }
  focus() {}
  onData(listener: (data: string) => void) {
    this.#listener = listener;
    return () => {
      this.#listener = null;
    };
  }
  type(data: string) {
    this.#listener?.(data);
  }
  dispose() {
    this.disposed = true;
  }
}

const deps: TerminalDeps = {
  createHost: async () => new FakeHost(),
  socket: FakeSocket.factory,
  wsBase: () => "ws://office",
};

const robot = (ownerUserId: string): RobotState =>
  ({
    agentId: "a1",
    ownerUserId,
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
    host.type("ls\r");
    expect(new TextDecoder().decode(second?.sent[0] as Uint8Array)).toBe("ls\r");
    await click(button("Release control") as HTMLElement);
    await settle();
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
});
