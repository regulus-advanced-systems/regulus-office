/**
 * The stream attach path (docker backend: the runner hands over a TTY that is
 * already allocated), driven with a fake DuplexTty so it runs without Docker.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TERMINAL_CLOSE_CODES, type TerminalMode } from "@regulus/protocol";
import type { AttachStream, DuplexTty, Runner, TtySize } from "../runners/types.ts";
import { startTerminalOffice, type TerminalOffice } from "./test-helpers.ts";

class FakeTty implements DuplexTty {
  readonly writes: string[] = [];
  readonly resizes: TtySize[] = [];
  closeCalls = 0;
  readonly output: ReadableStream<Uint8Array>;
  readonly closed: Promise<void>;
  #controller!: ReadableStreamDefaultController<Uint8Array>;
  #resolveClosed!: () => void;

  constructor(
    readonly mode: TerminalMode,
    readonly size: TtySize,
  ) {
    this.output = new ReadableStream({ start: (c) => (this.#controller = c) });
    this.closed = new Promise((resolve) => (this.#resolveClosed = resolve));
  }

  emit(text: string): void {
    this.#controller.enqueue(new TextEncoder().encode(text));
  }

  async write(data: string | Uint8Array): Promise<void> {
    this.writes.push(typeof data === "string" ? data : new TextDecoder().decode(data));
  }

  async resize(size: TtySize): Promise<void> {
    this.resizes.push(size);
  }

  /** The backend side ends the attach (session gone). */
  end(): void {
    try {
      this.#controller.close();
    } catch {
      // the reader already cancelled the stream
    }
    this.#resolveClosed();
  }

  close(): void {
    this.closeCalls += 1;
    this.end();
  }
}

const ttys: FakeTty[] = [];
const fakeRunner = {
  backend: "docker",
  sessionExists: async () => true,
  capturePane: async () => "earlier line 1\nearlier line 2\n",
  attach: (_session: unknown, mode: TerminalMode): AttachStream => ({
    kind: "stream",
    async open(size) {
      const tty = new FakeTty(mode, size);
      ttys.push(tty);
      return tty;
    },
  }),
} as unknown as Runner;

let office: TerminalOffice;
let owner: { id: string; cookie: string };

beforeAll(async () => {
  office = await startTerminalOffice({ runner: fakeRunner });
  owner = await office.signUp("Owner");
  office.addOperation("f1", { [owner.id]: "manage" });
  office.addAgent("s1", "f1", owner.id);
});

afterAll(() => office.stop());

const waitForTty = async (n: number) => {
  const deadline = Date.now() + 2000;
  while (ttys.length < n && Date.now() < deadline) await Bun.sleep(5);
  const tty = ttys[n - 1];
  if (!tty) throw new Error("no tty opened");
  return tty;
};

describe("terminal bridge over a backend TTY stream", () => {
  test("control: hello, scrollback, live output, input and resize reach the stream", async () => {
    const client = await office.connect("s1", "control", owner.cookie);
    const tty = await waitForTty(1);
    expect(tty.mode).toBe("control");
    expect(tty.size).toEqual({ cols: 160, rows: 45 });
    tty.emit("live bytes");
    await client.waitFor((c) => c.output.includes("live bytes"), "live output");
    expect(client.hello).toEqual({
      type: "hello",
      mode: "control",
      cols: 160,
      rows: 45,
      viewers: 1,
      peers: [{ userId: owner.id, name: "Owner", mode: "control" }],
    });
    expect(client.output).toBe("earlier line 1\r\nearlier line 2\r\nlive bytes");

    client.type("ls\r");
    client.resize(100, 30);
    const deadline = Date.now() + 2000;
    while ((tty.writes.length === 0 || tty.resizes.length === 0) && Date.now() < deadline) {
      await Bun.sleep(5);
    }
    expect(tty.writes).toEqual(["ls\r"]);
    expect(tty.resizes).toEqual([{ cols: 100, rows: 30 }]);

    await client.close();
    await Bun.sleep(20);
    expect(tty.closeCalls).toBe(1);
  });

  test("watch: keystrokes and resizes are dropped server-side", async () => {
    const client = await office.connect("s1", "watch", owner.cookie);
    const tty = await waitForTty(2);
    expect(tty.mode).toBe("watch");
    client.type("rm -rf /\r");
    client.resize(100, 30);
    tty.emit("still here");
    await client.waitFor((c) => c.output.includes("still here"), "output after input");
    await Bun.sleep(30);
    expect(tty.writes).toEqual([]);
    expect(tty.resizes).toEqual([]);
    await client.close();
  });

  test("peers and typing: others learn who types (throttled), never what", async () => {
    const before = ttys.length;
    const watcher = await office.connect("s1", "watch", owner.cookie);
    await waitForTty(before + 1);
    const driver = await office.connect("s1", "control", owner.cookie);
    const tty = await waitForTty(before + 2);
    await watcher.waitFor(
      (c) => c.controls.some((m) => m.type === "viewers" && m.peers?.length === 2),
      "viewers with peers",
    );
    const viewers = watcher.controls.findLast((m) => m.type === "viewers");
    expect(viewers).toMatchObject({
      viewers: 2,
      peers: [
        { userId: owner.id, mode: "watch" },
        { userId: owner.id, mode: "control" },
      ],
    });

    // Not hex (#127): "abc" also turned up inside a random user id in the controls JSON.
    driver.type("q");
    driver.type("u");
    driver.type("z");
    await watcher.waitFor((c) => c.controls.some((m) => m.type === "typing"), "typing notice");
    await Bun.sleep(50);
    const typing = watcher.controls.filter((m) => m.type === "typing");
    expect(typing).toEqual([{ type: "typing", userId: owner.id, name: "Owner" }]);
    expect(JSON.stringify(watcher.controls)).not.toContain("quz");
    expect(driver.controls.some((m) => m.type === "typing")).toBe(false);
    expect(tty.writes.join("")).toBe("quz");

    watcher.type("x");
    await Bun.sleep(50);
    expect(driver.controls.some((m) => m.type === "typing")).toBe(false);
    await driver.close();
    await watcher.close();
  });

  test("the stream ending closes the socket with sessionEnded", async () => {
    const before = ttys.length;
    const client = await office.connect("s1", "watch", owner.cookie);
    const tty = await waitForTty(before + 1);
    tty.end();
    expect(await client.closed).toBe(TERMINAL_CLOSE_CODES.sessionEnded);
    expect(office.bridge.viewerCount("s1")).toBe(0);
  });
});
