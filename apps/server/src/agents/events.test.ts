import { describe, expect, test } from "bun:test";
import { createFakeRunnerContext, FakeAdapter, Secret } from "@regulus/agent-adapters";
import type { AgentEvent } from "@regulus/protocol";
import { fanOutSink, MemoryEventSink, pipeEvents, validatingSink } from "./events.ts";

const status: AgentEvent = { kind: "status", ts: 1, status: "working" };

describe("MemoryEventSink", () => {
  test("records per agent and resolves waiters", async () => {
    const sink = new MemoryEventSink();
    const waiting = sink.next((e) => e.kind === "exit", "a2");
    sink.publish("a1", status);
    sink.publish("a1", { kind: "exit", ts: 2, code: 0 });
    sink.publish("a2", { kind: "exit", ts: 3, code: 1 });
    expect(await waiting).toEqual({ kind: "exit", ts: 3, code: 1 });
    expect(sink.for("a1").map((e) => e.kind)).toEqual(["status", "exit"]);
  });
});

describe("validatingSink", () => {
  test("drops invalid events and reports issues without the payload", () => {
    const inner = new MemoryEventSink();
    const invalid: string[][] = [];
    const sink = validatingSink(inner, (_id, issues) => invalid.push(issues));
    sink.publish("a1", status);
    sink.publish("a1", { kind: "status", ts: -1, status: "bogus", token: "secret" } as never);
    expect(inner.events).toHaveLength(1);
    expect(invalid).toHaveLength(1);
    expect(invalid.flat().join(" ")).not.toContain("secret");
  });
});

describe("fanOutSink + pipeEvents", () => {
  test("drains a FakeAdapter control into every sink", async () => {
    const a = new MemoryEventSink();
    const b = new MemoryEventSink();
    const adapter = new FakeAdapter({ script: [{ kind: "status", ts: 1, status: "idle" }] });
    const ctx = createFakeRunnerContext();
    const control = adapter.connect(
      adapter.buildSpawn(
        {
          agentId: "a1",
          provider: "custom",
          workdir: "/w",
          credential: { kind: "api_key", apiKey: Secret.of("k"), attributedTo: "office" },
        },
        ctx,
      ),
      ctx,
    );
    const done = pipeEvents("a1", control.events, fanOutSink(a, validatingSink(b)));
    await control.close();
    await done;
    expect(a.for("a1").map((e) => e.kind)).toEqual(["status", "exit"]);
    expect(b.for("a1")).toEqual(a.for("a1"));
  });

  test("routes ingested out-of-band payloads through the same sink", async () => {
    const sink = new MemoryEventSink();
    const adapter = new FakeAdapter({ id: "claude-code" });
    const payload = { kind: "status", ts: 9, status: "waiting_permission" };
    for (const event of adapter.ingest({ channel: "hook", agentId: "a1", payload })) {
      await sink.publish("a1", event);
    }
    expect(sink.for("a1")).toEqual([payload as AgentEvent]);
  });
});
