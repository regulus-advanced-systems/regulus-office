/** Settings → You → Your GitHub account (#267): link, last check, what opens, check now, unlink. */
import { afterEach, describe, expect, test } from "bun:test";
import type { GitHubLinkStatus } from "@regulus/protocol";
import { useSessionStore } from "../../state/session.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import { describeChecked, describeLink, GitHubLinkSection } from "./GitHubLinkSection.tsx";
import { createGitHubLinkApi, describeLinkResult } from "./githubLinkApi.ts";

useDom();

const NONE: GitHubLinkStatus = {
  available: true,
  unavailableReason: null,
  state: "not_linked",
  login: null,
  linkedAt: null,
  lastCheckedAt: null,
  lastError: null,
  organizations: [],
  repos: [],
};
const LINKED: GitHubLinkStatus = {
  ...NONE,
  state: "linked",
  login: "mia",
  linkedAt: 1,
  lastCheckedAt: Date.now(),
  organizations: ["octo"],
  repos: [
    { repoId: "r1", fullName: "octo/hello", permission: "write", access: "spawn" },
    { repoId: "r2", fullName: "octo/docs", permission: "read", access: "view" },
    { repoId: "r3", fullName: "mia/notes", permission: "admin", access: "manage" },
  ],
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
    user: { id: "u1", displayName: "Mia", role: "member" },
    error: null,
  });
  const f = fakeFetch(routes);
  const visited: string[] = [];
  mounted.push(
    await mount(
      <GitHubLinkSection
        api={createGitHubLinkApi({ fetch: f.fetch })}
        navigate={(url) => visited.push(url)}
      />,
    ),
  );
  await settle();
  return { f, visited };
}

describe("your GitHub account", () => {
  test("a member who has not linked is told what that means and sent to GitHub to link", async () => {
    const url = "https://github.example/login/oauth/authorize?client_id=c&state=s";
    const { f, visited } = await show({
      "GET /api/github/link": { body: NONE },
      "POST /api/github/link/start": { body: { url } },
    });
    expect(text()).toContain("you can only be in the lobby");
    expect(button("Check now")).toBeUndefined();
    expect(button("Unlink")).toBeUndefined();
    await click(button("Link GitHub account…") as HTMLButtonElement);
    await settle();
    expect(visited).toEqual([url]);
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/github/link",
      "POST /api/github/link/start",
    ]);
  });

  test("linked: the account, the last check and what each permission opens", async () => {
    await show({ "GET /api/github/link": { body: LINKED } });
    const shown = text();
    expect(shown).toContain("Linked to mia.");
    expect(shown).toContain("Last checked just now.");
    expect(shown).toContain("Organizations: octo.");
    expect(shown).toContain("octo/hello: write on GitHub, so you can work in the room");
    expect(shown).toContain("octo/docs: read on GitHub, so you can view");
    expect(shown).toContain("mia/notes: admin on GitHub, so you can manage the room");
    expect(button("Link GitHub account…")).toBeUndefined();
  });

  test("check now shows the new snapshot; too soon is said plainly", async () => {
    let n = 0;
    await show({
      "GET /api/github/link": { body: LINKED },
      "POST /api/github/link/check": () => {
        n += 1;
        return n === 1
          ? { body: { ...LINKED, repos: [] } }
          : { status: 429, body: { error: "too_many_requests" } };
      },
    });
    await click(button("Check now") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("cannot see any of the office's repos");
    await click(button("Check now") as HTMLButtonElement);
    await settle();
    expect(text()).toContain("Try again in a few seconds");
  });

  test("a revoked link says so and offers to link again or unlink", async () => {
    const { f } = await show({
      "GET /api/github/link": {
        body: { ...LINKED, state: "revoked", repos: [], organizations: [] },
      },
      "DELETE /api/github/link": { body: NONE },
    });
    expect(text()).toContain("no longer accepts the link to mia");
    expect(button("Link again…")).toBeDefined();
    expect(button("Check now")).toBeUndefined();
    await click(button("Unlink") as HTMLButtonElement);
    await settle();
    expect(f.calls.at(-1)).toMatchObject({ method: "DELETE", path: "/api/github/link" });
    expect(text()).toContain("GitHub account unlinked.");
    expect(text()).toContain("Not linked.");
  });

  test("an office without GitHub sign-in set up offers no link button", async () => {
    await show({
      "GET /api/github/link": {
        body: { ...NONE, available: false, unavailableReason: "oauth_not_configured" },
      },
    });
    expect(text()).toContain("Linking is off");
    expect(button("Link GitHub account…")).toBeUndefined();
  });

  test("wording helpers", () => {
    expect(describeLink(NONE)).toContain("Not linked");
    expect(describeChecked(null)).toBe("Not checked yet.");
    expect(describeChecked(0, 5 * 60_000)).toBe("Last checked 5 min ago.");
    expect(describeChecked(0, 3 * 3_600_000)).toBe("Last checked 3 h ago.");
    expect(describeChecked(0, 72 * 3_600_000)).toBe("Last checked 3 days ago.");
    expect(describeLinkResult("linked")).toEqual({ ok: true, text: "GitHub account linked." });
    expect(describeLinkResult("account_in_use").ok).toBe(false);
    expect(describeLinkResult("weird").text).toContain("weird");
  });
});
