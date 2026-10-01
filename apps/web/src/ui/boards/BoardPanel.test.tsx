import { describe, expect, test } from "bun:test";
import { useDom } from "../a11y/dom.ts";
import { CardButton } from "./BoardPanel.tsx";
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
