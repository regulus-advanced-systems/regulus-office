/**
 * The bookshelf reader (#264): opening the shelf, moving between documents,
 * filtering and searching, a shelf that closes while it is read, and the
 * keys it leaves alone.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BookshelfListing } from "@regulus/protocol";
import { generateRoom } from "@regulus/room-layout";
import { act } from "react";
import { pageTurnGain } from "../../audio/pageTurn.ts";
import { shelfInReach, shelfSpot } from "../../scene/bookshelf/shelfSpot.ts";
import { useOperationStore } from "../../state/operation.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { hotkeys, isEditableTarget } from "../hotkeys/registry.ts";
import { TERMINAL_OVERLAY_ID } from "../terminal/TerminalModal.tsx";
import { WHITEBOARD_OVERLAY } from "../whiteboard/whiteboardStore.ts";
import { createSlugger, findAnchor, headingSlug } from "./anchors.ts";
import type { BookshelfApi, ShelfFailure } from "./api.ts";
import { BookshelfHost } from "./BookshelfHost.tsx";
import { SHELF_SEARCH_DEBOUNCE_MS } from "./BookshelfPanel.tsx";
import { BOOKSHELF_OVERLAY, useBookshelfStore } from "./bookshelfStore.ts";
import { groupByFolder } from "./shelfModel.ts";

useDom();

const LISTING: BookshelfListing = {
  state: "ready",
  repo: "octo/hello",
  branch: "main",
  commit: "abc1234567",
  docs: [
    { path: "README.md", size: 40, tooLarge: false },
    { path: "docs/guide.md", size: 60, tooLarge: false },
    { path: "docs/huge.md", size: 9_000_000, tooLarge: true },
  ],
  total: 3,
  fetchedAt: null,
};

const DOCS: Record<string, string> = {
  "README.md": "# Hello\n\nRead [the guide](docs/guide.md#setup).",
  "docs/guide.md": "# Guide\n\n## Setup\n\nneedle here\n\n<script>window.pwned = 1</script>",
};

function fakeApi(fail: { listing?: ShelfFailure; document?: ShelfFailure } = {}) {
  const calls: string[] = [];
  const state = { fail };
  const api: BookshelfApi = {
    listing: async (operationId) => {
      calls.push(`list:${operationId}`);
      return state.fail.listing
        ? { ok: false, error: state.fail.listing }
        : { ok: true, data: LISTING };
    },
    document: async (operationId, path) => {
      calls.push(`doc:${path}`);
      if (state.fail.document) return { ok: false, error: state.fail.document };
      return {
        ok: true,
        data: { path, commit: "abc1234567", size: 1, markdown: DOCS[path] ?? "" },
      };
    },
    search: async (_operationId, q) => {
      calls.push(`search:${q}`);
      return {
        ok: true,
        data: { hits: [{ path: "docs/guide.md", line: 5, text: "needle here" }], truncated: false },
      };
    },
  };
  return { api, calls, state };
}

const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const text = (selector: string) => document.querySelector(selector)?.textContent ?? "";

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    // react-dom loaded before happy-dom registered: its keyup fallback reports the change.
    input.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true }));
  });
}

let mounted: Mounted | null = null;
beforeEach(() => {
  useBookshelfStore.getState().close();
  useUiStore.setState({ overlay: null });
  useOperationStore.setState({ operationId: "op-1" });
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  useOperationStore.setState({ operationId: null });
});

describe("the bookshelf reader", () => {
  test("closed until the shelf is used; then it lists the docs and opens the README", async () => {
    const { api, calls } = fakeApi();
    mounted = await mount(<BookshelfHost api={api} />);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(calls).toEqual([]);

    await act(async () => useBookshelfStore.getState().openShelf("op-1"));
    await settle();
    expect(calls).toEqual(["list:op-1", "doc:README.md"]);
    expect(useUiStore.getState().overlay).toBe(BOOKSHELF_OVERLAY);
    expect(text(".rg-modal__title")).toBe("Bookshelf: octo/hello");
    const names = [...document.querySelectorAll(".rg-shelf__doc")].map((b) => b.textContent);
    expect(names).toEqual(["README.md", "guide.md", "huge.md"]);
    expect(
      document.querySelector<HTMLButtonElement>('[title="Too large to open here"]')?.disabled,
    ).toBe(true);
    expect(text(".rg-doc h1")).toBe("Hello");
    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe("README.md");
  });

  test("a link to another document opens it in the reader, and Back returns", async () => {
    const { api, calls } = fakeApi();
    mounted = await mount(<BookshelfHost api={api} />);
    await act(async () => useBookshelfStore.getState().openShelf("op-1"));
    await settle();
    const link = document.querySelector<HTMLAnchorElement>("a.rg-doc__ref");
    if (!link) throw new Error("no link");
    await click(link);
    await settle();
    expect(calls.at(-1)).toBe("doc:docs/guide.md");
    expect(useBookshelfStore.getState().page).toEqual({ path: "docs/guide.md", anchor: "setup" });
    expect(text(".rg-doc h1")).toBe("Guide");
    // The document's raw HTML is on the page as text; nothing ran.
    expect(document.querySelector(".rg-doc script")).toBeNull();
    expect((window as { pwned?: number }).pwned).toBeUndefined();
    expect(text(".rg-doc")).toContain("<script>window.pwned = 1</script>");

    const back = [...document.querySelectorAll("button")].find((b) => b.textContent === "Back");
    if (!back) throw new Error("no Back");
    await click(back);
    await settle();
    expect(text(".rg-doc h1")).toBe("Hello");
  });

  test("the box filters file names at once and searches the text after a pause", async () => {
    const { api, calls } = fakeApi();
    mounted = await mount(<BookshelfHost api={api} />);
    await act(async () => useBookshelfStore.getState().openShelf("op-1"));
    await settle();
    const input = document.querySelector<HTMLInputElement>(".rg-shelf__filter");
    if (!input) throw new Error("no filter");
    await type(input, "n");
    expect(calls.filter((c) => c.startsWith("search:"))).toEqual([]);
    await type(input, "needle");
    expect([...document.querySelectorAll(".rg-shelf__doc")]).toHaveLength(0);
    expect(text(".rg-shelf__list")).toContain("No file name matches.");
    await wait(SHELF_SEARCH_DEBOUNCE_MS + 40);
    expect(calls.filter((c) => c.startsWith("search:"))).toEqual(["search:needle"]);
    const hit = document.querySelector<HTMLButtonElement>(".rg-shelf__hit");
    expect(hit?.textContent).toBe("docs/guide.md:5needle here");
    if (hit) await click(hit);
    await settle();
    expect(text(".rg-doc h1")).toBe("Guide");
  });

  test("a shelf that is not the reader's to open says so and shows nothing", async () => {
    const { api } = fakeApi({ listing: "closed" });
    mounted = await mount(<BookshelfHost api={api} />);
    await act(async () => useBookshelfStore.getState().openShelf("op-1"));
    await settle();
    expect(text('[role="status"]')).toBe("This room's bookshelf is not open to you.");
    expect(document.querySelector(".rg-shelf")).toBeNull();
  });

  test("access taken away while reading empties the reader", async () => {
    const { api, state } = fakeApi();
    mounted = await mount(<BookshelfHost api={api} />);
    await act(async () => useBookshelfStore.getState().openShelf("op-1"));
    await settle();
    expect(text(".rg-doc h1")).toBe("Hello");
    state.fail = { document: "closed" };
    await act(async () => useBookshelfStore.getState().go("docs/guide.md"));
    await settle();
    expect(text('[role="status"]')).toBe("This room's bookshelf is not open to you.");
    expect(document.querySelector(".rg-shelf")).toBeNull();
    expect(document.body.textContent).not.toContain("guide.md");
  });

  test("leaving the room closes the shelf and gives the keyboard back", async () => {
    const { api } = fakeApi();
    mounted = await mount(<BookshelfHost api={api} />);
    await act(async () => useBookshelfStore.getState().openShelf("op-1"));
    await settle();
    await act(async () => useOperationStore.setState({ operationId: "op-2" }));
    expect(useBookshelfStore.getState().operationId).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(useUiStore.getState().overlay).toBeNull();
  });
});

describe("the shelf's E key", () => {
  const pressE = (extra: object) => hotkeys.resolve({ key: "e", ...extra });

  test("is the interact hotkey, which is not sent from a text field, a terminal or the whiteboard", () => {
    expect(pressE({})?.id).toBe("interact");
    // A terminal (xterm types into a textarea) and any text field.
    const textarea = document.createElement("textarea");
    const input = document.createElement("input");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    for (const el of [textarea, input]) {
      expect(isEditableTarget(el)).toBe(true);
      expect(pressE({ editable: isEditableTarget(el) })).toBeNull();
    }
    // The terminal modal, the whiteboard and the reader itself own the keyboard while open.
    for (const overlay of [TERMINAL_OVERLAY_ID, WHITEBOARD_OVERLAY, BOOKSHELF_OVERLAY]) {
      useUiStore.setState({ overlay });
      expect(pressE({ overlayOpen: useUiStore.getState().overlay !== null })).toBeNull();
    }
    for (const modifier of ["ctrlKey", "metaKey", "altKey"])
      expect(pressE({ [modifier]: true })).toBeNull();
  });

  test("reaches only from in front of the shelf the generator placed", () => {
    const layout = generateRoom({
      width: 6,
      depth: 6,
      doorSide: "south",
      deskCount: 1,
      decorStyle: "lab",
    });
    const spot = shelfSpot(layout);
    if (!spot) throw new Error("the room has no docs shelf");
    expect(shelfInReach(spot, spot.stand)).toBe(true);
    expect(shelfInReach(spot, { x: spot.stand.x + 0.9, z: spot.stand.z })).toBe(true);
    expect(shelfInReach(spot, { x: spot.stand.x + 1.1, z: spot.stand.z })).toBe(false);
    expect(shelfInReach(null, spot.stand)).toBe(false);
    expect(shelfSpot({ ...layout, obstacles: [] })).toBeNull();
  });
});

describe("small parts", () => {
  test("heading slugs follow GitHub's, and a fragment finds its heading", () => {
    expect(headingSlug("Hello, World!")).toBe("hello-world");
    expect(headingSlug("  4.3 Monorepo layout ")).toBe("43-monorepo-layout");
    expect(headingSlug("a_b-c  d")).toBe("a_b-c--d");
    const slug = createSlugger();
    expect([slug("Setup"), slug("Setup"), slug("setup")]).toEqual(["setup", "setup-1", "setup-2"]);
    const root = document.createElement("div");
    root.innerHTML = '<h2 data-doc-anchor="setup">x</h2><h2 data-doc-anchor="a&quot;]b">y</h2>';
    expect(findAnchor(root, "Setup")?.textContent).toBe("x");
    expect(findAnchor(root, 'a"]b')?.textContent).toBe("y");
    expect(findAnchor(root, "")).toBeNull();
    expect(findAnchor(root, '"], script, [x="')).toBeNull();
  });

  test("the shelf groups by folder in shelf order and filters by path", () => {
    expect(groupByFolder(LISTING.docs).map((f) => [f.name, f.docs.length])).toEqual([
      ["", 1],
      ["docs", 2],
    ]);
    expect(
      groupByFolder(LISTING.docs, " GUIDE ").flatMap((f) => f.docs.map((d) => d.path)),
    ).toEqual(["docs/guide.md"]);
    expect(groupByFolder(LISTING.docs, "zzz")).toEqual([]);
  });

  test("the page turn is quiet, follows the volume and can be turned off", () => {
    expect(pageTurnGain({ pageTurnSound: true, volume: 1 })).toBeGreaterThan(0);
    expect(pageTurnGain({ pageTurnSound: true, volume: 1 })).toBeLessThanOrEqual(0.05);
    expect(pageTurnGain({ pageTurnSound: true, volume: 0.5 })).toBe(
      pageTurnGain({ pageTurnSound: true, volume: 1 }) / 2,
    );
    expect(pageTurnGain({ pageTurnSound: false, volume: 1 })).toBe(0);
    expect(pageTurnGain({ pageTurnSound: true, volume: 0 })).toBe(0);
  });
});
