/** Settings → Agents (#57): "Hermes, run by the office" in the form: offered when the office has it, greyed out with what to do when not; it runs on a key, never a login. */
import { afterEach, describe, expect, test } from "bun:test";
import type { OfficeAgentsResponse, OfficeAgentView } from "@regulus/protocol";
import { click, useDom } from "../a11y/dom.ts";
import { button, settle, submit, text, typeInto } from "../auth/testDom.tsx";
import {
  agent,
  card,
  choose,
  cleanup,
  radio,
  radioLabels,
  response,
  select,
  show,
} from "./testKit.tsx";

useDom();
afterEach(cleanup);

const withManaged = (agents: OfficeAgentView[]): OfficeAgentsResponse => ({
  ...response(agents),
  engines: ["cli-session", "hermes-external", "hermes-managed"],
});
const LABEL = "Hermes, run by the office (nothing to install)";

async function openForm(role: "member" | "owner", body: OfficeAgentsResponse) {
  const f = await show(role, {
    "GET /api/office-agents": { body },
    "POST /api/office-agents": {
      status: 201,
      body: agent({ name: "Scout", engine: "hermes-managed" }),
    },
  });
  await click(button("New agent…") as HTMLButtonElement);
  await settle();
  return f;
}

describe("Hermes, run by the office", () => {
  test("where the office has not turned it on, the choice is greyed out and says how to", async () => {
    await openForm("member", response([]));
    const options = Array.from(select("Runs as").options);
    const off = options.find((o) => o.textContent?.startsWith("Hermes, run by the office"));
    expect(off?.textContent).toBe("Hermes, run by the office (not turned on in this office)");
    expect(off?.disabled).toBe(true);
    expect(text()).toContain("Whoever runs this office can turn it on");
    expect(text()).toContain("OFFICE_HERMES_IMAGE");
  });

  test("where it is on, a member picks it, a key and a model; a login is not offered", async () => {
    const f = await openForm("member", withManaged([]));
    const runsAs = select("Runs as");
    expect(Array.from(runsAs.options).map((o) => o.textContent)).toEqual([
      "Claude Code session (runs here in the office)",
      "Connect my existing Hermes agent",
      LABEL,
    ]);
    expect(text()).not.toContain("not turned on");
    await choose(runsAs, "hermes-managed");
    expect(text()).toContain("The office starts a Hermes agent of its own for this agent");
    expect(text()).toContain("a subscription login cannot be used");
    // Runs on: the keys Hermes can run on, and no subscription login.
    expect(Array.from(select("Runs on").options).map((o) => o.textContent)).toEqual([
      'DeepSeek, my key "My DeepSeek"',
    ]);
    expect(radioLabels("Model")).toEqual([
      "DeepSeek V4 ProStrong",
      "DeepSeek FlashCheap",
      "Other…",
    ]);
    expect(radio("DeepSeek Flash").checked).toBe(true);

    await typeInto("Name", "Scout");
    await submit("New agent");
    expect(f.calls.find((c) => c.method === "POST")?.body).toMatchObject({
      name: "Scout",
      owner: "me",
      engine: "hermes-managed",
      provider: "claude-code",
      model: "deepseek-flash",
      profileId: "p-ds",
    });
  });

  test("a shared agent is not offered Hermes, and the form says why (#301)", async () => {
    await openForm("owner", withManaged([]));
    const runsAs = () => Array.from(select("Runs as").options).map((o) => o.value);
    expect(runsAs()).toContain("hermes-managed");
    expect(text()).not.toContain("Hermes is not offered for a shared agent");
    await choose(select("Belongs to"), "office");
    expect(runsAs()).not.toContain("hermes-managed");
    expect(runsAs()).not.toContain("hermes-external");
    expect(text()).toContain(
      "Hermes is not offered for a shared agent for now: it keeps its own memory across everyone it talks to",
    );
  });

  test("someone with no key Hermes can run on is told what to add, and cannot create it", async () => {
    await show("member", {
      "GET /api/office-agents": { body: withManaged([]) },
      "GET /api/office-agents/runs-on": {
        body: {
          personal: [{ owner: "me", provider: "claude-code", kind: "login", label: "" }],
          shared: [],
        },
      },
    });
    await click(button("New agent…") as HTMLButtonElement);
    await settle();
    await choose(select("Runs as"), "hermes-managed");
    expect(Array.from(select("Runs on").options).map((o) => o.textContent)).toEqual([
      "Nothing connected yet",
    ]);
    expect(text()).toContain("You have no key a Hermes can run on");
    expect((button("Create agent") as HTMLButtonElement).disabled).toBe(true);
  });

  test("its card says what it runs as and on", async () => {
    await show("member", {
      "GET /api/office-agents": {
        body: withManaged([
          agent({
            name: "Scout",
            engine: "hermes-managed",
            model: "deepseek-flash",
            runsOn: { kind: "deepseek", officeKey: false, label: "My DeepSeek" },
          }),
        ]),
      },
    });
    const scout = card("Scout").textContent ?? "";
    expect(scout).toContain("Runs as: Hermes, run by the office");
    expect(scout).toContain("Model: DeepSeek Flash");
    expect(scout).not.toContain("Provider and model: its own");
  });
});
