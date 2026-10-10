/**
 * Settings → Watchdog, the setup for owners and admins (#253): "Do a round
 * now", the SSH key and the Sentry token as write-only fields, the host's
 * pinned key, what starting fixes without asking means, and known noise.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { click, useDom } from "../a11y/dom.ts";
import type { fakeFetch } from "../auth/fakeFetch.ts";
import { button, settle, submit, text } from "../auth/testDom.tsx";
import {
  cleanup,
  field,
  finding,
  HOST,
  KEY,
  NOW,
  report,
  SETTINGS,
  show,
  type,
} from "./testKit.tsx";

useDom();
afterEach(cleanup);

describe("the setup, for owners and admins", () => {
  const routes = (over: Parameters<typeof fakeFetch>[0] = {}) => ({
    "GET /api/watchdog": { body: report({ canRunNow: true, canConfigure: true }) },
    "GET /api/watchdog/settings": { body: SETTINGS },
    ...over,
  });

  test("an admin asks for a round now", async () => {
    const f = await show(
      "admin",
      routes({
        "POST /api/watchdog/rounds": {
          status: 202,
          body: report({ running: true, canRunNow: true }),
        },
      }),
    );
    await click(button("Do a round now") as HTMLButtonElement);
    await settle();
    expect(f.calls.some((c) => c.method === "POST" && c.path === "/api/watchdog/rounds")).toBe(
      true,
    );
  });

  test("a stored key and token are never shown; a room the admin cannot see is kept unnamed", async () => {
    await show("admin", routes());
    expect(text()).toContain("watchdog@vps.example.com:22 · key stored");
    expect(text()).toContain("host key pinned (stored on first contact)");
    expect(text()).toContain("ssh-ed25519 SHA256:AAAAAAAA");
    expect(text()).toContain("api (a room you cannot see), worker (no room)");
    const token = field("Access token") as HTMLInputElement;
    expect(token.type).toBe("password");
    expect(token.value).toBe("");
    expect(token.placeholder).toContain("A token is stored");
    // Its project's room is one this admin cannot see: the choice is "kept", with no name.
    const room = document.querySelector(
      'select[aria-label="Room of project 1"]',
    ) as HTMLSelectElement;
    expect(room.selectedOptions[0]?.textContent).toBe("A room you cannot see (kept)");
  });

  test("saving Sentry sends the token with that save only and leaves a hidden room as it is", async () => {
    const f = await show(
      "admin",
      routes({
        "PATCH /api/watchdog/settings": { body: SETTINGS },
        "PUT /api/watchdog/sentry-projects": { body: SETTINGS },
      }),
    );
    await type(field("Access token"), "sntryu_FAKE0123456789");
    await click(button("Save Sentry") as HTMLButtonElement);
    await settle();
    expect(f.calls.find((c) => c.method === "PATCH")?.body).toEqual({
      sentryOrganization: "acme",
      sentryHost: "sentry.io",
      sentryToken: "sntryu_FAKE0123456789",
    });
    // No `operationId`: the server keeps the room this admin cannot see. The token goes with
    // the projects too: with it an admin who is not the owner may add one.
    expect(f.calls.find((c) => c.method === "PUT")?.body).toEqual({
      projects: [{ slug: "web" }],
      sentryToken: "sntryu_FAKE0123456789",
    });
    expect((field("Access token") as HTMLInputElement).value).toBe("");
    expect(document.body.innerHTML).not.toContain("sntryu_FAKE0123456789");
  });

  test("a new host: the private key goes out once and is on the page no more", async () => {
    const f = await show(
      "admin",
      routes({
        "POST /api/watchdog/hosts": { status: 201, body: { ...HOST, id: "h2", label: "prod-2" } },
      }),
    );
    await click(button("Add a host") as HTMLButtonElement);
    await type(field("Name"), "prod-2");
    await type(field("Address"), "vps2.example.com");
    await type(field("Read-only user"), "watchdog");
    await type(field("That user's SSH private key"), KEY);
    await type(document.querySelector('input[aria-label="App 1 name"]'), "api");
    await submit("New host");
    expect(f.calls.find((c) => c.method === "POST")?.body).toEqual({
      label: "prod-2",
      host: "vps2.example.com",
      port: 22,
      username: "watchdog",
      privateKey: KEY,
      hostKey: "",
      apps: [{ name: "api", operationId: null }],
    });
    expect(document.querySelector('form[aria-label="New host"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain("FAKEFAKEFAKE");
  });

  test("changing a host keeps its key unless a new one is typed", async () => {
    const f = await show("admin", routes({ "PUT /api/watchdog/hosts/h1": { body: HOST } }));
    await click(button("Change") as HTMLButtonElement);
    const key = field("That user's SSH private key") as HTMLTextAreaElement;
    expect(key.value).toBe("");
    expect(key.placeholder).toBe("A key is stored. Leave empty to keep it.");
    expect(text()).toContain("The host's key is pinned. Saving does not change it");
    await submit("Change host prod-1");
    const body = f.calls.find((c) => c.method === "PUT")?.body as Record<string, unknown>;
    expect("privateKey" in body).toBe(false);
    // A pin is not something a save can change: the form has no field for it and sends none.
    expect("hostKey" in body).toBe(false);
    // The app in a room this admin cannot see keeps it: no `operationId` is sent for it.
    expect(body.apps).toEqual([{ name: "api" }, { name: "worker", operationId: null }]);
  });

  test("another address is another machine: its key can be given with the change", async () => {
    const f = await show("admin", routes({ "PUT /api/watchdog/hosts/h1": { body: HOST } }));
    await click(button("Change") as HTMLButtonElement);
    expect(field("The new machine's public key (optional)")).toBeNull();
    expect(text()).toContain("unless you own the office, paste the key again");
    await type(field("Address"), "new.example.com");
    await type(
      field("The new machine's public key (optional)"),
      "new.example.com ssh-ed25519 AAAAC3Nz",
    );
    await type(field("That user's SSH private key"), KEY);
    await submit("Change host prod-1");
    expect(f.calls.find((c) => c.method === "PUT")?.body).toMatchObject({
      host: "new.example.com",
      hostKey: "new.example.com ssh-ed25519 AAAAC3Nz",
      privateKey: KEY,
    });
  });

  test("a target that is kept but not watched is said so and is not sent back as watched", async () => {
    const kept = {
      ...HOST,
      pinned: [],
      pinnedBy: "none" as const,
      apps: [
        { id: "p1", name: "api", operationId: null, operationHidden: true, watched: false },
        { id: "p2", name: "worker", operationId: null, operationHidden: false, watched: true },
      ],
    };
    const f = await show(
      "admin",
      routes({
        "GET /api/watchdog/settings": { body: { ...SETTINGS, hosts: [kept] } },
        "PUT /api/watchdog/hosts/h1": { body: kept },
      }),
    );
    expect(text()).toContain("api (a room you cannot see, not watched), worker (no room)");
    expect(text()).toContain("host key not yet verified: the first one it shows will be trusted");
    await click(button("Change") as HTMLButtonElement);
    expect(text()).toContain("Kept but not watched: api.");
    await submit("Change host prod-1");
    const body = f.calls.find((c) => c.method === "PUT")?.body as Record<string, unknown>;
    expect(body.apps).toEqual([{ name: "worker", operationId: null }]);
  });

  test("a new key the office could not read cannot be accepted", async () => {
    const unread = { ...HOST, offered: [], offeredAt: NOW };
    await show(
      "admin",
      routes({ "GET /api/watchdog/settings": { body: { ...SETTINGS, hosts: [unread] } } }),
    );
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("there is nothing to accept yet. The pinned key stays.");
    expect(button("Accept new key")).toBeUndefined();
  });

  test("a host that shows another key is flagged, and the new key is accepted only with a click", async () => {
    const changed = {
      ...HOST,
      offered: ["ssh-ed25519 SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"],
      offeredAt: NOW,
    };
    const f = await show(
      "admin",
      routes({
        "GET /api/watchdog/settings": { body: { ...SETTINGS, hosts: [changed] } },
        "POST /api/watchdog/hosts/h1/accept-key": { body: HOST },
      }),
    );
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("prod-1 now shows another key than the pinned one.");
    expect(alert?.textContent).toContain("SHA256:BBBBBBBB");
    expect(f.calls.some((c) => c.path.endsWith("/accept-key"))).toBe(false);
    await click(button("Accept new key") as HTMLButtonElement);
    await settle();
    expect(
      f.calls.some((c) => c.method === "POST" && c.path === "/api/watchdog/hosts/h1/accept-key"),
    ).toBe(true);
  });

  test("starting fixes without asking says in plain words what that means, before and after", async () => {
    const auto = {
      ...SETTINGS,
      fixMode: "auto" as const,
      autoFixBy: { userId: "u1", displayName: "Ante" },
    };
    const f = await show("owner", routes({ "PATCH /api/watchdog/settings": { body: auto } }));
    const sw = Array.from(document.querySelectorAll('[role="switch"]')).find((el) =>
      el.textContent?.startsWith("Start fixes without asking"),
    ) as HTMLButtonElement;
    expect(sw.getAttribute("aria-checked")).toBe("false");
    const note = () => document.querySelector('[role="note"]')?.textContent ?? "";
    // Before the switch is touched: whose name, whose credentials, from what, read by whom.
    expect(note()).toContain("A coding henchman runs in your name, on your credentials");
    expect(note()).toContain("from what the watchdog read in production logs and Sentry");
    expect(note()).toContain("Nobody reads the finding first");
    expect(note()).toContain("always a draft pull request, never a merge");
    expect(
      (
        document.getElementById(
          Array.from(document.querySelectorAll("label"))
            .find((l) => l.textContent?.trim() === "At most per round")
            ?.getAttribute("for") ?? "",
        ) as HTMLInputElement
      ).value,
    ).toBe("1");
    await click(sw);
    await settle();
    expect(f.calls.find((c) => c.method === "PATCH")?.body).toEqual({ fixMode: "auto" });
    expect(note()).toContain("On, switched on by Ante.");
    expect(note()).toContain("runs in their name, on their credentials");
  });

  test("a person marks a finding as known noise", async () => {
    const f = await show("member", {
      "GET /api/watchdog": { body: report() },
      "POST /api/watchdog/findings/f1/noise": {
        body: finding({ noise: true, disposition: "dismiss" }),
      },
    });
    await click(button("Known noise: always dismiss") as HTMLButtonElement);
    await settle();
    expect(f.calls.find((c) => c.method === "POST")?.body).toEqual({ noise: true });
  });
});
