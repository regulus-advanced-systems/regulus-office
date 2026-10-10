/**
 * An agent's card in Settings → Agents (#136): "Who it is and how it works"
 * with preview and history, "What it remembers" and "Notes" with search and
 * delete, for those who may read them; nothing of it for anyone else.
 */
import { afterEach, describe, expect, test } from "bun:test";
import type { MindEntry, SoulVersionSummary } from "@regulus/protocol";
import { act } from "react";
import { click, useDom } from "../a11y/dom.ts";
import { button, settle, submit, text } from "../auth/testDom.tsx";
import { agent, card, cleanup, NOW, response, SOMEONES, show, within } from "./testKit.tsx";

useDom();
afterEach(cleanup);

const SOUL = {
  agentId: "a1",
  version: 2,
  content: "You are **Hermes**.\nBe brief.",
  updatedAt: NOW,
};
const VERSIONS: SoulVersionSummary[] = [
  { version: 2, kind: "edit", by: "Ante", ts: NOW - 60_000, chars: 28, added: 1, removed: 0 },
  { version: 1, kind: "created", by: "Ante", ts: NOW - 3_600_000, chars: 18, added: 1, removed: 0 },
];
const MEMORY: MindEntry = {
  id: "m1",
  kind: "memory",
  text: "Ante's standup is at 9:30",
  source: "Ante, in chat",
  by: "agent",
  createdAt: NOW - 120_000,
  updatedAt: NOW - 120_000,
};
const NOTE: MindEntry = {
  id: "n1",
  kind: "note",
  title: "Journal",
  text: "Planned the week.",
  by: "agent",
  createdAt: NOW,
  updatedAt: NOW,
};
const BASE = "/api/office-agents/a1";

/** Open one of the card's parts, as a click on its heading does. */
async function open(root: HTMLElement, label: string) {
  const details = Array.from(root.querySelectorAll("details")).find(
    (d) => d.querySelector("summary")?.textContent === label,
  );
  if (!details) throw new Error(`no part "${label}"`);
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  await settle();
  return details;
}
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
    // react-dom loaded before happy-dom registered: its keyup fallback reports the change.
    el.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true }));
  });
  await settle();
}

describe("who it is, what it remembers, notes", () => {
  test("the owner writes, previews and saves who the agent is; nothing loads before it is opened", async () => {
    const f = await show("member", {
      "GET /api/office-agents": { body: response([agent({})]) },
      [`GET ${BASE}/soul`]: { body: SOUL },
      [`PUT ${BASE}/soul`]: (call) => ({
        body: { ...SOUL, version: 3, content: (call.body as { content: string }).content },
      }),
    });
    const mine = card("Hermes");
    expect(mine.querySelector('[data-testid="agent-mind-privacy"]')?.textContent).toBe(
      "Private: only you can read and change this. Office owners and admins cannot.",
    );
    for (const word of ["soul", "Soul", "Instructions"])
      expect(mine.textContent).not.toContain(word);
    expect(f.calls.some((c) => c.path.includes("/soul") || c.path.includes("/memories"))).toBe(
      false,
    );

    const part = await open(mine, "Who it is and how it works");
    const area = part.querySelector("textarea") as HTMLTextAreaElement;
    expect(area.value).toBe(SOUL.content);
    expect(part.textContent).toContain("version 2");
    expect((within(part, "Save") as HTMLButtonElement).disabled).toBe(true);

    await type(area, `${SOUL.content}\nSign off with H.`);
    // It runs: saving will stop it, and the card says so before the save.
    expect(part.textContent).toContain("Hermes is running. Saving stops it");
    await click(within(part, "Preview") as HTMLButtonElement);
    expect(part.querySelector(".rg-md strong")?.textContent).toBe("Hermes");
    await click(within(part, "Save") as HTMLButtonElement);
    await settle();
    expect(f.calls.find((c) => c.method === "PUT")?.body).toEqual({
      content: `${SOUL.content}\nSign off with H.`,
      baseVersion: 2,
    });
    expect(part.textContent).toContain("version 3");
  });

  test("history shows what changed in a version and brings an old one back", async () => {
    const f = await show("member", {
      "GET /api/office-agents": { body: response([agent({ status: "stopped" })]) },
      [`GET ${BASE}/soul`]: { body: SOUL },
      [`GET ${BASE}/soul/versions`]: { body: { versions: VERSIONS } },
      [`GET ${BASE}/soul/versions/2`]: { body: { ...VERSIONS[0], content: SOUL.content } },
      [`GET ${BASE}/soul/versions/1`]: { body: { ...VERSIONS[1], content: "You are Hermes." } },
      [`POST ${BASE}/soul/revert`]: { body: { ...SOUL, version: 3, content: "You are Hermes." } },
    });
    const part = await open(card("Hermes"), "Who it is and how it works");
    await click(within(part, "History") as HTMLButtonElement);
    await settle();
    const rows = Array.from(part.querySelectorAll(".rg-agent-mind__row")).map((r) => r.textContent);
    expect(rows[0]).toContain("Version 2 (now) · Changed by Ante · 1 min ago");
    expect(rows[1]).toContain("Version 1 · First version by Ante · 1 h ago");
    // The newest against the one before it.
    await click(part.querySelectorAll(".rg-agent-mind__row button")[0] as HTMLButtonElement);
    await settle();
    const lines = Array.from(part.querySelectorAll(".rg-agent-soul__line")).map((l) => [
      l.className.split("is-")[1],
      l.textContent?.trim(),
    ]);
    expect(lines).toEqual([
      ["del", "− You are Hermes."],
      ["add", "+ You are **Hermes**."],
      ["add", "+ Be brief."],
    ]);
    expect(within(part, "Bring version 2 back")).toBeUndefined();
    await click(part.querySelectorAll(".rg-agent-mind__row button")[1] as HTMLButtonElement);
    await settle();
    await click(within(part, "Bring version 1 back") as HTMLButtonElement);
    await settle();
    expect(f.calls.find((c) => c.path.endsWith("/soul/revert"))?.body).toEqual({ version: 1 });
    expect((part.querySelector("textarea") as HTMLTextAreaElement).value).toBe("You are Hermes.");
  });

  test("memories and notes are listed, searched, added and deleted", async () => {
    let memories = [MEMORY];
    const f = await show("member", {
      "GET /api/office-agents": { body: response([agent({})]) },
      [`GET ${BASE}/memories`]: (call) =>
        call.search.includes("kind=note")
          ? { body: { entries: [NOTE], total: 1, max: 200 } }
          : { body: { entries: memories, total: memories.length, max: 500 } },
      [`POST ${BASE}/memories`]: { status: 201, body: { ...MEMORY, id: "m2", by: "person" } },
      [`DELETE ${BASE}/memories/m1`]: () => {
        memories = [];
        return { status: 204 };
      },
    });
    const part = await open(card("Hermes"), "What it remembers");
    expect(part.textContent).toContain("Ante's standup is at 9:30");
    expect(part.textContent).toContain("Saved by the agent · from: Ante, in chat · 2 min ago");
    expect(part.textContent).toContain("1 of 500");
    await type(part.querySelector('input[type="search"]') as HTMLInputElement, "stand up");
    expect(f.calls.at(-1)?.search).toBe("?kind=memory&q=stand%20up");

    await click(within(part, "Add a memory") as HTMLButtonElement);
    const box = part.querySelector(
      'textarea[aria-label="What to remember"]',
    ) as HTMLTextAreaElement;
    await act(async () => {
      box.value = "Prefers tea";
    });
    await submit("Add a memory");
    expect(f.calls.find((c) => c.method === "POST")?.body).toEqual({
      kind: "memory",
      text: "Prefers tea",
    });

    await click(within(part, "Delete…") as HTMLButtonElement);
    await click(within(part, "Delete this memory for good") as HTMLButtonElement);
    await settle();
    expect(f.calls.some((c) => c.method === "DELETE" && c.path === `${BASE}/memories/m1`)).toBe(
      true,
    );
    expect(part.textContent).toContain("Nothing found.");

    const notes = await open(card("Hermes"), "Notes");
    expect(notes.textContent).toContain("Journal");
    expect(notes.textContent).toContain("Planned the week.");
  });

  test("a refused secret is said in the office's own words", async () => {
    const message =
      "That memory was not saved: line 1 looks like a provider key or GitHub token. Secrets are never stored here; take it out and save again.";
    await show("member", {
      "GET /api/office-agents": { body: response([agent({})]) },
      [`GET ${BASE}/memories`]: { body: { entries: [], total: 0, max: 500 } },
      [`POST ${BASE}/memories`]: { status: 422, body: { error: "secret_rejected", message } },
    });
    const part = await open(card("Hermes"), "What it remembers");
    await click(within(part, "Add a memory") as HTMLButtonElement);
    await submit("Add a memory");
    expect(part.querySelector('[role="alert"]')?.textContent).toBe(message);
  });

  test("an admin looking at someone's personal agent gets none of it, and can remove it", async () => {
    const f = await show("admin", {
      "GET /api/office-agents": {
        body: response([
          { ...SOMEONES, canRemove: true, cost: { totalUsd: 3.5, last30DaysUsd: 1.239 } },
        ]),
      },
      "DELETE /api/office-agents/a3": { status: 204 },
    });
    const theirs = card("Mias helper");
    expect(theirs.querySelector(".rg-agent-mind")).toBeNull();
    // What an admin does see: that it exists, how it is doing and what it costs.
    expect(theirs.textContent).toContain("Cost, last 30 days: $1.24");
    expect(theirs.querySelectorAll("details")).toHaveLength(0);
    expect(theirs.textContent).toContain(
      "only the person it belongs to can talk to it or read who it is, what it remembers and its notes",
    );
    expect(f.calls.some((c) => /soul|memories/.test(c.path))).toBe(false);
    await click(within(theirs, "Remove…") as HTMLButtonElement);
    await click(
      button("Remove Mias helper and everything it holds, for good") as HTMLButtonElement,
    );
    await settle();
    expect(f.calls.some((c) => c.method === "DELETE" && c.path === "/api/office-agents/a3")).toBe(
      true,
    );
  });

  test("a shared agent's card says who can read it; the new-agent form asks in plain words", async () => {
    await show("admin", {
      "GET /api/office-agents": {
        body: response([agent({ id: "a2", name: "Number Two", owner: { kind: "office" } })]),
      },
    });
    expect(
      card("Number Two").querySelector('[data-testid="agent-mind-privacy"]')?.textContent,
    ).toBe(
      "Office owners and admins can read and change this; of what it remembers and its notes, only what is about rooms they can see themselves. The agent tells a person only what is about rooms that person can see.",
    );
    await click(button("New agent") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("Who it is and how it works");
    expect(text()).toContain("The agent reads this every time it starts.");
  });
});
