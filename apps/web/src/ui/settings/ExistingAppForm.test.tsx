/** Settings → GitHub → "Use an existing GitHub App…" (#224). */
import { afterEach, describe, expect, test } from "bun:test";
import type {
  ConnectExistingAppResponse,
  GitHubAppRequirements,
  GitHubConnectionStatus,
} from "@regulus/protocol";
import { act } from "react";
import { useSessionStore } from "../../state/session.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import { describeMissing, permissionLabel } from "./ExistingAppForm.tsx";
import { GitHubSection } from "./GitHubSection.tsx";
import { createGitHubApi } from "./githubApi.ts";

useDom();

const KEY = `-----BEGIN RSA PRIVATE KEY-----\n${"MIIEfakekeymaterial".repeat(8)}\n-----END RSA PRIVATE KEY-----`;
const SECRET = "whsec_component_0123456789";
const NONE: GitHubConnectionStatus = {
  kind: "none",
  source: null,
  canStore: true,
  app: null,
  pat: null,
  connectedAt: null,
};
const REQ: GitHubAppRequirements = {
  webhookUrl: "https://office.example/api/github/webhook",
  setupUrl: "https://office.example/api/github/app/installed",
  permissions: { contents: "write", pull_requests: "write", metadata: "read" },
  events: ["issues", "push"],
};
const CONNECTED: ConnectExistingAppResponse = {
  status: {
    ...NONE,
    kind: "app",
    source: "db",
    connectedAt: 1,
    app: {
      appId: 4242,
      slug: "old-office-app",
      name: "Old office app",
      htmlUrl: "https://github.com/apps/old-office-app",
      installUrl: "https://github.com/apps/old-office-app/installations/new",
      owner: "octo",
      installations: [],
      error: null,
    },
  },
  missingPermissions: [{ name: "checks", required: "write", granted: "read" }],
  missingEvents: ["push"],
};

const mounted: Mounted[] = [];
afterEach(async () => {
  for (const m of mounted.splice(0)) await m.unmount();
  await settle();
  useSessionStore.setState({ status: "unknown", user: null, error: null });
});

async function show(routes: Parameters<typeof fakeFetch>[0]) {
  useSessionStore.setState({
    status: "authenticated",
    user: { id: "u1", displayName: "Ante", role: "owner" },
    error: null,
  });
  const f = fakeFetch({ "GET /api/github/connection": { body: NONE }, ...routes });
  mounted.push(await mount(<GitHubSection api={createGitHubApi({ fetch: f.fetch })} />));
  await settle();
  await click(button("Use an existing GitHub App") as HTMLButtonElement);
  await settle();
  return f;
}

const field = <T extends HTMLElement>(label: string): T => {
  const id = Array.from(document.querySelectorAll("label"))
    .find((l) => l.textContent?.trim() === label)
    ?.getAttribute("for");
  const el = document.getElementById(id ?? "");
  if (!el) throw new Error(`no field ${label}`);
  return el as T;
};
async function set(label: string, value: string) {
  await act(async () => {
    field<HTMLInputElement>(label).value = value;
  });
}

describe("existing GitHub App form", () => {
  test("shows what to set on the app, from the server", async () => {
    const f = await show({ "GET /api/github/app/requirements": { body: REQ } });
    expect(f.calls.some((c) => c.path === "/api/github/app/requirements")).toBe(true);
    expect(text()).toContain("https://office.example/api/github/webhook");
    expect(text()).toContain("https://office.example/api/github/app/installed");
    expect(text()).toContain("Contents (write), Pull requests (write), Metadata (read)");
    expect(text()).toContain("Subscribe to events: issues, push");
    expect(text()).toContain("GitHub never shows the old secret again");
  });

  test("a picked .pem fills the key; connect sends it once and clears every input", async () => {
    const f = await show({
      "GET /api/github/app/requirements": { body: REQ },
      "PUT /api/github/app": { body: CONNECTED },
    });
    await set("App ID", "4242");
    const file = field<HTMLInputElement>("Private key (.pem file)");
    await act(async () => {
      Object.defineProperty(file, "files", {
        configurable: true,
        value: [new File([KEY], "app.private-key.pem")],
      });
      file.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(field<HTMLTextAreaElement>("Or paste the private key").value).toBe(KEY);
    await set("Webhook secret (optional)", SECRET);
    await click(button("Connect app") as HTMLButtonElement);
    await settle();
    expect(f.calls.find((c) => c.method === "PUT")?.body).toEqual({
      appId: 4242,
      privateKey: KEY,
      webhookSecret: SECRET,
    });
    expect(text()).toContain("Connected with the GitHub App Old office app");
    expect(text()).toContain("Install it on your organization next");
    expect(text()).toContain("Checks (write; has read)");
    expect(text()).toContain("events: push");
    expect(document.body.innerHTML).not.toContain("MIIEfakekeymaterial");
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  test("a refused key is explained and the inputs are cleared", async () => {
    await show({
      "GET /api/github/app/requirements": { body: REQ },
      "PUT /api/github/app": {
        status: 400,
        body: {
          error: "github_rejected",
          detail: "GitHub did not accept the key for that app ID.",
        },
      },
    });
    await set("App ID", "4242");
    await set("Or paste the private key", KEY);
    await set("Client ID (optional)", "Iv1abc");
    await click(button("Connect app") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("GitHub did not accept the key for that app ID.");
    expect(field<HTMLTextAreaElement>("Or paste the private key").value).toBe("");
    expect(field<HTMLInputElement>("App ID").value).toBe("");
    expect(document.body.innerHTML).not.toContain("MIIEfakekeymaterial");
  });

  test("missing fields are caught before any request", async () => {
    const f = await show({ "GET /api/github/app/requirements": { body: REQ } });
    await click(button("Connect app") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("numeric App ID");
    expect(f.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  test("wording helpers", () => {
    expect(permissionLabel("pull_requests")).toBe("Pull requests");
    expect(describeMissing({ ...CONNECTED, missingPermissions: [], missingEvents: [] })).toBeNull();
  });
});
