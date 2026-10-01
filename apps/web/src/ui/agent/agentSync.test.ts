import { describe, expect, test } from "bun:test";
import type { CommandRejected } from "@regulus/protocol";
import { create } from "zustand";
import type { OperationStore } from "../../state/operation.ts";
import { createAgentStore } from "./agentStore.ts";
import { syncAgentMessages } from "./agentSync.ts";

function fakeClient() {
  const listeners = new Map<string, (p: unknown) => void>();
  let rejected: ((n: CommandRejected) => void) | null = null;
  return {
    client: {
      onOperationMessage: (type: string, cb: (p: unknown) => void) => {
        listeners.set(type, cb);
        return () => listeners.delete(type);
      },
      onRejected: (cb: (n: CommandRejected) => void) => {
        rejected = cb;
        return () => {
          rejected = null;
        };
      },
    },
    emit: (type: string, payload: unknown) => listeners.get(type)?.(payload),
    reject: (n: CommandRejected) => rejected?.(n),
    count: () => listeners.size,
  };
}

function setup() {
  const fake = fakeClient();
  const store = createAgentStore();
  const operation = create<OperationStore>()((set) => ({
    operationId: "f1",
    state: null,
    apply: () => undefined,
    setOperationId: (operationId) => set({ operationId }),
    clear: () => set({ operationId: null }),
  }));
  const toasts: string[] = [];
  const leaving: string[] = [];
  const off = syncAgentMessages({
    client: fake.client as never,
    store,
    operation,
    toast: (t) => toasts.push(t.message),
    onLeaving: (id) => leaving.push(id),
  });
  return { fake, store, operation, toasts, leaving, off };
}

describe("agent message sync", () => {
  test("valid permissions and results reach the store; malformed ones are ignored", () => {
    const { fake, store } = setup();
    fake.emit("agent.permissions", { agentId: "a1", requests: [{ requestId: "p1" }] });
    expect(store.getState().permissions).toEqual({});
    fake.emit("agent.permissions", {
      agentId: "a1",
      requests: [
        {
          requestId: "p1",
          toolName: "Bash",
          description: "ls",
          options: ["reject"],
          requestedAt: 1,
        },
      ],
    });
    expect(store.getState().permissions.a1).toHaveLength(1);
    fake.emit("agent.result", {
      type: "agent.worktree",
      agentId: "a1",
      worktree: { branch: "office/x", uncommitted: ["a.ts"] },
    });
    expect(store.getState().worktree.a1?.uncommitted).toEqual(["a.ts"]);
  });

  test("agent rejections are recorded with files; others are left to their owners", () => {
    const { fake, store, toasts } = setup();
    fake.reject({ type: "chat", reason: "too long" });
    fake.reject({ type: "agent.pr", reason: "dirty", agentId: "a1", files: ["x.ts"] });
    fake.reject({ type: "agent.stop", reason: "forbidden", agentId: "a1" });
    expect(store.getState().refusal.a1).toEqual({ type: "agent.stop", reason: "forbidden" });
    expect(toasts).toEqual(["forbidden"]);
  });

  test("a henchman leaving starts its walk and is forgotten; an operation change resets", () => {
    const { fake, store, operation, leaving, off } = setup();
    store.getState().openAgentPanel("a1");
    fake.emit("agent.leaving", { agentId: "a1", reason: "sent_home" });
    expect(leaving).toEqual(["a1"]);
    expect(store.getState().panelAgentId).toBeNull();
    store.getState().openAgentPanel("a2");
    operation.getState().setOperationId("f2");
    expect(store.getState().panelAgentId).toBeNull();
    off();
    expect(fake.count()).toBe(0);
  });
});
