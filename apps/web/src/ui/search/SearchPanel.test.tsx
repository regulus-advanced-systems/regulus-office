import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { OperationState, SearchContextResponse, SearchResponse } from "@regulus/protocol";
import { henchmanFixture, operationFixture } from "@regulus/protocol/src/fixtures.ts";
import { act } from "react";
import { roomLayout } from "../../scene/compound/interiors.ts";
import { rowPlacement, testWorld } from "../../scene/compound/testing.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { useOperationStore } from "../../state/operation.ts";
import { usePlayerStore } from "../../state/player.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import type { SearchApi } from "./api.ts";
import { SEARCH_DEBOUNCE_MS, SearchPanel } from "./SearchPanel.tsx";
import { SearchReveal } from "./SearchReveal.tsx";
import { highlightTerms } from "./Snippet.tsx";
import { SEARCH_OVERLAY_ID, useSearchStore } from "./searchStore.ts";
import { type JumpDeps, tickJump } from "./useSearchJump.ts";

useDom();

const RESULT: SearchResponse = {
  terms: ["needle"],
  truncated: false,
  groups: [
    {
      key: "henchman:a1",
      kind: "scrollback",
      operationId: "f1",
      operationName: "Apollo",
      agentId: "a1",
      seatId: "seat-1",
      henchmanName: "Fix login",
      ownerName: "Rob",
      hits: [
        {
          docId: 11,
          kind: "scrollback",
          ts: 1_700_000_000_000,
          snippet: [
            { text: "found the ", hit: false },
            { text: "needle", hit: true },
            { text: " <b>here</b>", hit: false },
          ],
        },
      ],
    },
    {
      key: "chat:lobby",
      kind: "chat",
      operationId: "lobby",
      operationName: "Lobby",
      hits: [
        {
          docId: 12,
          kind: "chat",
          ts: 1_700_000_000_000,
          author: "Ada",
          snippet: [{ text: "needle", hit: true }],
        },
      ],
    },
  ],
};

const CONTEXT: SearchContextResponse = {
  docId: 11,
  agentId: "a1",
  operationId: "f1",
  lines: ["$ make", "compiling", "found the needle here", "done"],
  matchLine: 2,
};

function fakeApi() {
  const calls: string[] = [];
  const api: SearchApi = {
    search: async (q) => {
      calls.push(`search:${q}`);
      return { ok: true, data: RESULT };
    },
    context: async (docId, q) => {
      calls.push(`context:${docId}:${q}`);
      return { ok: true, data: CONTEXT };
    },
  };
  return { api, calls };
}

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

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
  useSearchStore.setState({ query: "", status: "idle", result: null, jump: null, reveal: null });
  useUiStore.setState({ overlay: SEARCH_OVERLAY_ID });
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe("SearchPanel", () => {
  test("debounced search, grouped results, highlighted snippets as text", async () => {
    const { api, calls } = fakeApi();
    mounted = await mount(<SearchPanel api={api} now={() => 5} />);
    const input = document.querySelector<HTMLInputElement>('[data-testid="search-input"]');
    if (!input) throw new Error("no input");
    expect(document.activeElement).toBe(input);
    await type(input, "nee");
    await type(input, "needle");
    await wait(SEARCH_DEBOUNCE_MS + 30);
    expect(calls).toEqual(["search:needle"]);

    const groups = Array.from(document.querySelectorAll("[data-group]"));
    expect(groups.map((g) => g.getAttribute("data-group"))).toEqual(["henchman:a1", "chat:lobby"]);
    expect(groups[0]?.textContent).toContain("Fix login (Rob) · Apollo");
    expect(groups[1]?.textContent).toContain("Chat · Lobby");
    const marks = Array.from(document.querySelectorAll(".rg-search__hit mark"));
    expect(marks.map((m) => m.textContent)).toEqual(["needle", "needle"]);
    // Server text is never parsed as HTML.
    expect(document.querySelector(".rg-search__hit b")).toBeNull();
    expect(groups[0]?.textContent).toContain("<b>here</b>");
  });

  test("a terminal hit closes the dialog and starts a jump to the henchman's desk", async () => {
    const { api } = fakeApi();
    mounted = await mount(<SearchPanel api={api} now={() => 5} />);
    useSearchStore.getState().setQuery("needle");
    await wait(SEARCH_DEBOUNCE_MS + 30);
    const hit = document.querySelector<HTMLButtonElement>('[data-testid="search-hit"]');
    if (!hit) throw new Error("no hit");
    await click(hit);
    expect(useUiStore.getState().overlay).toBeNull();
    expect(useSearchStore.getState().jump).toEqual({
      agentId: "a1",
      operationId: "f1",
      seatId: "seat-1",
      docId: 11,
      query: "needle",
      startedAt: 5,
    });
  });
});

describe("SearchReveal", () => {
  test("shows the history around the match, scrolled and highlighted; Back to live", async () => {
    const { api, calls } = fakeApi();
    useSearchStore.getState().setReveal({ agentId: "a1", docId: 11, query: "needle" });
    mounted = await mount(<SearchReveal agentId="a1" api={api} />);
    await wait(10);
    expect(calls).toEqual(["context:11:needle"]);
    const match = document.querySelector("[data-match]");
    expect(match?.textContent).toBe("found the needle here");
    expect(match?.querySelector("mark")?.textContent).toBe("needle");
    const back = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Back to live",
    );
    if (!back) throw new Error("no back button");
    await click(back);
    expect(useSearchStore.getState().reveal).toBeNull();
    expect(document.querySelector('[data-testid="search-reveal"]')).toBeNull();
  });

  test("nothing for another henchman's terminal", async () => {
    useSearchStore.getState().setReveal({ agentId: "a2", docId: 11, query: "needle" });
    mounted = await mount(<SearchReveal agentId="a1" api={fakeApi().api} />);
    expect(document.querySelector('[data-testid="search-reveal"]')).toBeNull();
  });
});

describe("tickJump", () => {
  // The henchman's room in a small compound (#186): seats are in compound metres.
  const world = testWorld([{ id: "f1", placement: rowPlacement(4), deskCount: 2 }]);
  const room = world.rooms.find((r) => r.id === "f1");
  const layout = room ? roomLayout(room) : null;
  const seat = layout?.seats.find((s) => s.kind === "desk");
  if (!room || !seat) throw new Error("room has no desk");
  const desk = {
    id: seat.id,
    pose: { x: room.origin.x + seat.pose.x, z: room.origin.z + seat.pose.z },
  };
  const target = { agentId: "a1", operationId: "f1", docId: 11, query: "needle", startedAt: 0 };
  const recorder = () => {
    const log: string[] = [];
    const deps: JumpDeps = {
      rideTo: (f) => log.push(`ride:${f}`),
      openTerminal: (a) => log.push(`open:${a}`),
      now: () => 100,
    };
    return { log, deps };
  };

  test("rides to the henchman's operation first", () => {
    useOperationStore.setState({ operationId: "lobby", state: null });
    const { log, deps } = recorder();
    const progress = { rode: false, walkingSince: null };
    expect(tickJump(target, progress, deps)).toBe(true);
    expect(tickJump(target, progress, deps)).toBe(true);
    expect(log).toEqual(["ride:f1"]);
  });

  test("walks to the desk, opens the terminal there with the match to reveal", () => {
    const state = {
      ...operationFixture,
      operationId: "f1",
      layoutTemplateId: "room",
      henchmen: { a1: { ...henchmanFixture, seatId: desk.id } },
    } as OperationState;
    useCompoundStore.setState({ world });
    useOperationStore.getState().apply(state);
    usePlayerStore.setState({
      spawned: true,
      spawnKey: "operation:f1",
      x: desk.pose.x + 8,
      z: desk.pose.z,
      target: null,
      navigation: { walkable: () => true, plan: (_from, to) => [to] },
    });
    const { log, deps } = recorder();
    const progress = { rode: false, walkingSince: null };
    expect(tickJump(target, progress, deps)).toBe(true);
    expect(usePlayerStore.getState().target).toEqual({ x: desk.pose.x, z: desk.pose.z });
    usePlayerStore.setState({ x: desk.pose.x + 0.5 });
    expect(tickJump(target, progress, deps)).toBe(false);
    expect(log).toEqual(["open:a1"]);
    expect(useSearchStore.getState().reveal).toEqual({ agentId: "a1", docId: 11, query: "needle" });
  });
});

test("highlightTerms marks every occurrence, case-insensitively", () => {
  expect(highlightTerms("Needle and needles", ["needle"])).toEqual([
    { text: "Needle", hit: true },
    { text: " and ", hit: false },
    { text: "needle", hit: true },
    { text: "s", hit: false },
  ]);
  expect(highlightTerms("plain", [])).toEqual([{ text: "plain", hit: false }]);
});
