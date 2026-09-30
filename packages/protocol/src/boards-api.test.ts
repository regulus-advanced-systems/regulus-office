import { describe, expect, test } from "bun:test";
import {
  BoardAssignRequest,
  BoardCommentRequest,
  BoardMergeRequest,
  boardAssigneesPath,
  boardCardPath,
  MERGE_METHODS,
  mayCarryCard,
  mayWriteBoard,
} from "./boards-api.ts";
import { FLOOR_ACCESSES } from "./enums.ts";

describe("board ACL (#36)", () => {
  test("only floor managers write; spawners and managers carry cards", () => {
    expect(FLOOR_ACCESSES.filter(mayWriteBoard)).toEqual(["manage"]);
    expect(FLOOR_ACCESSES.filter(mayCarryCard)).toEqual(["manage", "spawn"]);
    expect(mayWriteBoard(null)).toBe(false);
    expect(mayCarryCard(undefined)).toBe(false);
  });
});

describe("board REST shapes", () => {
  test("paths encode their segments", () => {
    expect(boardCardPath("f 1", "pr", "r/1", 7, "merge")).toBe(
      "/api/boards/f%201/pr/r%2F1/7/merge",
    );
    expect(boardCardPath("f1", "issue", "r1", 3)).toBe("/api/boards/f1/issue/r1/3");
    expect(boardAssigneesPath("f1", "r1")).toBe("/api/boards/f1/r1/assignees");
  });

  test("comments are trimmed and bounded", () => {
    expect(BoardCommentRequest.parse({ body: "  hi  " })).toEqual({ body: "hi" });
    expect(BoardCommentRequest.safeParse({ body: "   " }).success).toBe(false);
    expect(BoardCommentRequest.safeParse({ body: "x".repeat(8001) }).success).toBe(false);
  });

  test("assign needs a change and valid logins", () => {
    expect(BoardAssignRequest.parse({ add: ["ada"] })).toEqual({ add: ["ada"], remove: [] });
    expect(BoardAssignRequest.safeParse({}).success).toBe(false);
    expect(BoardAssignRequest.safeParse({ add: ["bad login"] }).success).toBe(false);
    expect(BoardAssignRequest.safeParse({ add: ["../../x"] }).success).toBe(false);
  });

  test("merge methods", () => {
    for (const method of MERGE_METHODS) {
      expect(BoardMergeRequest.parse({ method })).toEqual({ method });
    }
    expect(BoardMergeRequest.safeParse({ method: "fast-forward" }).success).toBe(false);
  });
});
