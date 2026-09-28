/**
 * JSON-RPC trace replay for Codex adapter tests.
 *
 * A trace is JSONL, one step per line: `{"dir":"out","msg":…}` is a message
 * the client must send next, `{"dir":"in","msg":…}` one the fake server sends.
 * `{"dir":"in","msg":{"exit":N}}` makes the fake server exit with code N.
 *
 * Matching: an "out" step matches when the method (or, for answers to server
 * requests, the id) is equal and every field present in the trace's
 * params/result is present and equal in the client's message (a subset match;
 * extra client fields are fine). Response ids in "in" steps are rewritten to
 * the ids the client actually used.
 */

export type TraceDir = "in" | "out";
export interface TraceStep {
  dir: TraceDir;
  msg: Record<string, unknown>;
}

export type Emission = { line: string } | { exit: number };

export function parseTrace(text: string): TraceStep[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .map((l) => JSON.parse(l) as TraceStep);
}

/** Is `expected` contained in `actual` (objects by key, arrays element-wise)? */
export function isSubset(expected: unknown, actual: unknown): boolean {
  if (expected === null || typeof expected !== "object") return Object.is(expected, actual);
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((e, i) => isSubset(e, actual[i]))
    );
  }
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
  const a = actual as Record<string, unknown>;
  return Object.entries(expected as Record<string, unknown>).every(([k, v]) => isSubset(v, a[k]));
}

export class TraceReplayer {
  readonly errors: string[] = [];
  readonly received: Record<string, unknown>[] = [];
  readonly #steps: TraceStep[];
  readonly #ids = new Map<unknown, unknown>();
  #at = 0;

  constructor(steps: TraceStep[]) {
    this.#steps = steps;
  }

  /** All steps consumed. */
  get done(): boolean {
    return this.#at >= this.#steps.length;
  }

  /** Remaining steps, for failure messages. */
  remaining(): TraceStep[] {
    return this.#steps.slice(this.#at);
  }

  /** Server messages that precede the first client message. */
  start(): Emission[] {
    return this.#flush();
  }

  /** Feed one client line; returns what the server sends in reply. */
  receive(line: string): Emission[] {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      this.errors.push(`client sent invalid JSON: ${line.slice(0, 80)}`);
      return [];
    }
    this.received.push(msg);
    const step = this.#steps[this.#at];
    if (!step || step.dir !== "out") {
      this.errors.push(`unexpected client message ${describe(msg)} at step ${this.#at}`);
      return [];
    }
    const mismatch = this.#match(step.msg, msg);
    if (mismatch) {
      this.errors.push(`step ${this.#at}: ${mismatch}`);
      return [];
    }
    if ("method" in step.msg && "id" in step.msg) this.#ids.set(step.msg.id, msg.id);
    this.#at++;
    return this.#flush();
  }

  #match(expected: Record<string, unknown>, actual: Record<string, unknown>): string | null {
    if ("method" in expected) {
      if (actual.method !== expected.method) {
        return `expected ${String(expected.method)}, got ${describe(actual)}`;
      }
      if ("id" in expected !== "id" in actual)
        return `request/notification mismatch for ${String(expected.method)}`;
      if (expected.params !== undefined && !isSubset(expected.params, actual.params)) {
        return `params of ${String(expected.method)} differ: ${JSON.stringify(actual.params)}`;
      }
      return null;
    }
    if (actual.id !== expected.id)
      return `expected response to ${String(expected.id)}, got ${describe(actual)}`;
    for (const key of ["result", "error"] as const) {
      if (key in expected && !isSubset(expected[key], actual[key])) {
        return `${key} for ${String(expected.id)} differs: ${JSON.stringify(actual[key])}`;
      }
    }
    return null;
  }

  #flush(): Emission[] {
    const out: Emission[] = [];
    while (this.#at < this.#steps.length && this.#steps[this.#at]?.dir === "in") {
      const msg = { ...(this.#steps[this.#at] as TraceStep).msg };
      this.#at++;
      if (typeof msg.exit === "number" && Object.keys(msg).length === 1) {
        out.push({ exit: msg.exit });
        break;
      }
      const isResponse = !("method" in msg) && "id" in msg;
      if (isResponse && this.#ids.has(msg.id)) msg.id = this.#ids.get(msg.id);
      out.push({ line: JSON.stringify(msg) });
    }
    return out;
  }
}

function describe(msg: Record<string, unknown>): string {
  if (typeof msg.method === "string") return msg.method;
  return `response ${String(msg.id)}`;
}
