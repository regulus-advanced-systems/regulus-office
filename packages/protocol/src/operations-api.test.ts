import { describe, expect, test } from "bun:test";
import { OPERATION_ACCESSES, REPO_CLONE_STATUSES } from "./enums.ts";
import {
  CreateOperationRequest,
  DeleteOperationRequest,
  hasOperationAccess,
  MAX_REPOS_PER_OPERATION,
  ONE_REPO_PER_ROOM_MESSAGE,
  OperationHasHenchmenResponse,
  OperationInfo,
  RepoToken,
} from "./operations-api.ts";

describe("operations REST shapes", () => {
  test("create request defaults the tier and takes exactly one repo", () => {
    const parsed = CreateOperationRequest.parse({
      name: " Apollo ",
      repos: [{ repo: "octo/hello" }],
    });
    expect(parsed).toEqual({ name: "Apollo", tier: "medium", repos: [{ repo: "octo/hello" }] });
    expect(CreateOperationRequest.safeParse({ name: "x", repos: [] }).success).toBe(false);
    // The room's lair style rides along (#282); the old office palette is no longer read.
    const styled = { name: "x", repos: [{ repo: "o/r" }], decorStyle: "armory", paletteId: "p" };
    expect(CreateOperationRequest.parse(styled)).toEqual({
      name: "x",
      tier: "medium",
      decorStyle: "armory",
      repos: [{ repo: "o/r" }],
    });
    expect(CreateOperationRequest.safeParse({ ...styled, decorStyle: "disco" }).success).toBe(
      false,
    );
    const many = Array.from({ length: MAX_REPOS_PER_OPERATION + 1 }, (_, i) => ({
      repo: `o/r${i}`,
    }));
    const refused = CreateOperationRequest.safeParse({ name: "x", repos: many });
    expect(MAX_REPOS_PER_OPERATION).toBe(1);
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.message).toBe(ONE_REPO_PER_ROOM_MESSAGE);
  });

  test("tokens cannot carry whitespace or header breaks", () => {
    expect(RepoToken.safeParse("github_pat_FAKE0123456789").success).toBe(true);
    expect(RepoToken.safeParse("abc\r\nX-Evil: 1").success).toBe(false);
    expect(RepoToken.safeParse("has space inside").success).toBe(false);
    expect(RepoToken.safeParse("short").success).toBe(false);
  });

  test("operation info never has a token field and reports clone status", () => {
    const info = OperationInfo.parse({
      operationId: "f1",
      levelId: "lv1",
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
    expect(OPERATION_ACCESSES.filter((a) => hasOperationAccess(a, "spawn"))).toEqual([
      "manage",
      "spawn",
    ]);
    expect(hasOperationAccess("view", "view")).toBe(true);
    expect(hasOperationAccess(null, "view")).toBe(false);
  });

  test("delete needs the typed name; a refusal lists the henchmen on the operation", () => {
    expect(DeleteOperationRequest.safeParse({}).success).toBe(false);
    expect(DeleteOperationRequest.parse({ confirmName: "Apollo" })).toEqual({
      confirmName: "Apollo",
    });
    const refused = OperationHasHenchmenResponse.parse({
      error: "operation_has_henchmen",
      henchmen: [
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
    expect(refused.henchmen[0]?.status).toBe("working");
    expect(
      OperationHasHenchmenResponse.safeParse({ error: "operation_busy", henchmen: [] }).success,
    ).toBe(false);
  });
});
