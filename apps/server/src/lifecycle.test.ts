import { describe, expect, test } from "bun:test";
import { createShutdownController, installSignalHandlers } from "./lifecycle.ts";
import { createLogger } from "./logging.ts";

const logger = createLogger({ level: "silent" });

describe("createShutdownController", () => {
  test("runs hooks in reverse order and resolves true", async () => {
    const c = createShutdownController({ logger, timeoutMs: 1000 });
    const order: string[] = [];
    c.register("a", () => {
      order.push("a");
    });
    c.register("b", async () => {
      order.push("b");
    });
    expect(c.shuttingDown).toBe(false);
    await expect(c.shutdown("test")).resolves.toBe(true);
    expect(order).toEqual(["b", "a"]);
    expect(c.shuttingDown).toBe(true);
  });

  test("is idempotent and tolerates failing hooks", async () => {
    const c = createShutdownController({ logger, timeoutMs: 1000 });
    let calls = 0;
    c.register("boom", () => {
      calls++;
      throw new Error("nope");
    });
    const first = c.shutdown("one");
    const second = c.shutdown("two");
    expect(second).toBe(first);
    await expect(first).resolves.toBe(true);
    expect(calls).toBe(1);
  });

  test("resolves false when the deadline passes", async () => {
    const c = createShutdownController({ logger, timeoutMs: 20 });
    c.register("slow", () => new Promise<void>((r) => setTimeout(r, 200)));
    await expect(c.shutdown("slow")).resolves.toBe(false);
  });

  test("unregister removes a hook", async () => {
    const c = createShutdownController({ logger, timeoutMs: 1000 });
    let ran = false;
    const off = c.register("x", () => {
      ran = true;
    });
    off();
    await c.shutdown("t");
    expect(ran).toBe(false);
  });
});

describe("installSignalHandlers", () => {
  test("first signal shuts down gracefully, second forces exit", async () => {
    const c = createShutdownController({ logger, timeoutMs: 1000 });
    let release: (() => void) | undefined;
    c.register("wait", () => new Promise<void>((r) => (release = r)));
    const exits: number[] = [];
    const uninstall = installSignalHandlers(c, (code) => exits.push(code));
    try {
      process.emit("SIGTERM", "SIGTERM");
      expect(c.shuttingDown).toBe(true);
      expect(exits).toEqual([]);
      process.emit("SIGINT", "SIGINT");
      expect(exits).toEqual([130]);
      release?.();
      await c.shutdown("x");
      await Bun.sleep(0);
      expect(exits).toEqual([130, 0]);
    } finally {
      uninstall();
    }
  });
});
