import { describe, expect, test } from "bun:test";
import { useDom } from "../a11y/dom.ts";
import { BOARD_COLUMN_WIDTH, BoardColumns, boardPanelWidth, CardButton } from "./BoardPanel.tsx";
import type { BoardCardView } from "./columns.ts";
import { renderPlain, text } from "./testDom.tsx";

useDom();

const card = (over: Partial<BoardCardView> = {}): BoardCardView => ({
  key: "r1#7",
  kind: "issue",
  repoId: "r1",
  number: 7,
  title: "Fix the lift doors",
  column: "open",
  repoChip: "",
  assignees: [],
  labels: [],
  queued: false,
  checks: null,
  review: null,
  updatedAt: 0,
  ...over,
});

describe("board card (#237)", () => {
  test("shows labels and assignees, which no longer move the card", async () => {
    const m = await renderPlain(
      <ul>
        <CardButton card={card({ labels: ["bug", "wip"], assignees: ["ada"] })} onOpen={() => {}} />
      </ul>,
    );
    const labels = document.querySelector('[aria-label="Labels"]');
    expect(Array.from(labels?.children ?? []).map((l) => l.textContent)).toEqual(["bug", "wip"]);
    expect(document.querySelector('[aria-label="Assignees"]')?.textContent).toBe("@ada");
    expect(text()).not.toContain("Queued");
    await m.unmount();
  });

  test("a queued issue shows a Queued chip", async () => {
    const m = await renderPlain(
      <ul>
        <CardButton card={card({ queued: true })} onOpen={() => {}} />
      </ul>,
    );
    expect(text()).toContain("Queued");
    expect(document.querySelector('[aria-label="Labels"]')).toBeNull();
    await m.unmount();
  });
});

describe("the board window is wide (#282)", () => {
  test("every column gets its width; the window never asks for less than a desktop's worth", () => {
    // Issue board: three columns. PR board: five; the Modal caps it at the screen.
    expect(boardPanelWidth(3, false)).toBeGreaterThanOrEqual(3 * BOARD_COLUMN_WIDTH);
    expect(boardPanelWidth(5, false)).toBeGreaterThanOrEqual(5 * BOARD_COLUMN_WIDTH);
    expect(boardPanelWidth(5, false)).toBeGreaterThan(boardPanelWidth(3, false));
    expect(boardPanelWidth(1, false)).toBe(960);
    // Far wider than the 220px a column used to get.
    expect(BOARD_COLUMN_WIDTH).toBeGreaterThanOrEqual(320);
    // A card's detail is one column of text.
    expect(boardPanelWidth(5, true)).toBe(boardPanelWidth(3, true));
  });

  test("columns are a labelled, focusable scroll region; a title carries its full text", async () => {
    const long = "web: walkthrough fixes: lair names for a new operation's style and more";
    const m = await renderPlain(
      <BoardColumns
        columns={[{ id: "open", title: "Open", cards: [card({ title: long })] }]}
        onOpen={() => {}}
      />,
    );
    const region = document.querySelector(".rg-board__columns");
    expect(region?.getAttribute("aria-label")).toBe("Columns");
    expect(region?.getAttribute("tabindex")).toBe("0");
    const title = document.querySelector(".rg-board__card-title");
    expect(title?.textContent).toBe(long);
    expect(title?.getAttribute("title")).toBe(long);
    await m.unmount();
  });
});
