import { describe, expect, test } from "bun:test";
import {
  largeTemplate,
  lobbyTemplate,
  officeL2Template,
  type RoomTemplate,
  smallTemplate,
} from "@regulus/room-layout";
import type { BoardColumnView } from "../../ui/boards/columns.ts";
import { boardAnchors, boardInReach } from "./boardAnchors.ts";
import {
  type BoardCanvas,
  fitText,
  layoutBoard,
  layoutKey,
  paintBoard,
  textureSize,
} from "./boardTexture.ts";

const column = (id: string, n: number): BoardColumnView => ({
  id: id as BoardColumnView["id"],
  title: id,
  cards: Array.from({ length: n }, (_, i) => ({
    key: `r1#${i + 1}`,
    kind: "issue" as const,
    repoId: "r1",
    number: i + 1,
    title: `Card ${i + 1}`,
    column: id as BoardColumnView["id"],
    repoChip: "",
    assignees: [],
    labels: [],
    checks: i === 0 ? { label: "Checks failing", tone: "red" as const, glyph: "x" } : null,
    review: null,
    updatedAt: 0,
  })),
});

describe("board anchors", () => {
  test("every project template hangs one issue and one PR board; the lobby none", () => {
    for (const t of [smallTemplate, officeL2Template, largeTemplate] as RoomTemplate[]) {
      expect(
        boardAnchors(t)
          .map((b) => b.kind)
          .sort(),
      ).toEqual(["issue", "pr"]);
    }
    expect(boardAnchors(lobbyTemplate)).toEqual([]);
  });

  test("boards follow the anchors they are given (compound rooms move them)", () => {
    const pr = smallTemplate.wallAnchors.find((a) => a.kind === "pr_board");
    if (!pr) throw new Error("no PR board anchor");
    const moved: RoomTemplate = {
      ...smallTemplate,
      wallAnchors: [{ ...pr, id: "pr-x" }],
    };
    expect(boardAnchors(moved).map((b) => [b.anchor.id, b.kind])).toEqual([["pr-x", "pr"]]);
  });

  test("E reaches the nearest board within the radius", () => {
    const boards = boardAnchors(smallTemplate);
    const issue = boards.find((b) => b.kind === "issue");
    if (!issue) throw new Error("no issue board");
    expect(boardInReach(boards, issue.stand)?.kind).toBe("issue");
    expect(boardInReach(boards, { x: issue.stand.x + 0.5, z: issue.stand.z })?.kind).toBe("issue");
    expect(boardInReach(boards, { x: 99, z: 99 })).toBeNull();
  });
});

describe("board texture", () => {
  test("size follows the anchor", () => {
    expect(textureSize(1.8, 1.2)).toEqual({ width: 576, height: 384 });
  });

  test("columns split the width; cards that do not fit become +N more", () => {
    const layout = layoutBoard(
      [column("open", 2), column("in_progress", 30), column("closed", 0)],
      {
        width: 576,
        height: 384,
      },
    );
    expect(layout.columns).toHaveLength(3);
    const [a, b, c] = layout.columns;
    expect(a?.cards).toHaveLength(2);
    expect(a?.hidden).toBe(0);
    expect(a?.cards[0]?.tab).toBe("red");
    expect((b?.cards.length ?? 0) + (b?.hidden ?? 0)).toBe(30);
    expect(b?.hidden).toBeGreaterThan(0);
    const last = b?.cards.at(-1);
    expect((last?.y ?? 0) + (last?.h ?? 0)).toBeLessThan(384);
    expect(c?.cards).toEqual([]);
    expect((c?.x ?? 0) + (c?.w ?? 0)).toBeLessThanOrEqual(576);
  });

  test("text is cut to fit with an ellipsis", () => {
    const ctx = { measureText: (t: string) => ({ width: t.length * 10 }) };
    expect(fitText(ctx, "short", 100)).toBe("short");
    expect(fitText(ctx, "a much longer title", 80)).toBe("a much…");
  });

  test("painting draws every card and the overflow note", () => {
    const texts: string[] = [];
    const ctx: BoardCanvas = {
      fillStyle: "",
      font: "",
      textBaseline: "alphabetic",
      fillRect: () => {},
      fillText: (t) => texts.push(t),
      measureText: (t) => ({ width: t.length * 6 }),
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
    };
    paintBoard(
      ctx,
      layoutBoard([column("open", 1), column("closed", 20)], { width: 576, height: 384 }),
    );
    expect(texts).toContain("open (1)");
    expect(texts).toContain("#1");
    expect(texts.some((t) => /^\+\d+ more$/.test(t))).toBe(true);
  });

  test("the repaint key changes with the cards", () => {
    expect(layoutKey([column("open", 2)])).toBe(layoutKey([column("open", 2)]));
    expect(layoutKey([column("open", 2)])).not.toBe(layoutKey([column("open", 3)]));
  });
});
