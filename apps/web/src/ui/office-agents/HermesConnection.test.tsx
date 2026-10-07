/** Settings → Agents (#58): connecting a person's own Hermes: the form, the test button, the card. */
import { afterEach, describe, expect, test } from "bun:test";
import { click, useDom } from "../a11y/dom.ts";
import { button, settle, submit, text, typeInto } from "../auth/testDom.tsx";
import { agent, card, choose, cleanup, response, select, show, within } from "./testKit.tsx";

useDom();
afterEach(cleanup);

const withHermes = (agents: Parameters<typeof response>[0]) => ({
  ...response(agents),
  engines: ["cli-session", "hermes-external"] as const,
});
const HERMES = agent({
  id: "h1",
  name: "Hermes",
  engine: "hermes-external",
  provider: "custom",
  model: "hermes",
  config: {
    instructions: "",
    grants: [],
    tokens: [],
    hermes: { connected: true, continuesSession: false, updatedAt: 1 },
  },
});

describe("connecting my existing Hermes", () => {
  test("the form asks for the address and the token, tests them, and creates the agent with them", async () => {
    const f = await show("member", {
      "GET /api/office-agents": { body: withHermes([]) },
      "POST /api/office-agents/hermes/test": {
        body: {
          ok: true,
          code: "connected",
          detail: "Connected to Hermes 0.21.5.",
          version: "0.21.5",
        },
      },
      "POST /api/office-agents": { status: 201, body: HERMES },
    });
    await click(button("New agent…") as HTMLButtonElement);
    await settle();
    const runsAs = select("Runs as");
    expect(Array.from(runsAs.options).map((o) => o.textContent)).toEqual([
      "Claude Code session (runs here in the office)",
      "Connect my existing Hermes agent",
    ]);
    await choose(runsAs, "hermes-external");
    // Plain help, and no provider or model to pick: Hermes brings its own.
    expect(text()).toContain("Telegram and its other channels keep working");
    expect(text()).not.toContain("Runs on");
    // What to set up on the Hermes side is right there, with this office's own address.
    expect(text()).toContain("What to set up in Hermes");
    expect(text()).toContain("API_SERVER_ENABLED=true");
    expect(text()).toMatch(/url: "https?:\/\/[^"]+\/mcp"/);
    expect(text()).toContain('Authorization: "Bearer <the access code>"');

    // Nothing is sent while a field is missing or the address is no address.
    await typeInto("Name", "Hermes");
    await submit("New agent");
    expect(text()).toContain("Enter the address of your Hermes.");
    await typeInto("Address of your Hermes", "my-server:8642");
    await click(button("Test connection") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("must start with http:// or https://");
    expect(f.calls.some((c) => c.method === "POST")).toBe(false);

    await typeInto("Address of your Hermes", "http://my-server:8642");
    await typeInto("Access token", "hermes-key-0123456789");
    await click(button("Test connection") as HTMLButtonElement);
    await settle();
    expect(f.calls.find((c) => c.path === "/api/office-agents/hermes/test")?.body).toEqual({
      url: "http://my-server:8642",
      token: "hermes-key-0123456789",
    });
    expect(text()).toContain("Connected to Hermes 0.21.5.");

    await submit("New agent");
    expect(
      f.calls.find((c) => c.path === "/api/office-agents" && c.method === "POST")?.body,
    ).toEqual({
      name: "Hermes",
      owner: "me",
      engine: "hermes-external",
      role: "assistant",
      preset: "coordinator",
      appearance: "standard",
      instructions: "",
      provider: "custom",
      model: "hermes",
      hermes: { url: "http://my-server:8642", token: "hermes-key-0123456789" },
    });
  });

  test("a failed test says why in the office's words", async () => {
    await show("member", {
      "GET /api/office-agents": { body: withHermes([]) },
      "POST /api/office-agents/hermes/test": {
        body: {
          ok: false,
          code: "bad_token",
          detail: "A Hermes answers there, but it refuses this access token.",
        },
      },
    });
    await click(button("New agent…") as HTMLButtonElement);
    await settle();
    await choose(select("Runs as"), "hermes-external");
    await typeInto("Address of your Hermes", "https://hermes.example");
    await typeInto("Access token", "wrong-key-0123456789");
    await click(button("Test connection") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("it refuses this access token");
  });

  test("it is not offered for a shared agent", async () => {
    await show("owner", { "GET /api/office-agents": { body: withHermes([]) } });
    await click(button("New agent…") as HTMLButtonElement);
    await settle();
    await choose(select("Runs as"), "hermes-external");
    expect(text()).toContain("Address of your Hermes");
    await choose(select("Belongs to"), "office");
    expect(Array.from(select("Runs as").options).map((o) => o.value)).toEqual(["cli-session"]);
    expect(text()).not.toContain("Address of your Hermes");
  });

  test("the card shows it as the owner's own Hermes, tests the stored connection and replaces it", async () => {
    const f = await show("member", {
      "GET /api/office-agents": { body: withHermes([HERMES]) },
      "POST /api/office-agents/hermes/test": {
        body: {
          ok: false,
          code: "unreachable",
          detail: "Nothing answers at that address from where the office runs.",
        },
      },
      "PUT /api/office-agents/h1/hermes": { body: HERMES },
    });
    const c = card("Hermes");
    expect(c.textContent).toContain("Runs as: My own Hermes");
    expect(c.textContent).toContain("Provider and model: its own");
    expect(c.textContent).not.toContain("Runs on:");
    expect(c.textContent).toContain("kept encrypted and are not shown again");
    // Nothing of the stored connection is on the page: there is nothing to show.
    expect(c.querySelectorAll('input[type="password"]').length).toBe(0);

    await click(within(c, "Test connection") as HTMLButtonElement);
    await settle();
    expect(f.calls.find((x) => x.path === "/api/office-agents/hermes/test")?.body).toEqual({
      agentId: "h1",
    });
    expect(c.textContent).toContain("Nothing answers at that address");

    await click(within(c, "Replace connection…") as HTMLButtonElement);
    await typeInto("Address of your Hermes", "http://new-home:8642/");
    await typeInto("Access token", "new-key-0123456789abc");
    await click(within(card("Hermes"), "Save connection") as HTMLButtonElement);
    await settle();
    expect(f.calls.find((x) => x.method === "PUT")?.body).toEqual({
      url: "http://new-home:8642/",
      token: "new-key-0123456789abc",
    });
  });

  test("an admin sees someone's Hermes as a card without its connection", async () => {
    await show("admin", {
      "GET /api/office-agents": {
        body: withHermes([
          agent({
            ...HERMES,
            owner: { kind: "user", userId: "u9", displayName: "Mia" },
            status: "error",
            statusReason: "the Hermes gateway cannot be reached. Trying again.",
            canTalk: false,
            canConfigure: false,
            config: undefined,
          }),
        ]),
      },
    });
    const c = card("Hermes");
    expect(c.textContent).toContain("Error");
    expect(c.textContent).toContain("the Hermes gateway cannot be reached");
    expect(c.textContent).not.toContain("Connection to your Hermes");
    expect(within(c, "Test connection")).toBeUndefined();
  });
});
