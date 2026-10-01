import { describe, expect, test } from "bun:test";
import type { PendingPermission } from "@regulus/protocol";
import { PendingPermissions } from "./permissions.ts";

function setup() {
  const changes: { agentId: string; ids: string[] }[] = [];
  const timers = new Map<number, () => void>();
  let seq = 0;
  const pending = new PendingPermissions({
    now: () => 1000,
    onChange: (agentId, requests: PendingPermission[]) =>
      changes.push({ agentId, ids: requests.map((r) => r.requestId) }),
    setTimer: (fn) => {
      seq += 1;
      timers.set(seq, fn);
      return seq;
    },
    clearTimer: (h) => timers.delete(h as number),
  });
  return { pending, changes, timers };
}

const event = (requestId: string) => ({
  kind: "permission_request" as const,
  ts: 1,
  requestId,
  toolName: "Edit",
  description: "Edit: src/a.ts",
  options: ["allow_once" as const, "reject" as const],
});

describe("PendingPermissions", () => {
  test("records, lists, removes one and clears all, notifying every change", () => {
    const { pending, changes } = setup();
    pending.add("a1", event("p1"), 5000);
    pending.add("a1", event("p2"), 5000);
    expect(pending.list("a1")).toEqual([
      expect.objectContaining({ requestId: "p1", requestedAt: 1000, expiresAt: 6000 }),
      expect.objectContaining({ requestId: "p2" }),
    ]);
    pending.remove("a1", "p1");
    pending.remove("a1", "nope");
    pending.clear("a1");
    pending.clear("a1");
    expect(changes).toEqual([
      { agentId: "a1", ids: ["p1"] },
      { agentId: "a1", ids: ["p1", "p2"] },
      { agentId: "a1", ids: ["p2"] },
      { agentId: "a1", ids: [] },
    ]);
  });

  test("expires a request when its timer fires; re-adding replaces it", () => {
    const { pending, timers } = setup();
    pending.add("a1", event("p1"), 5000);
    pending.add("a1", event("p1"), 5000);
    expect(timers.size).toBe(1);
    for (const fire of [...timers.values()]) fire();
    expect(pending.list("a1")).toEqual([]);
    expect(pending.has("a1", "p1")).toBe(false);
  });

  test("keeps at most 20 per henchman, dropping the oldest", () => {
    const { pending } = setup();
    for (let i = 0; i < 25; i++) pending.add("a1", event(`p${i}`), 5000);
    const ids = pending.list("a1").map((r) => r.requestId);
    expect(ids).toHaveLength(20);
    expect(ids[0]).toBe("p5");
  });
});
