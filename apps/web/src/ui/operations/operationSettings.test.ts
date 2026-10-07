import { describe, expect, test } from "bun:test";
import type { OfficeUserInfo, OperationInfo } from "@regulus/protocol";
import {
  addCandidates,
  canManageOperation,
  effectiveGrant,
  operationIdFromOverlay,
  operationSettingsOverlay,
} from "./operationSettings.ts";

const operation = (operationId: string, access: OperationInfo["access"]) =>
  ({ operationId, access }) as OperationInfo;
const person = (userId: string, displayName: string, role: OfficeUserInfo["role"]) => ({
  userId,
  displayName,
  role,
});

describe("operation settings helpers", () => {
  test("the overlay id carries the operation", () => {
    expect(operationIdFromOverlay(operationSettingsOverlay("f1"))).toBe("f1");
    expect(operationIdFromOverlay("settings")).toBeNull();
    expect(operationIdFromOverlay("operation-settings:")).toBeNull();
    expect(operationIdFromOverlay(null)).toBeNull();
  });

  test("only manage access opens the panel", () => {
    const operations = [
      operation("f1", "manage"),
      operation("f2", "spawn"),
      operation("f3", "view"),
    ];
    expect(canManageOperation(operations, "f1")).toBe(true);
    expect(canManageOperation(operations, "f2")).toBe(false);
    expect(canManageOperation(operations, "f3")).toBe(false);
    expect(canManageOperation(operations, "lobby")).toBe(false);
    expect(canManageOperation(null, "f1")).toBe(false);
    expect(canManageOperation(operations, null)).toBe(false);
  });

  test("candidates skip people with a limit, include office managers, and match by name", () => {
    const people = [
      person("u1", "Olga Owner", "owner"),
      person("u2", "Ada Admin", "admin"),
      person("u3", "Ben Member", "member"),
      person("u4", "Bea Viewer", "viewer"),
      person("u5", "Mia Member", "member"),
    ];
    const members = [{ userId: "u5", displayName: "Mia Member", access: "view" as const }];
    expect(addCandidates(people, members, "").map((p) => p.userId)).toEqual([
      "u1",
      "u2",
      "u3",
      "u4",
    ]);
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
