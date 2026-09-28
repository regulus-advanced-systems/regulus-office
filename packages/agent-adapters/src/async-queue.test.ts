import { describe, expect, test } from "bun:test";
import { AsyncQueue } from "./async-queue.ts";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("AsyncQueue", () => {
  test("delivers buffered and later items, then ends", async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    const result = collect(queue);
    queue.push(2);
    await Promise.resolve();
    queue.push(3);
    queue.end();
    expect(await result).toEqual([1, 2, 3]);
    expect(() => queue.push(4)).toThrow();
  });

  test("fail() rejects a waiting consumer", async () => {
    const queue = new AsyncQueue<number>();
    const result = collect(queue);
    queue.fail(new Error("boom"));
    await expect(result).rejects.toThrow("boom");
  });

  test("allows a single consumer only", () => {
    const queue = new AsyncQueue<number>();
    queue[Symbol.asyncIterator]();
    expect(() => queue[Symbol.asyncIterator]()).toThrow();
  });
});
