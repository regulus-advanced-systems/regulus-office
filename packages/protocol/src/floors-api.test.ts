import { describe, expect, test } from "bun:test";
import { FLOOR_ACCESSES, REPO_CLONE_STATUSES } from "./enums.ts";
import {
  CreateFloorRequest,
  DeleteFloorRequest,
  FloorHasRobotsResponse,
  FloorInfo,
  hasFloorAccess,
  MAX_REPOS_PER_FLOOR,
  RepoToken,
} from "./floors-api.ts";

describe("floors REST shapes", () => {
  test("create request defaults the tier and requires at least one repo", () => {
    const parsed = CreateFloorRequest.parse({ name: " Apollo ", repos: [{ repo: "octo/hello" }] });
    expect(parsed).toEqual({ name: "Apollo", tier: "medium", repos: [{ repo: "octo/hello" }] });
    expect(CreateFloorRequest.safeParse({ name: "x", repos: [] }).success).toBe(false);
    const many = Array.from({ length: MAX_REPOS_PER_FLOOR + 1 }, (_, i) => ({ repo: `o/r${i}` }));
    expect(CreateFloorRequest.safeParse({ name: "x", repos: many }).success).toBe(false);
  });

  test("tokens cannot carry whitespace or header breaks", () => {
    expect(RepoToken.safeParse("github_pat_FAKE0123456789").success).toBe(true);
    expect(RepoToken.safeParse("abc\r\nX-Evil: 1").success).toBe(false);
    expect(RepoToken.safeParse("has space inside").success).toBe(false);
    expect(RepoToken.safeParse("short").success).toBe(false);
  });

  test("floor info never has a token field and reports clone status", () => {
    const info = FloorInfo.parse({
      floorId: "f1",
      name: "Apollo",
      slug: "apollo",
      index: 1,
      paletteId: "oak-sky",
      layoutTemplateId: "office-l2",
      archivedAt: null,
      access: "manage",
      repos: [
        {
          repoId: "r1",
          owner: "octo",
          name: "hello",
          url: "https://github.com/octo/hello",
          defaultBranch: "main",
          isPrimary: true,
          cloneStatus: "cloning",
          cloneError: null,
          hasCredential: true,
          token: "should be stripped",
        },
      ],
    });
    expect(Object.keys(info.repos[0] ?? {})).not.toContain("token");
    expect(REPO_CLONE_STATUSES).toEqual(["cloning", "ready", "error"]);
  });

  test("access ranks: manage > spawn > view", () => {
    expect(FLOOR_ACCESSES.filter((a) => hasFloorAccess(a, "spawn"))).toEqual(["manage", "spawn"]);
    expect(hasFloorAccess("view", "view")).toBe(true);
    expect(hasFloorAccess(null, "view")).toBe(false);
  });

  test("delete needs the typed name; a refusal lists the robots on the floor", () => {
    expect(DeleteFloorRequest.safeParse({}).success).toBe(false);
    expect(DeleteFloorRequest.parse({ confirmName: "Apollo" })).toEqual({ confirmName: "Apollo" });
    const refused = FloorHasRobotsResponse.parse({
      error: "floor_has_robots",
      robots: [
        {
          agentId: "a1",
          ownerUserId: "u1",
          ownerName: "Ben",
          status: "working",
          taskTitle: "Fix it",
          running: true,
        },
      ],
    });
    expect(refused.robots[0]?.status).toBe("working");
    expect(FloorHasRobotsResponse.safeParse({ error: "floor_busy", robots: [] }).success).toBe(
      false,
    );
  });
});
