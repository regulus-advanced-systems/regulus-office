/**
 * Laptop screen feed `/ws/screens/<floorId>` over a fake runner: ACL on the
 * upgrade, first screens on subscribe, change-only pushes, removal, the 2 Hz
 * rate, idle back-off, the size cap, and no polling without subscribers.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SCREEN_TEXT_LIMITS, screensWsPath } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { agents } from "../db/schema/index.ts";
import type { Runner, TmuxSessionRef } from "../runners/types.ts";
import { startTerminalOffice, type TerminalOffice } from "./test-helpers.ts";

const panes = new Map<string, string>();
const captures: { session: string; lines: number }[] = [];
const fakeRunner = {
  backend: "docker",
  sessionExists: async () => true,
  capturePane: async (session: TmuxSessionRef, lines: number) => {
    captures.push({ session: session.name, lines });
    const text = panes.get(session.name);
    if (text === undefined) throw new Error("no such session");
    return text;
  },
} as unknown as Runner;

const INTERVAL = 50;
let office: TerminalOffice;
let owner: { id: string; cookie: string };
let member: { id: string; cookie: string };
let outsider: { id: string; cookie: string };

const subscribe = (floorId: string, cookie: string) => office.subscribeScreens(floorId, cookie);
const probe = (floorId: string, headers: Record<string, string>) =>
  fetch(new URL(screensWsPath(floorId), office.server.url), {
    headers: {
      upgrade: "websocket",
      connection: "Upgrade",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      "sec-websocket-version": "13",
      origin: office.origin,
      ...headers,
    },
  });

beforeAll(async () => {
  office = await startTerminalOffice({
    runner: fakeRunner,
    screens: { intervalMs: INTERVAL, idleAfterTicks: 3, idleEvery: 4 },
  });
  owner = await office.signUp("Owner");
  member = await office.signUp("Member", "member");
  outsider = await office.signUp("Outsider", "member");
  office.addFloor("f1", { [member.id]: "view" });
  office.addFloor("f2");
  office.addAgent("a1", "f1", owner.id);
  office.addAgent("a2", "f1", member.id);
  office.addAgent("b1", "f2", owner.id);
  panes.set("agent-a1", "$ make\nbuilding...\n\n");
  panes.set("agent-a2", "hello from a2\n");
  panes.set("agent-b1", "other floor\n");
});

afterAll(() => office.stop());

describe("screen feed", () => {
  test("upgrade is checked: plain GET, origin, session and floor visibility", async () => {
    const get = await fetch(new URL(screensWsPath("f1"), office.server.url));
    expect(get.status).toBe(426);
    expect((await probe("f1", { cookie: owner.cookie, origin: "https://evil.test" })).status).toBe(
      403,
    );
    expect((await probe("f1", {})).status).toBe(401);
    expect((await probe("f1", { cookie: outsider.cookie })).status).toBe(404);
    expect((await probe("..%2Fx", { cookie: owner.cookie })).status).toBe(404);
    expect((await probe("%E0%A4%A", { cookie: owner.cookie })).status).toBe(404);
  });

  test("a member sees the floor's screens (visible pane only), not other floors'", async () => {
    captures.length = 0;
    const client = await subscribe("f1", member.cookie);
    await client.waitFor(
      (c) => c.screens("a1").length > 0 && c.screens("a2").length > 0,
      "screens",
    );
    expect(client.screens("a1")).toEqual(["$ make\nbuilding..."]);
    expect(client.screens("a2")).toEqual(["hello from a2"]);
    expect(client.messages.some((m) => m.agentId === "b1")).toBe(false);
    expect(captures.every((c) => c.lines === 0)).toBe(true);
    await client.close();
  });

  test("pushes only changes, at most once per interval, and a removal when a robot leaves", async () => {
    const client = await subscribe("f1", owner.cookie);
    await client.waitFor((c) => c.screens("a1").length === 1, "first screen");
    await Bun.sleep(INTERVAL * 3);
    expect(client.screens("a1")).toHaveLength(1);

    const started = Date.now();
    for (let i = 0; i < 20; i++) {
      panes.set("agent-a1", `tick ${i}`);
      await Bun.sleep(5);
    }
    const changing = Date.now() - started;
    // a1 went idle above, so it is captured only every `idleEvery` ticks: wait for the last
    // change rather than a fixed time (#127: two intervals were not always enough).
    await client.waitFor((c) => c.screens("a1").at(-1) === "tick 19", "last change");
    const updates = client.screens("a1").length - 1;
    // 20 changes: at most one push per tick while they happened, plus the last one after.
    expect(updates).toBeGreaterThanOrEqual(1);
    expect(updates).toBeLessThanOrEqual(Math.floor(changing / INTERVAL) + 2);

    office.db.update(agents).set({ exitedAt: new Date() }).where(eq(agents.id, "a2")).run();
    await client.waitFor(
      (c) => c.messages.some((m) => m.type === "removed" && m.agentId === "a2"),
      "removal",
    );
    office.db.update(agents).set({ exitedAt: null }).where(eq(agents.id, "a2")).run();
    await client.close();
  });

  test("a capture failure darkens the screen; idle screens are captured less often", async () => {
    const client = await subscribe("f1", owner.cookie);
    await client.waitFor((c) => c.screens("a2").length === 1, "a2 screen");
    panes.delete("agent-a2");
    await client.waitFor(
      (c) => c.messages.some((m) => m.type === "removed" && m.agentId === "a2"),
      "removal after failure",
    );
    panes.set("agent-a2", "back");
    await client.waitFor((c) => c.screens("a2").includes("back"), "screen back");

    // a1 has been unchanged for a while now: idle, so about 1 in `idleEvery` ticks captures it.
    await Bun.sleep(INTERVAL * 4);
    captures.length = 0;
    await Bun.sleep(INTERVAL * 8);
    const a1 = captures.filter((c) => c.session === "agent-a1").length;
    expect(a1).toBeLessThanOrEqual(4);
    await client.close();
  });

  test("text is capped and polling stops with the last subscriber", async () => {
    panes.set("agent-a1", Array.from({ length: 300 }, () => "█".repeat(400)).join("\n"));
    const client = await subscribe("f1", owner.cookie);
    await client.waitFor((c) => c.screens("a1").at(-1)?.startsWith("█") ?? false, "big screen");
    const text = client.screens("a1").at(-1) ?? "";
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(
      SCREEN_TEXT_LIMITS.maxBytes,
    );
    expect(text.split("\n").length).toBeLessThanOrEqual(SCREEN_TEXT_LIMITS.maxLines);

    expect(office.screens.poller("f1")?.active).toBe(true);
    await client.close();
    await Bun.sleep(20);
    expect(office.screens.poller("f1")).toBeUndefined();
    captures.length = 0;
    await Bun.sleep(INTERVAL * 3);
    expect(captures).toHaveLength(0);
  });

  test("two subscribers share one poller", async () => {
    const one = await subscribe("f1", owner.cookie);
    const two = await subscribe("f1", member.cookie);
    await two.waitFor((c) => c.screens("a1").length > 0, "second subscriber screens");
    expect(office.screens.poller("f1")?.size).toBe(2);
    await one.close();
    await Bun.sleep(20);
    expect(office.screens.poller("f1")?.size).toBe(1);
    await two.close();
  });
});
