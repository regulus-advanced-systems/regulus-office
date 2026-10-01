/** Settings → Henchman skins (#184): owners and admins list, add, change and delete skin rules, with a preview. */
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

const RULE: SkinRule = {
  id: "r1",
  match: "provider:codex",
  skinId: "lab_coat",
  priority: 0,
  createdAt: 1,
};

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
  const f = fakeFetch({
    "GET /api/skin-rules": () => ({ body: { rules: list } }),
    "POST /api/skin-rules": (call) => {
      const rule = {
        id: `r${list.length + 2}`,
        createdAt: 2,
        ...(call.body as object),
      } as SkinRule;
      list = [...list, rule];
      return { status: 201, body: rule };
    },
    "PATCH /api/skin-rules/r1": (call) => {
      list = list.map((r) => (r.id === "r1" ? { ...r, ...(call.body as object) } : r));
      return { body: list.find((r) => r.id === "r1") };
    },
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

async function choose(label: string, value: string) {
  const select = labelled<HTMLSelectElement>(label);
  if (!select) throw new Error(`no select ${label}`);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

const preview = () => document.querySelector('[data-testid="preview-props"]')?.textContent;

describe("henchman skin settings", () => {
  test("members do not see the section", async () => {
    const f = await show("member", [RULE]);
    expect(text()).not.toContain("Henchman skins");
    expect(f.calls).toHaveLength(0);
  });

  test("an admin sees the rules and previews the skin being chosen with the provider's trim", async () => {
    await show("admin", [RULE]);
    expect(text()).toContain("Henchman skins");
    expect(text()).toContain("Every Codex robot");
    expect(labelled<HTMLSelectElement>("Skin for Every Codex robot")?.value).toBe("lab_coat");
    // The add form starts on Codex + lab coat: the preview shows that, in Codex teal.
    expect(preview()).toBe("lab_coat #10A37F");
    await choose("Skin", "chef");
    expect(preview()).toBe("chef #10A37F");
    await choose("Provider", "claude-code");
    expect(preview()).toBe("chef #D97757");
    await choose("Who the rule matches", "role");
    expect(text()).toContain("The project manager (PM)");
    expect(preview()).toBe("chef #D97757");
  });

  test("add, change and delete rules", async () => {
    const f = await show("owner", [RULE]);
    await choose("Who the rule matches", "role");
    await choose("Skin", "number_two");
    await click(button("Add rule") as HTMLButtonElement);
    await settle();
    expect(f.calls.find((c) => c.method === "POST")?.body).toEqual({
      match: "role:pm",
      skinId: "number_two",
      priority: 0,
    });
    expect(text()).toContain("The PM");

    await choose("Skin for Every Codex robot", "black_ops");
    expect(f.calls.find((c) => c.method === "PATCH")?.body).toEqual({ skinId: "black_ops" });
    expect(labelled<HTMLSelectElement>("Skin for Every Codex robot")?.value).toBe("black_ops");

    await click(labelled<HTMLButtonElement>("Delete rule for Every Codex robot") as Element);
    await settle();
    expect(f.calls.some((c) => c.method === "DELETE")).toBe(true);
    expect(text()).not.toContain("Every Codex robot");
  });

  test("an office agent rule needs an id", async () => {
    await show("owner", []);
    expect(text()).toContain("No rules yet");
    await choose("Who the rule matches", "office_agent");
    expect(button("Add rule")?.disabled).toBe(true);
  });
});
