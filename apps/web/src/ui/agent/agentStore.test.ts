import { describe, expect, test } from "bun:test";
import type { PendingPermission } from "@regulus/protocol";
import { createAgentStore } from "./agentStore.ts";

const req = (requestId: string): PendingPermission => ({
  requestId,
  toolName: "Bash",
  description: "Bash: ls",
  options: ["allow_once", "reject"],
  requestedAt: 1,
});

describe("agent store", () => {
  test("a new request pops the prompt; closing dismisses it until a new one comes", () => {
    const store = createAgentStore();
    store.getState().setPermissions("a1", [req("p1")]);
    expect(store.getState().permissionAgentId).toBe("a1");
    store.getState().closePermissionPrompt();
    expect(store.getState().permissionAgentId).toBeNull();
    store.getState().setPermissions("a1", [req("p1")]);
    expect(store.getState().permissionAgentId).toBeNull();
    store.getState().setPermissions("a1", [req("p1"), req("p2")]);
    expect(store.getState().permissionAgentId).toBe("a1");
    store.getState().setPermissions("a1", []);
    expect(store.getState().permissionAgentId).toBeNull();
    expect(store.getState().permissions).toEqual({});
  });

  test("results and refusals settle in-flight commands", () => {
    const store = createAgentStore();
    store.getState().openAgentPanel("a1");
    store.getState().started("a1", "agent.pr");
    expect(store.getState().inFlight).toEqual({ "a1|agent.pr": true });
    store.getState().refused("a1", { type: "agent.pr", reason: "dirty", files: ["a.ts"] });
    expect(store.getState().inFlight).toEqual({});
    expect(store.getState().refusal.a1?.files).toEqual(["a.ts"]);
    store.getState().started("a1", "agent.pr");
    expect(store.getState().refusal.a1).toBeUndefined();
    store.getState().succeeded({
      type: "agent.pr",
      agentId: "a1",
      pr: {
        number: 4,
        url: "https://github.com/o/r/pull/4",
        draft: false,
        created: true,
        branch: "b",
      },
    });
    expect(store.getState().pullRequest.a1?.number).toBe(4);
    store.getState().succeeded({ type: "agent.sendHome", agentId: "a1" });
    expect(store.getState().panelAgentId).toBeNull();
  });

  test("forget drops everything about a robot", () => {
    const store = createAgentStore();
    store.getState().openAgentPanel("a1");
    store.getState().setPermissions("a1", [req("p1")]);
    store.getState().forget("a1");
    expect(store.getState()).toMatchObject({
      panelAgentId: null,
      permissionAgentId: null,
      permissions: {},
    });
  });
});
