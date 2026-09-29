/** Settings → GitHub (#141): who sees it, the App manifest hand-off, the PAT fallback. */
import { afterEach, describe, expect, test } from "bun:test";
import type { GitHubConnectionStatus, StartManifestResponse, UserRole } from "@regulus/protocol";
import { act } from "react";
import { useSessionStore } from "../../state/session.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import { describeConnection, GitHubSection } from "./GitHubSection.tsx";
import { createGitHubApi, describeManifestResult } from "./githubApi.ts";

useDom();

const PAT = "github_pat_FAKE_settings_0123456789";
const NONE: GitHubConnectionStatus = {
  kind: "none",
  source: null,
  canStore: true,
  app: null,
  pat: null,
  connectedAt: null,
};
const PAT_STATUS: GitHubConnectionStatus = {
  ...NONE,
  kind: "pat",
  source: "db",
  pat: { login: "octo-bot" },
  connectedAt: 1,
};

const mounted: Mounted[] = [];
afterEach(async () => {
  for (const m of mounted.splice(0)) await m.unmount();
  await settle();
  useSessionStore.setState({ status: "unknown", user: null, error: null });
});

async function show(role: UserRole, routes: Parameters<typeof fakeFetch>[0]) {
  useSessionStore.setState({
    status: "authenticated",
    user: { id: "u1", displayName: "Ante", role },
    error: null,
  });
  const f = fakeFetch(routes);
  const submitted: StartManifestResponse[] = [];
  mounted.push(
    await mount(
      <GitHubSection
        api={createGitHubApi({ fetch: f.fetch })}
        submitManifest={(s) => submitted.push(s)}
      />,
    ),
  );
  await settle();
  return { f, submitted };
}

const inputFor = (label: string) => {
  const id = Array.from(document.querySelectorAll("label"))
    .find((l) => l.textContent?.startsWith(label))
    ?.getAttribute("for");
  const el = document.getElementById(id ?? "");
  if (!(el instanceof HTMLInputElement)) throw new Error(`no input ${label}`);
  return el;
};
async function typeInto(el: HTMLInputElement, value: string) {
  await act(async () => {
    el.value = value;
  });
}

describe("GitHub settings", () => {
  test("members and viewers do not see it", async () => {
    const { f } = await show("member", { "GET /api/github/connection": { body: NONE } });
    expect(text()).not.toContain("GitHub");
    expect(f.calls).toHaveLength(0);
  });

  test("an owner creates the GitHub App for an org: the manifest goes to GitHub", async () => {
    const start = {
      action: "https://github.com/organizations/octo/settings/apps/new?state=s1",
      manifest: "{}",
    };
    const { f, submitted } = await show("owner", {
      "GET /api/github/connection": { body: NONE },
      "POST /api/github/app/manifest": { body: start },
    });
    expect(text()).toContain("Not connected");
    await typeInto(inputFor("Organization"), "octo");
    await click(button("Create GitHub App") as HTMLButtonElement);
    await settle();
    expect(f.calls.find((c) => c.method === "POST")?.body).toEqual({ org: "octo" });
    expect(submitted).toEqual([start]);
  });

  test("an admin connects an org token; it never stays in the page", async () => {
    const { f } = await show("admin", {
      "GET /api/github/connection": { body: NONE },
      "PUT /api/github/pat": { body: PAT_STATUS },
    });
    const input = inputFor("Or an organization access token");
    await typeInto(input, PAT);
    await click(button("Connect with token") as HTMLButtonElement);
    await settle();
    expect(f.calls.find((c) => c.method === "PUT")?.body).toEqual({ token: PAT });
    expect(input.value).toBe("");
    expect(text()).toContain("Connected with an organization token (octo-bot)");
    expect(document.body.innerHTML).not.toContain(PAT);
    expect(button("Disconnect GitHub")).toBeDefined();
  });

  test("a rejected token is explained", async () => {
    await show("owner", {
      "GET /api/github/connection": { body: NONE },
      "PUT /api/github/pat": {
        status: 400,
        body: { error: "github_rejected", detail: "GitHub: Bad credentials (401)" },
      },
    });
    await typeInto(inputFor("Or an organization access token"), PAT);
    await click(button("Connect with token") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("GitHub did not accept that token (GitHub: Bad credentials (401))");
  });

  test("disconnect; an env-managed app cannot be disconnected; no master key", async () => {
    const d = await show("owner", {
      "GET /api/github/connection": { body: PAT_STATUS },
      "DELETE /api/github/connection": { status: 204 },
    });
    await click(button("Disconnect GitHub") as HTMLButtonElement);
    await settle();
    expect(d.f.calls.some((c) => c.method === "DELETE")).toBe(true);
    for (const m of mounted.splice(0)) await m.unmount();

    const envApp: GitHubConnectionStatus = {
      ...NONE,
      kind: "app",
      source: "env",
      app: {
        appId: 9,
        slug: null,
        name: null,
        htmlUrl: null,
        installUrl: null,
        owner: null,
        installations: [{ installationId: 1, account: "octo", repositorySelection: "all" }],
        error: null,
      },
    };
    await show("owner", { "GET /api/github/connection": { body: envApp } });
    expect(text()).toContain("installed on octo (all repos)");
    expect(text()).toContain("Set by the server environment");
    expect(button("Disconnect GitHub")).toBeUndefined();
    for (const m of mounted.splice(0)) await m.unmount();

    await show("owner", { "GET /api/github/connection": { body: { ...NONE, canStore: false } } });
    expect(text()).toContain("no OFFICE_MASTER_KEY");
    expect(button("Create GitHub App")).toBeUndefined();
  });

  test("wording helpers", () => {
    expect(describeConnection(NONE)).toContain("Not connected");
    expect(describeManifestResult("installed").ok).toBe(true);
    expect(describeManifestResult("invalid_state").ok).toBe(false);
  });
});
