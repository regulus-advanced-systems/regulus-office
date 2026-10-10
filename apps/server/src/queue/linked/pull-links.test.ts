/**
 * The parts' pull requests naming each other (#257): the office's own marked
 * section, which repo may be named where, and the GitHub calls.
 */
import { describe, expect, test } from "bun:test";
import { CreateLinkedTaskRequest } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { tasks } from "../../db/schema/index.ts";
import type { RepoAccess, RepoCheckout } from "../../github/repo-access.ts";
import {
  githubPullPages,
  namable,
  type PullPage,
  SECTION_END,
  SECTION_START,
  withLinkedSection,
} from "./pull-links.ts";
import { API, makeLinked, officeFixture, repoOf, request, WEB } from "./test-helpers.ts";

const page = (repo: string, isPrivate: boolean): { page: PullPage } => ({
  page: { repo, isPrivate, body: "", url: `https://github.com/${repo}/pull/1` },
});

describe("the linked section", () => {
  const sibling = { repo: "octo/api", number: 12, url: "https://github.com/octo/api/pull/12" };

  test("is added after the author's text and replaced in place, never doubled", () => {
    const once = withLinkedSection("My description.\n", [sibling]);
    expect(once.startsWith("My description.\n\n")).toBe(true);
    expect(once).toContain("- octo/api#12: https://github.com/octo/api/pull/12");
    const other = { repo: "octo/ops", number: 3, url: "https://github.com/octo/ops/pull/3" };
    const twice = withLinkedSection(once, [sibling, other]);
    expect(twice.split(SECTION_START)).toHaveLength(2);
    expect(twice.split(SECTION_END)).toHaveLength(2);
    expect(twice).toContain("- octo/ops#3");
    expect(withLinkedSection(twice, [sibling, other])).toBe(twice);
  });

  test("goes away again when nothing may be named, leaving the author's text", () => {
    const linked = withLinkedSection("Mine.", [sibling]);
    expect(withLinkedSection(linked, [])).toBe("Mine.");
    expect(withLinkedSection("Untouched.\n", [])).toBe("Untouched.\n");
  });
});

describe("which repos a pull request may name", () => {
  const pub = page("octo/site", false);
  const pub2 = page("octo/docs", false);
  /** GitHub reports an organisation-internal repo as private too. */
  const internal = page("octo/internal-tools", true);
  const restricted = page("octo/secret-api", true);
  const all = [pub, pub2, internal, restricted];

  test("review 7: by default only public repos are named, anywhere", () => {
    expect(namable(pub, all, false)).toEqual([pub2]);
    expect(namable(internal, all, false)).toEqual([pub, pub2]);
    // A restricted repo is not named in an internal repo's pull request, nor the other way round.
    expect(namable(restricted, all, false)).toEqual([pub, pub2]);
  });

  test("with the owner's say private repos name each other, but never in a public repo's pull request", () => {
    expect(namable(pub, all, true)).toEqual([pub2]);
    expect(namable(internal, all, true)).toEqual([pub, pub2, restricted]);
    expect(namable(restricted, all, true)).toEqual([pub, pub2, internal]);
  });
});

describe("keeping the pull requests in line", () => {
  /** A linked task over web and api whose parts have pull requests 11 and 12. */
  async function linkedPulls(over: { namePrivateRepos?: boolean; webPublic?: boolean } = {}) {
    const f = officeFixture();
    const s = makeLinked(f.db);
    const created = s.linked.create(
      f.ada,
      CreateLinkedTaskRequest.parse({ ...request([WEB, API]), ...over }),
    );
    await s.queue.scheduler.idle();
    s.pages.put(repoOf(WEB), 11, {
      repo: "octo/web",
      body: "Web side.",
      isPrivate: !over.webPublic,
    });
    s.pages.put(repoOf(API), 12, { repo: "octo/api", body: "API side." });
    const [web, api] = s.spawner.calls.map((c) => c.agentId as string) as [string, string];
    return { f, ...s, id: created.id, web, api };
  }
  const WEB11 = `${repoOf(WEB)}#11`;
  const API12 = `${repoOf(API)}#12`;

  test("review 7: two private repos do not name each other unless the owner said so", async () => {
    const { linked, queue, pages, web, api } = await linkedPulls();
    queue.linkPullRequest(web, 11);
    queue.linkPullRequest(api, 12);
    await linked.idle();
    expect(pages.writes).toEqual([]);
  });

  test("a public repo is named in the private one's pull request, not the other way round", async () => {
    const { linked, queue, pages, web, api } = await linkedPulls({ webPublic: true });
    queue.linkPullRequest(web, 11);
    queue.linkPullRequest(api, 12);
    await linked.idle();
    expect(pages.writes.map((w) => w.key)).toEqual([API12]);
    expect(pages.body(repoOf(API), 12)).toContain("- octo/web#11:");
    expect(pages.body(repoOf(WEB), 11)).toBe("Web side.");
  });

  test("with the owner's say the pull requests name each other once two parts have one", async () => {
    const { linked, queue, pages, web, api } = await linkedPulls({ namePrivateRepos: true });
    queue.linkPullRequest(web, 11);
    await linked.idle();
    expect(pages.writes).toEqual([]);
    queue.linkPullRequest(api, 12);
    await linked.idle();
    expect(pages.body(repoOf(WEB), 11)).toContain(
      "- octo/api#12: https://github.com/octo/api/pull/12",
    );
    expect(pages.body(repoOf(API), 12)).toContain(
      "- octo/web#11: https://github.com/octo/web/pull/11",
    );
    expect(pages.body(repoOf(WEB), 11).startsWith("Web side.")).toBe(true);
  });

  test("one pull request that cannot be edited does not hold up the other", async () => {
    const { linked, queue, pages, web, api } = await linkedPulls({ namePrivateRepos: true });
    pages.brokenWrite.add(WEB11);
    queue.linkPullRequest(web, 11);
    queue.linkPullRequest(api, 12);
    await linked.idle();
    expect(pages.body(repoOf(API), 12)).toContain("- octo/web#11:");
    expect(pages.body(repoOf(WEB), 11)).toBe("Web side.");
  });

  test("one that cannot be read is skipped; what the others say about it stays", async () => {
    const { linked, queue, pages, pulls, id, web, api } = await linkedPulls({
      namePrivateRepos: true,
    });
    queue.linkPullRequest(web, 11);
    queue.linkPullRequest(api, 12);
    await linked.idle();
    const before = pages.body(repoOf(API), 12);
    pages.brokenRead.add(WEB11);
    pages.writes.length = 0;
    await pulls.relink(id);
    expect(pages.writes).toEqual([]);
    expect(pages.body(repoOf(API), 12)).toBe(before);
  });

  test("the section goes when fewer than two pull requests remain", async () => {
    const { f, linked, queue, pages, pulls, id, web, api } = await linkedPulls({
      namePrivateRepos: true,
    });
    queue.linkPullRequest(web, 11);
    queue.linkPullRequest(api, 12);
    await linked.idle();
    expect(pages.body(repoOf(API), 12)).toContain(SECTION_START);
    // The web part is retried: it has no pull request any more.
    f.db.update(tasks).set({ prNumber: null }).where(eq(tasks.agentId, web)).run();
    await pulls.relink(id);
    expect(pages.body(repoOf(API), 12)).toBe("API side.");
  });
});

describe("GitHub calls", () => {
  const TOKEN = "ghs_secret_token_1234567890";
  const repo = { repoId: "r1", owner: "octo", name: "web" } as RepoCheckout;
  const repos = (token: string | null) =>
    ({
      withRepoCredential: (_id: string, fn: (c: unknown) => unknown) =>
        Promise.resolve(fn({ repo, token })),
    }) as unknown as RepoAccess;

  test("reads the description and whether the repo is private; unknown counts as private", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answers = [
      {
        body: "Hi",
        html_url: "https://github.com/octo/web/pull/4",
        base: { repo: { private: false, full_name: "Octo/Web" } },
      },
      { body: null, html_url: "https://github.com/octo/web/pull/5" },
    ];
    const pages = githubPullPages({
      repos: repos(TOKEN),
      apiBase: "https://api.example",
      fetch: async (url, init) => {
        calls.push({ url, init });
        return Response.json(answers.shift());
      },
    });
    expect(await pages.read("r1", 4)).toEqual({
      body: "Hi",
      url: "https://github.com/octo/web/pull/4",
      repo: "Octo/Web",
      isPrivate: false,
    });
    expect((await pages.read("r1", 5))?.isPrivate).toBe(true);
    expect(calls[0]?.url).toBe("https://api.example/repos/octo/web/pulls/4");
    // The credential travels in the header only.
    expect(calls[0]?.url).not.toContain(TOKEN);
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  test("edits with the repo's credential, and not at all without one", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({});
    };
    await githubPullPages({ repos: repos(null), apiBase: "https://api.example", fetch }).writeBody(
      "r1",
      4,
      "new",
    );
    expect(calls).toEqual([]);
    await githubPullPages({ repos: repos(TOKEN), apiBase: "https://api.example", fetch }).writeBody(
      "r1",
      4,
      "new",
    );
    expect(calls[0]?.init.method).toBe("PATCH");
    expect(calls[0]?.init.body).toBe(JSON.stringify({ body: "new" }));
  });

  test("an error from GitHub does not carry the credential", async () => {
    const pages = githubPullPages({
      repos: repos(TOKEN),
      apiBase: "https://api.example",
      fetch: async () => Response.json({ message: `bad token ${TOKEN}` }, { status: 403 }),
    });
    const err = await pages.read("r1", 4).catch((e: unknown) => e);
    expect(String(err)).not.toContain(TOKEN);
    expect(JSON.stringify(err)).not.toContain(TOKEN);
  });
});
