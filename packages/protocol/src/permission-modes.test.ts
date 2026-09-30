import { describe, expect, test } from "bun:test";
import { parseClientCommand } from "./commands/index.ts";
import { PROVIDER_IDS } from "./enums.ts";
import {
  defaultPermissionMode,
  effectivePermissionMode,
  isPermissionModeFor,
  PERMISSION_MODES,
  permissionModesFor,
} from "./permission-modes.ts";

describe("permission modes (#166)", () => {
  test("defaults: Claude's auto mode, Codex's on-request, none elsewhere", () => {
    expect(defaultPermissionMode("claude-code")).toBe("auto");
    expect(defaultPermissionMode("codex")).toBe("on-request");
    for (const p of PROVIDER_IDS) {
      if (p !== "claude-code" && p !== "codex") expect(defaultPermissionMode(p)).toBeUndefined();
    }
  });

  test("values are per provider", () => {
    expect(permissionModesFor("claude-code")).toEqual(["auto", "default", "acceptEdits"]);
    expect(permissionModesFor("codex")).toEqual(["on-request", "never"]);
    expect(isPermissionModeFor("claude-code", "acceptEdits")).toBe(true);
    expect(isPermissionModeFor("claude-code", "never")).toBe(false);
    expect(isPermissionModeFor("codex", "auto")).toBe(false);
    expect(isPermissionModeFor("codex", "untrusted")).toBe(false);
    expect(isPermissionModeFor("claude-code", "bypassPermissions")).toBe(false);
  });

  test("the effective mode falls back to the default for unknown or missing values", () => {
    expect(effectivePermissionMode("claude-code", null)).toBe("auto");
    expect(effectivePermissionMode("claude-code", "never")).toBe("auto");
    expect(effectivePermissionMode("codex", "never")).toBe("never");
    expect(effectivePermissionMode("custom", "auto")).toBeUndefined();
  });

  test("agent.spawn accepts known modes and refuses anything else", () => {
    const base = { floorId: "f1", repoId: "r1", provider: "claude-code", model: "opus" };
    for (const permissionMode of PERMISSION_MODES) {
      expect(parseClientCommand("agent.spawn", { ...base, permissionMode }).success).toBe(true);
    }
    expect(parseClientCommand("agent.spawn", base).success).toBe(true);
    for (const permissionMode of ["bypassPermissions", "untrusted", "", "--yolo"]) {
      expect(parseClientCommand("agent.spawn", { ...base, permissionMode }).success).toBe(false);
    }
  });
});
