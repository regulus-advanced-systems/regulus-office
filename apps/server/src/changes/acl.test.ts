import { describe, expect, test } from "bun:test";
import type { UserRole } from "@regulus/protocol";
import { decideChangesAccess, mayWriteChanges } from "./acl.ts";

const robot = { ownerUserId: "rob", floorId: "f1" };
const onFloor = new Set(["rob", "mia", "vic", "ada", "olga"]);
const canView = (u: { id: string }) => onFloor.has(u.id);
const u = (id: string, role: UserRole) => ({ id, role });

describe("changes window ACL (D12)", () => {
  test.each([
    ["robot owner", u("rob", "member"), { ok: true }, { ok: true }],
    [
      "other member",
      u("mia", "member"),
      { ok: true },
      { ok: false, status: 403, code: "owner_only" },
    ],
    ["viewer", u("vic", "viewer"), { ok: true }, { ok: false, status: 403, code: "owner_only" }],
    ["admin", u("ada", "admin"), { ok: true }, { ok: false, status: 403, code: "owner_only" }],
    [
      "office owner",
      u("olga", "owner"),
      { ok: true },
      { ok: false, status: 403, code: "owner_only" },
    ],
    [
      "off the floor",
      u("otto", "member"),
      { ok: false, status: 404, code: "not_found" },
      { ok: false, status: 404, code: "not_found" },
    ],
  ] as const)("%s", (_name, user, view, write) => {
    expect(decideChangesAccess(user, robot, "view", canView)).toEqual(view);
    expect(decideChangesAccess(user, robot, "write", canView)).toEqual(write);
  });

  test("a viewer never writes, even on their own robot", () => {
    expect(mayWriteChanges(u("rob", "viewer"), "rob")).toBe(false);
    expect(decideChangesAccess(u("rob", "viewer"), robot, "write", canView).ok).toBe(false);
    expect(mayWriteChanges(u("rob", "member"), "rob")).toBe(true);
  });
});
