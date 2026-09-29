import { describe, expect, test } from "bun:test";
import type { FloorInfo, OfficeUserInfo } from "@regulus/protocol";
import {
  addCandidates,
  canManageFloor,
  effectiveGrant,
  floorIdFromOverlay,
  floorSettingsOverlay,
} from "./floorSettings.ts";

const floor = (floorId: string, access: FloorInfo["access"]) => ({ floorId, access }) as FloorInfo;
const person = (userId: string, displayName: string, role: OfficeUserInfo["role"]) => ({
  userId,
  displayName,
  role,
});

describe("floor settings helpers", () => {
  test("the overlay id carries the floor", () => {
    expect(floorIdFromOverlay(floorSettingsOverlay("f1"))).toBe("f1");
    expect(floorIdFromOverlay("settings")).toBeNull();
    expect(floorIdFromOverlay("floor-settings:")).toBeNull();
    expect(floorIdFromOverlay(null)).toBeNull();
  });

  test("only manage access opens the panel", () => {
    const floors = [floor("f1", "manage"), floor("f2", "spawn"), floor("f3", "view")];
    expect(canManageFloor(floors, "f1")).toBe(true);
    expect(canManageFloor(floors, "f2")).toBe(false);
    expect(canManageFloor(floors, "f3")).toBe(false);
    expect(canManageFloor(floors, "lobby")).toBe(false);
    expect(canManageFloor(null, "f1")).toBe(false);
    expect(canManageFloor(floors, null)).toBe(false);
  });

  test("candidates skip members and office managers and match by name", () => {
    const people = [
      person("u1", "Olga Owner", "owner"),
      person("u2", "Ada Admin", "admin"),
      person("u3", "Ben Member", "member"),
      person("u4", "Bea Viewer", "viewer"),
      person("u5", "Mia Member", "member"),
    ];
    const members = [{ userId: "u5", displayName: "Mia Member", access: "view" as const }];
    expect(addCandidates(people, members, "").map((p) => p.userId)).toEqual(["u3", "u4"]);
    expect(addCandidates(people, members, "  be ").map((p) => p.userId)).toEqual(["u3", "u4"]);
    expect(addCandidates(people, members, "viewer").map((p) => p.userId)).toEqual(["u4"]);
    expect(addCandidates(people, members, "zed")).toEqual([]);
  });

  test("viewers are only ever granted view", () => {
    expect(effectiveGrant("viewer", "manage")).toBe("view");
    expect(effectiveGrant("member", "spawn")).toBe("spawn");
    expect(effectiveGrant(undefined, "manage")).toBe("manage");
  });
});
