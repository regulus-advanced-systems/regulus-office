import { describe, expect, test } from "bun:test";
import type { PipedProcess } from "../types.ts";
import { JsonRpcConnection, RPC_CLOSED, RPC_TIMEOUT, RpcError } from "./jsonrpc.ts";
import { CodexRpcClient } from "./rpc.ts";
import { FakeAppServerProcess, loadFixture } from "./testing/fake-app-server.ts";
import { isSubset } from "./testing/trace.ts";

/** The rejection of `p`, which must reject with an RpcError. */
function caught(p: Promise<unknown>): Promise<RpcError> {
  return p.then(
    () => {
      throw new Error("expected a rejection");
    },
    (e: RpcError) => e,
  );
}

/** Hand-driven process: the test pushes stdout chunks and reads what the client wrote. */
function manualProcess() {
  let out!: ReadableStreamDefaultController<Uint8Array>;
  let exit!: (code: number | null) => void;
  const written: string[] = [];
  const signals: string[] = [];
  const proc: PipedProcess = {
    pid: 1,
    stdout: new ReadableStream({ start: (c) => void (out = c) }),
    stderr: new ReadableStream({ start: (c) => c.close() }),
    exited: new Promise((r) => (exit = r)),
    async write(chunk) {
      written.push(String(chunk));
    },
    kill(signal) {
      signals.push(signal ?? "SIGTERM");
      if (signal === "SIGKILL") {
        out.close();
        exit(null);
      }
    },
  };
  const push = (text: string) => out.enqueue(new TextEncoder().encode(text));
  return { proc, written, signals, push, exit: (c: number) => (out.close(), exit(c)) };
}

describe("JsonRpcConnection", () => {
  test("correlates responses by id across split chunks, dispatches notifications and requests", async () => {
    const m = manualProcess();
    const notes: string[] = [];
    const reqs: unknown[] = [];
    const conn = new JsonRpcConnection(m.proc, {
      onNotification: (method) => notes.push(method),
      onRequest: (r) => reqs.push(r),
    });
    const a = conn.request("a", { x: 1 });
    const b = conn.request("b");
    expect(m.written).toEqual([
      '{"method":"a","id":0,"params":{"x":1}}\n',
      '{"method":"b","id":1}\n',
    ]);
    m.push('{"id":1,"result":"B"}\n{"method":"turn/start');
    m.push('ed","params":{}}\nnot json\n{"id":0,"res');
    m.push('ult":{"ok":true}}\n{"method":"item/fileChange/requestApproval","id":5,"params":{}}\n');
    expect(await a).toEqual({ ok: true });
    expect(await b).toBe("B");
    await Bun.sleep(1);
    expect(notes).toEqual(["turn/started"]);
    expect(reqs).toEqual([{ id: 5, method: "item/fileChange/requestApproval", params: {} }]);
    expect(conn.malformedLines).toBe(1);
    await conn.respond(5, { decision: "accept" });
    expect(m.written.at(-1)).toBe('{"id":5,"result":{"decision":"accept"}}\n');
  });

  test("server errors reject with RpcError", async () => {
    const m = manualProcess();
    const conn = new JsonRpcConnection(m.proc);
    const p = conn.request("account/rateLimits/read");
    m.push('{"id":0,"error":{"code":-32600,"message":"auth required"}}\n');
    const err = await caught(p);
    expect(err).toBeInstanceOf(RpcError);
    expect(err.code).toBe(-32600);
    expect(err.message).toBe("account/rateLimits/read: auth required");
  });

  test("requests time out", async () => {
    const m = manualProcess();
    const conn = new JsonRpcConnection(m.proc, { requestTimeoutMs: 10 });
    const err = await caught(conn.request("slow"));
    expect(err.code).toBe(RPC_TIMEOUT);
  });

  test("exit rejects pending requests and reports the code once", async () => {
    const m = manualProcess();
    const exits: unknown[] = [];
    const conn = new JsonRpcConnection(m.proc, { onExit: (e) => exits.push(e) });
    const p = conn.request("x");
    m.exit(2);
    expect((await caught(p)).code).toBe(RPC_CLOSED);
    expect(await conn.exited).toEqual({ code: 2 });
    expect(exits).toEqual([{ code: 2 }]);
    expect((await caught(conn.request("y"))).code).toBe(RPC_CLOSED);
  });

  test("close escalates to SIGKILL after the grace period", async () => {
    const m = manualProcess();
    const conn = new JsonRpcConnection(m.proc);
    expect(await conn.close(5)).toEqual({ code: null });
    expect(m.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(await conn.close()).toEqual({ code: null });
  });
});

describe("CodexRpcClient against the recorded handshake", () => {
  test("initialize + account/read (logged out)", async () => {
    const proc = new FakeAppServerProcess(await loadFixture("recorded/handshake-logged-out.jsonl"));
    const notes: string[] = [];
    const client = new CodexRpcClient(proc, { onNotification: (n) => notes.push(n.method) });
    const init = await client.initialize();
    expect(init.platformOs).toBe("linux");
    const account = await client.request("account/read", { refreshToken: false });
    expect(account).toMatchObject({ account: null, requiresOpenaiAuth: true });
    expect(notes).toEqual(["remoteControl/status/changed"]);
    expect(proc.replayer.errors).toEqual([]);
    expect(proc.replayer.done).toBe(true);
    await client.close();
  });
});

test("isSubset", () => {
  expect(isSubset({ a: 1 }, { a: 1, b: 2 })).toBe(true);
  expect(isSubset({ a: [1, { b: 2 }] }, { a: [1, { b: 2, c: 3 }] })).toBe(true);
  expect(isSubset({ a: [1] }, { a: [1, 2] })).toBe(false);
  expect(isSubset({ a: 1 }, null)).toBe(false);
});
