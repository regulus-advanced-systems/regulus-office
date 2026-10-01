import { describe, expect, test } from "bun:test";
import { OperationStateSchema, type ServiceState } from "@regulus/protocol";
import { parseServices, syncServices } from "./services.ts";

const svc = (id: string, port: number, patch: Partial<ServiceState> = {}): ServiceState => ({
  id,
  agentId: "a1",
  port,
  url: `/p/f1/a/a1/port/${port}/`,
  title: `Port ${port}`,
  pid: 7,
  address: "0.0.0.0",
  localOnly: false,
  shared: false,
  firstSeenAt: 1,
  lastSeenAt: 2,
  ...patch,
});

describe("operation services state", () => {
  test("adds, updates in place and removes", () => {
    const state = new OperationStateSchema();
    syncServices(state, [svc("s1", 3000), svc("s2", 5173)]);
    const first = state.services.get("s1");
    syncServices(state, [svc("s1", 3000, { title: "Vite", localOnly: true })]);
    expect([...state.services.keys()]).toEqual(["s1"]);
    expect(state.services.get("s1")).toBe(first);
    expect(state.services.get("s1")?.title).toBe("Vite");
    expect(state.services.get("s1")?.localOnly).toBe(true);
    syncServices(state, []);
    expect(state.services.size).toBe(0);
  });

  test("validated against the protocol", () => {
    expect(() => parseServices([svc("s1", 70_000)])).toThrow();
    expect(parseServices([svc("s1", 3000)])).toHaveLength(1);
  });
});
