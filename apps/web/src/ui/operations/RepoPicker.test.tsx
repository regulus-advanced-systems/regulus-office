/** "Add operation" with the office GitHub connection (#141): pick repos from a searchable list. */
import { afterEach, describe, expect, test } from "bun:test";
import type { GitHubRepoInfo } from "@regulus/protocol";
import { act } from "react";
import { testWorld } from "../../scene/compound/testing.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { useOperationsStore } from "../../state/operations.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { settle, text } from "../auth/testDom.tsx";
import { createCompoundApi } from "../build-mode/api.ts";
import { confirmBuild } from "../build-mode/BuildModeHost.tsx";
import { useBuildModeStore } from "../build-mode/store.ts";
import { createGitHubApi } from "../settings/githubApi.ts";
import { ADD_OPERATION_OVERLAY, AddOperationDialogHost } from "./AddOperationDialog.tsx";
import { filterRepos, pushedAgo } from "./RepoPicker.tsx";

useDom();

const repo = (
  owner: string,
  name: string,
  extra: Partial<GitHubRepoInfo> = {},
): GitHubRepoInfo => ({
  owner,
  name,
  fullName: `${owner}/${name}`,
  private: true,
  defaultBranch: "main",
  pushedAt: Date.now() - 3 * 86_400_000,
  description: null,
  ...extra,
});

const REPOS = [
  repo("octo", "api", { description: "Backend service" }),
  repo("octo", "hello", { private: false, defaultBranch: "trunk" }),
  repo("octo", "web"),
];

const mounted: Mounted[] = [];
afterEach(async () => {
  for (const m of mounted.splice(0)) await m.unmount();
  await settle();
  await act(async () => {
    useUiStore.setState({ overlay: null });
    useOperationsStore.getState().clear();
    useSessionStore.setState({ status: "unknown", user: null, error: null });
    useBuildModeStore.getState().cancel();
    useBuildModeStore.setState({ added: null, watching: null, returnZoom: null });
    useCompoundStore.getState().set(null);
  });
  for (const el of document.querySelectorAll(".rg-backdrop")) el.remove();
});

async function typeUncontrolled(el: Element | null, value: string) {
  if (!(el instanceof HTMLInputElement)) throw new Error("not an input");
  await act(async () => {
    el.value = value;
  });
}
const inputFor = (label: string) => {
  const id = Array.from(document.querySelectorAll("label"))
    .find((l) => l.textContent === label)
    ?.getAttribute("for");
  return document.getElementById(id ?? "");
};
const checkbox = (fullName: string) =>
  Array.from(document.querySelectorAll<HTMLLabelElement>(".rg-repo-picker__row"))
    .find((l) => l.textContent?.includes(fullName))
    ?.querySelector("input");
const rows = () =>
  Array.from(document.querySelectorAll(".rg-repo-picker__name")).map((n) => n.textContent);

async function open(routes: Parameters<typeof fakeFetch>[0]) {
  useSessionStore.setState({
    status: "authenticated",
    user: { id: "u1", displayName: "Ante", role: "owner" },
    error: null,
  });
  const f = fakeFetch(routes);
  useCompoundStore.getState().set(testWorld([]));
  mounted.push(
    await mount(<AddOperationDialogHost github={createGitHubApi({ fetch: f.fetch })} />),
  );
  await act(async () => useUiStore.getState().openOverlay(ADD_OPERATION_OVERLAY));
  await settle();
  return f;
}

const connected = {
  "GET /api/github/connection": {
    body: {
      kind: "pat",
      source: "db",
      canStore: true,
      app: null,
      pat: { login: "bot" },
      connectedAt: 1,
    },
  },
  "GET /api/github/repos": { body: { repos: REPOS, truncated: false } },
};

describe("repo picker helpers", () => {
  test("filter by name or description; last push wording", () => {
    expect(filterRepos(REPOS, "HEL").map((r) => r.name)).toEqual(["hello"]);
    expect(filterRepos(REPOS, "backend").map((r) => r.name)).toEqual(["api"]);
    expect(filterRepos(REPOS, " ")).toHaveLength(3);
    const now = Date.UTC(2026, 8, 29);
    expect(pushedAgo(null, now)).toBe("never pushed");
    expect(pushedAgo(now - 1000, now)).toBe("pushed today");
    expect(pushedAgo(now - 3 * 86_400_000, now)).toBe("pushed 3 days ago");
    expect(pushedAgo(now - 90 * 86_400_000, now)).toBe("pushed 3 months ago");
  });
});

describe("Add operation with a GitHub connection", () => {
  test("lists repos with visibility and branch; picks go first, in the order picked", async () => {
    const f = await open({
      ...connected,
      "POST /api/compound/rooms": { status: 400, body: { error: "duplicate_repo" } },
    });
    expect(rows()).toEqual(["octo/api", "octo/hello", "octo/web"]);
    expect(text()).toContain("public · trunk · pushed 3 days ago");
    expect(text()).toContain("Other repo…");

    // Search is covered by filterRepos above; React's onChange for text inputs does not
    // fire under this happy-dom harness, so the list is not typed into here.
    expect(inputFor("Search repos")).not.toBeNull();
    const web = checkbox("octo/web");
    if (!web) throw new Error("no checkbox");
    await click(web);
    const api = checkbox("octo/api");
    if (!api) throw new Error("no checkbox");
    await click(api);
    expect(text()).toContain("2 of 3 selected.");

    await typeUncontrolled(inputFor("Operation name"), "Apollo");
    // A repo outside the connection, with its own token, goes after the picked ones.
    await typeUncontrolled(document.querySelector('[aria-label="Repo 1"]'), "other/thing");
    await typeUncontrolled(
      document.querySelector('[aria-label="Access token for repo 1"]'),
      "github_pat_FAKE_other_0123456789",
    );
    await act(async () => {
      document
        .querySelector('form[aria-label="New operation"]')
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    // Build mode takes the request; building there sends it with the room's spot.
    await act(() => confirmBuild(createCompoundApi({ fetch: f.fetch })));
    await settle();
    const post = f.calls.find((c) => c.method === "POST");
    expect(post?.body).toMatchObject({
      name: "Apollo",
      repos: [
        { repo: "octo/web" },
        { repo: "octo/api" },
        { repo: "other/thing", token: "github_pat_FAKE_other_0123456789" },
      ],
    });
    expect(text()).toContain("The same repo is listed twice.");
    expect(document.body.innerHTML).not.toContain("github_pat_FAKE_other");
  });

  test("without a connection the typed repo rows show, with a pointer to Settings", async () => {
    await open({
      "GET /api/github/connection": {
        body: { ...connected["GET /api/github/connection"].body, kind: "none", pat: null },
      },
    });
    expect(document.querySelector(".rg-repo-picker")).toBeNull();
    expect(document.querySelector('[aria-label="Repo 1"]')).not.toBeNull();
    expect(text()).toContain("Connect GitHub in Settings");
  });

  test("a failed repo list is explained and typed repos still work", async () => {
    await open({
      "GET /api/github/connection": connected["GET /api/github/connection"],
      "GET /api/github/repos": {
        status: 502,
        body: { error: "github_unavailable", detail: "GitHub: Server Error (500)" },
      },
    });
    expect(text()).toContain("GitHub could not be asked for the repo list");
    expect(document.querySelector('[aria-label="Repo 1"]')).not.toBeNull();
  });
});
