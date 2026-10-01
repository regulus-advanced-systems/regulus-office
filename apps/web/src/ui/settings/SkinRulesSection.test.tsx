/**
 * Settings → Henchmen (#184, #225): owners and admins see the skin rules as
 * ordered cards (top wins), add and edit them with plain-language "who"
 * choices and a skin gallery next to the turntable, reorder them (which
 * rewrites priorities) and delete them.
 */
import { afterEach, describe, expect, test } from "bun:test";
import type { SkinRule, UserRole } from "@regulus/protocol";
import { act } from "react";
import { useSessionStore } from "../../state/session.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import type { SkinPreviewProps } from "./SkinPreview.tsx";
import { SkinRulesSection } from "./SkinRulesSection.tsx";
import { createSkinRulesApi } from "./skinRulesApi.ts";

useDom();

const rule = (id: string, match: string, skinId: SkinRule["skinId"], priority: number) =>
  ({ id, match, skinId, priority, createdAt: 1 }) as SkinRule;

const CODEX = rule("r1", "provider:codex", "lab_coat", 0);

const mounted: Mounted[] = [];
afterEach(async () => {
  for (const m of mounted.splice(0)) await m.unmount();
  await settle();
  useSessionStore.setState({ status: "unknown", user: null, error: null });
});

/** Stands in for the WebGL turntable: shows what it would draw. */
function FakePreview({ skin, trim }: SkinPreviewProps) {
  return <div data-testid="preview-props">{`${skin} ${trim ?? "none"}`}</div>;
}

async function show(role: UserRole, rules: SkinRule[]) {
  useSessionStore.setState({
    status: "authenticated",
    user: { id: "u1", displayName: "Ante", role },
    error: null,
  });
  let list = [...rules];
  let next = 10;
  const patch = (id: string, body: object) => {
    list = list.map((r) => (r.id === id ? { ...r, ...body } : r));
    return { body: list.find((r) => r.id === id) };
  };
  const f = fakeFetch({
    "GET /api/skin-rules": () => ({ body: { rules: list } }),
    "POST /api/skin-rules": (call) => {
      const created = { id: `r${next++}`, createdAt: 2, ...(call.body as object) } as SkinRule;
      list = [...list, created];
      return { status: 201, body: created };
    },
    "PATCH /api/skin-rules/r1": (call) => patch("r1", call.body as object),
    "PATCH /api/skin-rules/r2": (call) => patch("r2", call.body as object),
    "PATCH /api/skin-rules/r3": (call) => patch("r3", call.body as object),
    "PATCH /api/skin-rules/r10": (call) => patch("r10", call.body as object),
    "DELETE /api/skin-rules/r1": () => {
      list = list.filter((r) => r.id !== "r1");
      return { status: 204 };
    },
  });
  mounted.push(
    await mount(
      <SkinRulesSection api={createSkinRulesApi({ fetch: f.fetch })} Preview={FakePreview} />,
    ),
  );
  await settle();
  return f;
}

const labelled = <T extends Element>(label: string) =>
  document.querySelector<T & HTMLElement>(`[aria-label="${label}"]`);

/** The radio whose card or chip reads `label`, inside the group named `group`. */
function radio(group: string, label: string): HTMLInputElement {
  const fieldsets = Array.from(document.querySelectorAll("fieldset, [role='radiogroup']"));
  for (const set of fieldsets) {
    const name = set.querySelector("legend")?.textContent ?? set.getAttribute("aria-label");
    if (name !== group) continue;
    const match = Array.from(set.querySelectorAll("label")).find((l) =>
      l.textContent?.includes(label),
    );
    const input = match?.querySelector("input");
    if (input) return input;
  }
  throw new Error(`no radio "${label}" in ${group}`);
}

async function choose(group: string, label: string) {
  await click(radio(group, label));
  await settle(1);
}

const preview = () => document.querySelector('[data-testid="preview-props"]')?.textContent;
const cards = () =>
  Array.from(document.querySelectorAll('[aria-label="Skin rules"] > li strong')).map(
    (s) => s.textContent,
  );
const patches = (f: Awaited<ReturnType<typeof show>>) =>
  f.calls.filter((c) => c.method === "PATCH").map((c) => [c.path.split("/").pop(), c.body]);

describe("henchman skin settings", () => {
  test("members do not see the section", async () => {
    const f = await show("member", [CODEX]);
    expect(text()).not.toContain("Henchman skins");
    expect(f.calls).toHaveLength(0);
  });

  test("rules are cards in words, top wins, with the skin in each", async () => {
    await show("admin", [
      rule("r1", "provider:codex", "lab_coat", 0),
      rule("r2", "role:pm", "number_two", 5),
      rule("r3", "office_agent:hermes", "chef", 0),
    ]);
    // The server's ranking: priority, then the more specific match.
    expect(cards()).toEqual(["The PM", "Office agent hermes", "Every Codex henchman"]);
    expect(text()).toContain("wears the Number two (PM suit)");
    expect(labelled("Move The PM up")).toHaveProperty("disabled", true);
    expect(labelled("Move Every Codex henchman down")).toHaveProperty("disabled", true);
    expect(document.querySelector('[data-testid="preview-props"]')).toBeNull();
  });

  test("the editor picks who in words and the skin from a gallery, previewed in the trim", async () => {
    await show("owner", [CODEX]);
    await click(button("Add a rule") as HTMLButtonElement);
    // Starts on every Codex henchman in the lab coat, previewed in Codex teal.
    expect(radio("Who wears it", "Every henchman of a provider").checked).toBe(true);
    expect(document.activeElement).toBe(radio("Who wears it", "Every henchman of a provider"));
    expect(radio("Skin", "Lab coat").checked).toBe(true);
    expect(preview()).toBe("lab_coat #10A37F");
    // Every skin is in the gallery.
    for (const label of ["Standard jumpsuit", "Lab coat", "Black ops", "Chef", "Number two"])
      expect(radio("Skin", label)).toBeDefined();
    await choose("Skin", "Chef");
    expect(preview()).toBe("chef #10A37F");
    await choose("Provider", "Claude Code");
    expect(preview()).toBe("chef #D97757");
    expect(text()).toContain("Every Claude Code henchman wears the Chef.");
    await choose("Who wears it", "The PM");
    expect(text()).toContain("The PM wears the Chef.");
    await choose("Who wears it", "One office agent");
    expect(button("Add rule")?.disabled).toBe(true);
  });

  test("a new rule goes to the top: created above the others, priorities from the order", async () => {
    const f = await show("owner", [
      rule("r1", "provider:codex", "lab_coat", 3),
      rule("r2", "provider:gemini-cli", "chef", 3),
    ]);
    await click(button("Add a rule") as HTMLButtonElement);
    await choose("Who wears it", "The PM");
    await choose("Skin", "Number two");
    await click(button("Add rule") as HTMLButtonElement);
    await settle();
    expect(f.calls.find((c) => c.method === "POST")?.body).toEqual({
      match: "role:pm",
      skinId: "number_two",
      priority: 2,
    });
    // Old priorities 3 and 3 become 1 and 0 under the new rule's 2.
    expect(patches(f)).toEqual([
      ["r1", { priority: 1 }],
      ["r2", { priority: 0 }],
    ]);
    expect(cards()).toEqual(["The PM", "Every Codex henchman", "Every Gemini CLI henchman"]);
    expect(document.activeElement?.textContent).toContain("Add a rule");
  });

  test("move up and down send the priorities of the new order and keep focus", async () => {
    const f = await show("owner", [
      rule("r1", "provider:codex", "lab_coat", 2),
      rule("r2", "role:pm", "number_two", 1),
      rule("r3", "office_agent:hermes", "chef", 0),
    ]);
    expect(cards()).toEqual(["Every Codex henchman", "The PM", "Office agent hermes"]);
    await click(labelled("Move Office agent hermes up") as Element);
    await settle();
    expect(patches(f)).toEqual([
      ["r3", { priority: 1 }],
      ["r2", { priority: 0 }],
    ]);
    expect(cards()).toEqual(["Every Codex henchman", "Office agent hermes", "The PM"]);
    expect(document.activeElement).toBe(labelled("Move Office agent hermes up"));

    // To the top: Move up is disabled there, so focus goes to Move down.
    await click(labelled("Move Office agent hermes up") as Element);
    await settle();
    expect(cards()).toEqual(["Office agent hermes", "Every Codex henchman", "The PM"]);
    expect(patches(f).slice(2)).toEqual([
      ["r3", { priority: 2 }],
      ["r1", { priority: 1 }],
    ]);
    expect(document.activeElement).toBe(labelled("Move Office agent hermes down"));
  });

  test("edit changes who and the skin; delete removes the card", async () => {
    const f = await show("owner", [CODEX]);
    await click(labelled("Edit rule for Every Codex henchman") as Element);
    expect(radio("Skin", "Lab coat").checked).toBe(true);
    await choose("Skin", "Black ops");
    await choose("Provider", "OpenCode");
    await click(button("Save rule") as HTMLButtonElement);
    await settle();
    expect(patches(f)).toEqual([["r1", { match: "provider:opencode", skinId: "black_ops" }]]);
    expect(cards()).toEqual(["Every OpenCode henchman"]);
    expect(text()).toContain("wears the Black ops");

    await click(labelled("Delete rule for Every OpenCode henchman") as Element);
    await settle();
    expect(f.calls.some((c) => c.method === "DELETE")).toBe(true);
    expect(text()).toContain("No rules yet");
  });

  test("cancel closes the editor without a request", async () => {
    const f = await show("owner", []);
    await click(button("Add a rule") as HTMLButtonElement);
    await act(async () => {
      (button("Cancel") as HTMLButtonElement).click();
    });
    expect(button("Add rule")).toBeUndefined();
    expect(f.calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });
});
