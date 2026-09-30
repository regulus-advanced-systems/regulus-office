import { afterAll, describe, expect, test } from "bun:test";
import { TERMINAL_MODES, type UserRole } from "@regulus/protocol";
import { MEMORY_DB_PATH, openDatabase, runMigrations } from "../db/index.ts";
import { floorMembers, floors, users } from "../db/schema/index.ts";
import { dbFloorVisibility, decideTerminalAccess, mayUseTerminal } from "./acl.ts";

const OWNER_ID = "robot-owner";
const everyFloor = () => true;

describe("terminal ACL (SPEC §8 rule 4, D12, #138)", () => {
  // role × (is the robot's owner) × mode → allowed
  const matrix: [UserRole, boolean, "watch" | "control", boolean][] = [
    ["owner", false, "watch", true],
    ["owner", false, "control", false],
    ["owner", true, "control", true],
    ["admin", false, "watch", true],
    ["admin", false, "control", false],
    ["admin", true, "control", true],
    ["member", true, "watch", true],
    ["member", true, "control", true],
    ["member", false, "watch", true],
    ["member", false, "control", false],
    ["viewer", false, "watch", true],
    ["viewer", false, "control", false],
    ["viewer", true, "control", false],
  ];

  for (const [role, isOwner, mode, allowed] of matrix) {
    test(`${role}${isOwner ? " (robot owner)" : ""} ${mode}: ${allowed ? "allowed" : "denied"}`, () => {
      const user = { id: isOwner ? OWNER_ID : `u-${role}`, role };
      expect(mayUseTerminal(user, OWNER_ID, mode)).toBe(allowed);
      const decision = decideTerminalAccess(
        user,
        { ownerUserId: OWNER_ID, floorId: "f1" },
        mode,
        everyFloor,
      );
      expect(decision).toEqual(allowed ? { ok: true } : { ok: false, reason: "forbidden" });
    });
  }

  test("an invisible floor hides the robot for every mode", () => {
    for (const mode of TERMINAL_MODES) {
      expect(
        decideTerminalAccess(
          { id: OWNER_ID, role: "owner" },
          { ownerUserId: OWNER_ID, floorId: "f1" },
          mode,
          () => false,
        ),
      ).toEqual({ ok: false, reason: "not_found" });
    }
  });
});

describe("dbFloorVisibility", () => {
  const db = openDatabase({ path: MEMORY_DB_PATH });
  runMigrations(db);
  afterAll(() => db.$client.close());
  const now = new Date();
  for (const id of ["m1", "m2", "v1"]) {
    db.insert(users)
      .values({
        id,
        name: id,
        email: `${id}@example.com`,
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
  db.insert(floors)
    .values([
      { id: "f1", name: "One", slug: "one", index: 1, paletteId: "p", layoutTemplateId: "t" },
      {
        id: "f2",
        name: "Two",
        slug: "two",
        index: 2,
        paletteId: "p",
        layoutTemplateId: "t",
        archivedAt: now,
      },
    ])
    .run();
  db.insert(floorMembers)
    .values([
      { floorId: "f1", userId: "m1", access: "spawn" },
      { floorId: "f1", userId: "v1", access: "view" },
      { floorId: "f2", userId: "m1", access: "manage" },
    ])
    .run();
  const canView = dbFloorVisibility(db);

  test("members need a membership row", () => {
    expect(canView({ id: "m1", role: "member" }, "f1")).toBe(true);
    expect(canView({ id: "m2", role: "member" }, "f1")).toBe(false);
    expect(canView({ id: "v1", role: "viewer" }, "f1")).toBe(true);
  });

  test("office owners and admins see every live floor", () => {
    expect(canView({ id: "m2", role: "admin" }, "f1")).toBe(true);
    expect(canView({ id: "m2", role: "owner" }, "f1")).toBe(true);
  });

  test("archived and unknown floors are invisible", () => {
    expect(canView({ id: "m1", role: "member" }, "f2")).toBe(false);
    expect(canView({ id: "m2", role: "owner" }, "f2")).toBe(false);
    expect(canView({ id: "m2", role: "owner" }, "nope")).toBe(false);
  });
});
