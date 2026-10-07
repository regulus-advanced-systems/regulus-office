/** Settings → Agents (#280): the form in plain words: runs as, runs on (DeepSeek included), known models, appearance; and changing an agent. */
import { afterEach, describe, expect, test } from "bun:test";
import { OFFICE_AGENT_APPEARANCES, officeAgentAppearanceLabel } from "@regulus/protocol";
import { useUiStore } from "../../state/ui.ts";
import { click, useDom } from "../a11y/dom.ts";
import { button, inputByLabel, settle, submit, text, typeInto } from "../auth/testDom.tsx";
import { PROVIDERS_OVERLAY } from "../providers/providersStore.ts";
import {
  agent,
  card,
  choose,
  cleanup,
  LOGIN,
  mounted,
  RUNS_ON,
  radio,
  radioLabels,
  response,
  select,
  show,
  within,
} from "./testKit.tsx";

useDom();
afterEach(cleanup);

describe("office agent form", () => {
  test("a member creates a personal agent on DeepSeek with a listed model and an appearance", async () => {
    const f = await show("member", {
      "GET /api/office-agents": { body: response([]) },
      "POST /api/office-agents": { status: 201, body: agent({ name: "Notes" }) },
    });
    expect(text()).toContain("No agents yet.");
    await click(button("New agent…") as HTMLButtonElement);
    await settle();
    expect(document.querySelector("label[for]")?.textContent).toBe("Name");
    expect(text()).not.toContain("Belongs to");
    // "Runs as" stays in view with its one option, and says what it is.
    const runsAs = select("Runs as");
    expect(Array.from(runsAs.options).map((o) => o.textContent)).toEqual([
      "Claude Code session (runs here in the office)",
    ]);
    expect(text()).toContain("The program that runs this agent. It decides which providers");
    // "Runs on" lists what is connected; the login is preselected, with Claude's models.
    const runsOn = select("Runs on");
    expect(Array.from(runsOn.options).map((o) => o.textContent)).toEqual([
      "Claude, on my subscription login",
      'DeepSeek, my key "My DeepSeek"',
    ]);
    expect(radio("Sonnet").checked).toBe(true);
    expect(radioLabels("Model")).toEqual(["OpusStrong", "Sonnet", "HaikuCheap", "Fable", "Other…"]);
    // An empty name sends nothing.
    await submit("New agent");
    expect(f.calls.some((c) => c.method === "POST")).toBe(false);

    await choose(runsOn, "p-ds");
    expect(radioLabels("Model")).toEqual([
      "DeepSeek V4 ProStrong",
      "DeepSeek FlashCheap",
      "Other…",
    ]);
    expect(radio("DeepSeek Flash").checked).toBe(true);
    await click(radio("DeepSeek V4 Pro"));
    await click(radio("Lab coat"));
    await typeInto("Name", "Notes");
    await submit("New agent");
    expect(f.calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "Notes",
      owner: "me",
      engine: "cli-session",
      role: "assistant",
      preset: "coordinator",
      provider: "claude-code",
      model: "deepseek-v4-pro",
      appearance: "lab_coat",
      instructions: "",
      profileId: "p-ds",
    });
  });

  test("any other model can be typed behind Other…; the gallery has every form, the secretary with a thumbnail of her own", async () => {
    const f = await show("member", {
      "GET /api/office-agents": { body: response([]) },
      "POST /api/office-agents": { status: 201, body: agent({ name: "Notes" }) },
    });
    await click(button("New agent…") as HTMLButtonElement);
    await settle();
    expect(radioLabels("Appearance")).toEqual(
      OFFICE_AGENT_APPEARANCES.map((id) => officeAgentAppearanceLabel(id)),
    );
    expect(radioLabels("Appearance")).toContain("Secretary");
    // The secretary is a built form (#281): a real thumbnail, not the plain plate of an unknown one.
    const secretary = radio("Secretary").closest("label");
    expect(secretary?.querySelector(".rg-skin-thumb")).not.toBeNull();
    expect(secretary?.querySelector('[data-placeholder="true"]')).toBeNull();
    await click(radio("Other…"));
    await typeInto("Name", "Notes");
    // Nothing typed yet: nothing is sent.
    await submit("New agent");
    expect(f.calls.some((c) => c.method === "POST")).toBe(false);
    await typeInto("Model name", "claude-opus-5-5");
    await submit("New agent");
    expect(f.calls.find((c) => c.method === "POST")?.body).toMatchObject({
      model: "claude-opus-5-5",
      appearance: "standard",
    });
    expect(f.calls.find((c) => c.method === "POST")?.body).not.toHaveProperty("profileId");
  });

  test("with nothing connected the form says so and links to Connect providers instead of failing later", async () => {
    await show("member", {
      "GET /api/office-agents": { body: response([]) },
      "GET /api/office-agents/runs-on": {
        body: { personal: [RUNS_ON.personal[0]], shared: [] },
      },
      "GET /api/provider-logins": { body: { providers: [LOGIN(false)] } },
    });
    await click(button("New agent…") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("You have not connected anything this agent can run on.");
    expect((button("Create agent") as HTMLButtonElement).disabled).toBe(true);
    await click(button("Open Connect providers") as HTMLButtonElement);
    expect(useUiStore.getState().overlay).toBe(PROVIDERS_OVERLAY);
    useUiStore.getState().closeOverlay();
  });

  test("a shared agent runs on an office key picked by name, never a login; without one the form says why", async () => {
    const f = await show("owner", {
      "GET /api/office-agents": { body: response([]) },
      "POST /api/office-agents": { status: 201, body: agent({ name: "Watchdog" }) },
    });
    await click(button("New agent…") as HTMLButtonElement);
    await settle();
    await choose(select("Belongs to"), "office");
    const runsOn = select("Runs on");
    expect(Array.from(runsOn.options).map((o) => o.textContent)).toEqual([
      'Claude (Anthropic API key), the office\'s key "Office Anthropic"',
      'DeepSeek, the office\'s key "Watchdog key"',
    ]);
    expect(text()).toContain("A shared agent never uses a person's login.");
    await choose(runsOn, "o-ds");
    await typeInto("Name", "Watchdog");
    await submit("New agent");
    expect(f.calls.find((c) => c.method === "POST")?.body).toMatchObject({
      owner: "office",
      profileId: "o-ds",
      model: "deepseek-flash",
    });

    for (const m of mounted.splice(0)) await m.unmount();
    await show("owner", {
      "GET /api/office-agents": { body: response([]) },
      "GET /api/office-agents/runs-on": { body: { personal: RUNS_ON.personal, shared: [] } },
    });
    await click(button("New agent…") as HTMLButtonElement);
    await settle();
    await choose(select("Belongs to"), "office");
    expect(text()).toContain("The office has no key of its own yet");
    expect((button("Create agent") as HTMLButtonElement).disabled).toBe(true);
  });

  test("changing an agent offers the same fields; its name, owner and program stay", async () => {
    const mine = agent({
      model: "deepseek-flash",
      runsOn: { kind: "deepseek", officeKey: false, label: "My DeepSeek" },
      appearance: "chef",
      config: { instructions: "Be brief.", profileId: "p-ds", grants: [], tokens: [] },
    });
    const f = await show("member", {
      "GET /api/office-agents": { body: response([mine]) },
      "PATCH /api/office-agents/a1": { body: mine },
    });
    expect(card("Hermes").textContent).toContain('Runs on: DeepSeek (own key "My DeepSeek")');
    expect(card("Hermes").textContent).toContain("Model: DeepSeek Flash");
    expect(card("Hermes").textContent).toContain("Looks: Chef");
    await click(within(card("Hermes"), "Change…") as HTMLButtonElement);
    await settle();
    expect(inputByLabel("Name").disabled).toBe(true);
    expect(select("Belongs to").disabled).toBe(true);
    expect(select("Runs as").disabled).toBe(true);
    expect(select("Runs on").value).toBe("p-ds");
    expect(radio("DeepSeek Flash").checked).toBe(true);
    expect(radio("Chef").checked).toBe(true);
    await click(radio("DeepSeek V4 Pro"));
    await click(radio("Black ops"));
    await submit("Change Hermes");
    // Only what changed is sent, so a change of looks alone never restarts a running agent.
    expect(f.calls.find((c) => c.method === "PATCH")?.body).toEqual({
      appearance: "black_ops",
      model: "deepseek-v4-pro",
    });
    // Saved: the form closes.
    expect(document.querySelector('form[aria-label="Change Hermes"]')).toBeNull();
  });
});
