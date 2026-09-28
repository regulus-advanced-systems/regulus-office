import { describe, expect, test } from "bun:test";
import { createPanelBudget, grantPanels, MAX_LIVE_PANELS, PANEL_PRIORITY } from "./panelBudget.ts";

describe("live DOM panel budget (SPEC §11: ≤ 2)", () => {
  test("never grants more than the maximum; priority then request order", () => {
    const granted = grantPanels([
      { id: "laptop-a", priority: 1, seq: 1 },
      { id: "laptop-b", priority: 1, seq: 2 },
      { id: "modal", priority: 10, seq: 3 },
    ]);
    expect(MAX_LIVE_PANELS).toBe(2);
    expect([...granted].sort()).toEqual(["laptop-a", "modal"]);
    expect(grantPanels([], 2).size).toBe(0);
  });

  test("the store re-grants on release and keeps a panel's place on re-request", () => {
    const store = createPanelBudget();
    const { request, release } = store.getState();
    request("laptop", PANEL_PRIORITY.laptop);
    request("other", PANEL_PRIORITY.laptop);
    request("modal", PANEL_PRIORITY.modal);
    expect(store.getState().granted.size).toBe(2);
    expect(store.getState().granted.has("modal")).toBe(true);
    expect(store.getState().granted.has("laptop")).toBe(true);
    request("laptop", PANEL_PRIORITY.laptop);
    expect(store.getState().granted.has("laptop")).toBe(true);
    release("modal");
    expect([...store.getState().granted].sort()).toEqual(["laptop", "other"]);
  });
});
