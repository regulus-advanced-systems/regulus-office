/**
 * Single-consumer push queue exposed as an `AsyncIterable`, the shape of
 * `AgentControl.events`. Adapters push parsed events; `end()` finishes the
 * stream after buffered items drain; `fail()` makes the iterator throw.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  readonly #buffer: T[] = [];
  #waiter: ((result: IteratorResult<T>) => void) | null = null;
  #failWaiter: ((error: unknown) => void) | null = null;
  #ended = false;
  #error: unknown = undefined;
  #iterating = false;

  get ended(): boolean {
    return this.#ended;
  }

  push(item: T): void {
    if (this.#ended) throw new Error("push after end");
    if (this.#waiter) {
      const resolve = this.#waiter;
      this.#waiter = null;
      this.#failWaiter = null;
      resolve({ value: item, done: false });
    } else {
      this.#buffer.push(item);
    }
  }

  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#settleWaiter();
  }

  fail(error: unknown): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#error = error ?? new Error("queue failed");
    this.#settleWaiter();
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.#iterating) throw new Error("AsyncQueue supports a single consumer");
    this.#iterating = true;
    return {
      next: () => this.#next(),
      return: async () => {
        this.end();
        this.#buffer.length = 0;
        return { value: undefined, done: true };
      },
    };
  }

  #next(): Promise<IteratorResult<T>> {
    if (this.#buffer.length > 0) {
      return Promise.resolve({ value: this.#buffer.shift() as T, done: false });
    }
    if (this.#ended) {
      return this.#error === undefined
        ? Promise.resolve({ value: undefined, done: true })
        : Promise.reject(this.#error);
    }
    return new Promise((resolve, reject) => {
      this.#waiter = resolve;
      this.#failWaiter = reject;
    });
  }

  #settleWaiter(): void {
    if (!this.#waiter) return;
    const resolve = this.#waiter;
    const reject = this.#failWaiter;
    this.#waiter = null;
    this.#failWaiter = null;
    if (this.#error !== undefined) reject?.(this.#error);
    else resolve({ value: undefined, done: true });
  }
}
