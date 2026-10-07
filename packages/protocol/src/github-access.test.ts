import { describe, expect, test } from "bun:test";
import {
  GITHUB_REPO_PERMISSIONS,
  GitHubLinkStatus,
  isGitHubRepoPermission,
  operationAccessForRepoPermission,
  repoPermissionAtLeast,
} from "./github-access.ts";

describe("GitHub access (#267)", () => {
  test("permission levels are GitHub's, lowest to highest", () => {
    expect([...GITHUB_REPO_PERMISSIONS]).toEqual([
      "none",
      "read",
      "triage",
      "write",
      "maintain",
      "admin",
    ]);
    expect(isGitHubRepoPermission("maintain")).toBe(true);
    expect(isGitHubRepoPermission("owner")).toBe(false);
    expect(repoPermissionAtLeast("write", "read")).toBe(true);
    expect(repoPermissionAtLeast("triage", "write")).toBe(false);
    expect(repoPermissionAtLeast("none", "none")).toBe(true);
  });

  test("read and triage view, write and maintain work, admin manages, none gets nothing", () => {
    expect(GITHUB_REPO_PERMISSIONS.map((p) => [p, operationAccessForRepoPermission(p)])).toEqual([
      ["none", null],
      ["read", "view"],
      ["triage", "view"],
      ["write", "spawn"],
      ["maintain", "spawn"],
      ["admin", "manage"],
    ]);
  });

  test("the link status has no field for a token", () => {
    const parsed = GitHubLinkStatus.parse({
      available: true,
      unavailableReason: null,
      state: "linked",
      login: "octocat",
      linkedAt: 1,
      lastCheckedAt: 2,
      lastError: null,
      organizations: ["octo"],
      repos: [{ repoId: "r1", fullName: "octo/hello", permission: "write", access: "spawn" }],
      token: "gho_shouldBeDropped0123456789",
    });
    expect(JSON.stringify(parsed)).not.toContain("gho_");
  });
});
