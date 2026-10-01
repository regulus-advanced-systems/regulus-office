/** The discovery loop (#39) over a fake runner and a real (in-memory) database. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ServiceState } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { agents, services } from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import { ServiceRegistry } from "./registry.ts";
import { QUIET_AFTER, QUIET_EVERY, type ScannerDeps, ServiceScanner } from "./scanner.ts";
import { ServiceStore } from "./store.ts";
import { FakeRunner, type ServicesOffice, startServicesOffice } from "./test-helpers.ts";

describe("ServiceScanner", () => {
  let office: ServicesOffice;
  let runner: FakeRunner;
  let owner: string;
  let published: Map<string, ServiceState[]>;
  let now: number;

  const scanner = (probe?: ScannerDeps["probeTitle"]) =>
    new ServiceScanner({
      db: office.db,
      runner: runner.asRunner(),
      registry: new ServiceRegistry(),
      store: new ServiceStore(office.db),
      publish: (operationId, list) => published.set(operationId, list),
      shared: () => false,
      probeTitle: probe,
      logger: createLogger({ level: "silent" }),
      now: () => now,
      intervalMs: 60_000,
    });

  beforeEach(async () => {
    runner = new FakeRunner("docker");
    office = await startServicesOffice({ runner: runner.asRunner() });
    owner = (await office.signUp("Owner")).id;
    office.addOperation("f1", { [owner]: "spawn" });
    office.addAgent("a1", "f1", owner);
    office.addAgent("gone", "f1", owner, "exited");
    runner.sandboxes.set("a1", {
      userId: owner,
      agentId: "a1",
      host: "rg-sbx-a1",
      ports: { first: 20_000, last: 20_009 },
    });
    published = new Map();
    now = 1_000_000;
  });

  afterEach(async () => {
    await office.stop();
  });

  test("titles from the terminal banner and the page; publishes and persists", async () => {
    runner.ports.set("a1", [
      { port: 5173, address: "0.0.0.0", pid: 7 },
      { port: 9229, address: "127.0.0.1", pid: 8 },
    ]);
    runner.processes.set("a1", [
      { pid: 7, ppid: 1, command: "node" },
      { pid: 8, ppid: 1, command: "node" },
    ]);
    runner.screens.set("a1", "  VITE v5.4.2  ready\n  ➜  Local:   http://localhost:5173/\n");
    const probed: number[] = [];
    const s = scanner(async (_target, port) => {
      probed.push(port);
      return "My Shop";
    });
    await s.tick();
    const list = published.get("f1") ?? [];
    expect(list.map((x) => [x.port, x.title, x.localOnly, x.url])).toEqual([
      [5173, "My Shop (Vite)", false, "/p/f1/a/a1/port/5173/"],
      // Localhost-only inside the sandbox: listed, never probed.
      [9229, "node", true, "/p/f1/a/a1/port/9229/"],
    ]);
    expect(probed).toEqual([5173]);
    const rows = office.db.select().from(services).where(eq(services.agentId, "a1")).all();
    expect(rows.map((r) => [r.port, r.address, r.title])).toEqual(
      expect.arrayContaining([
        [5173, "0.0.0.0", "My Shop (Vite)"],
        [9229, "127.0.0.1", "node"],
      ]),
    );
  });

  test("ids and first-seen times survive a restart; stale rows are removed", async () => {
    runner.ports.set("a1", [{ port: 3000, address: "::", pid: 7 }]);
    const first = scanner();
    first.start();
    await first.stop();
    const [before] = published.get("f1") ?? [];
    now += 5_000;
    const second = scanner();
    second.start();
    await second.stop();
    const [after] = published.get("f1") ?? [];
    expect(after?.id).toBe(before?.id ?? "missing");
    expect(after?.firstSeenAt).toBe(before?.firstSeenAt ?? -1);
    // The henchman goes down: its apps go too.
    office.db.update(agents).set({ status: "exited" }).where(eq(agents.id, "a1")).run();
    await second.tick();
    expect(published.get("f1")).toEqual([]);
    expect(office.db.select().from(services).all()).toEqual([]);
  });

  test("a port that closes disappears; quiet henchmen are scanned less often", async () => {
    runner.ports.set("a1", [{ port: 3000, address: "::", pid: 7 }]);
    const s = scanner();
    await s.tick();
    runner.ports.set("a1", []);
    await s.tick();
    expect(published.get("f1")).toEqual([]);
    for (let i = 0; i < QUIET_AFTER + 2; i++) await s.tick();
    const calls = runner.listPortCalls;
    for (let i = 0; i < QUIET_EVERY * 2; i++) await s.tick();
    expect(runner.listPortCalls - calls).toBe(2);
    s.nudge("a1");
    await s.tick();
    expect(runner.listPortCalls - calls).toBe(3);
  });

  test("docker without a sandbox: listed, but there is no target", async () => {
    runner.sandboxes.clear();
    runner.ports.set("a1", [{ port: 3000, address: "0.0.0.0", pid: 7 }]);
    const registry = new ServiceRegistry();
    const s = new ServiceScanner({
      db: office.db,
      runner: runner.asRunner(),
      registry,
      store: new ServiceStore(office.db),
      publish: () => {},
      shared: () => false,
      logger: createLogger({ level: "silent" }),
    });
    await s.tick();
    expect(registry.find("a1", 3000)?.target).toBeNull();
  });
});
