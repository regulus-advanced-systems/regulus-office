/**
 * GitHub access in the e2e (#270; SPEC D27). A room opens with a person's own GitHub access
 * to its repo, so the e2e people link accounts on the fake GitHub (fakeGitHub.ts) through
 * the office's real linking flow, and tests change what those accounts can see the way an
 * org admin would on GitHub. Nothing in the office is switched off for the tests.
 */
import { expect, type Page } from "@playwright/test";

/**
 * Link the page's person to the fake GitHub account `login`: the office's own "start" call,
 * GitHub's authorise page (the fake has no consent screen: `login` says who pressed
 * Authorize), and the office's callback, all with the page's session.
 */
export async function linkGitHub(page: Page, login: string): Promise<void> {
  const origin = new URL(page.url()).origin;
  const start = await page.request.post("/api/github/link/start", { headers: { origin } });
  expect(start.status(), await start.text()).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const back = await page.request.get(`${url}&login=${encodeURIComponent(login)}`);
  expect(back.url(), "the office did not accept the link").toContain("github_link=linked");
  const link = (await (await page.request.get("/api/github/link")).json()) as {
    state: string;
    login: string;
  };
  expect(link).toMatchObject({ state: "linked", login });
}

/** What an org admin does on GitHub: give or take a person's permission on a repo. */
export async function setRepoPermission(
  githubUrl: string,
  login: string,
  repo: string,
  permission: "none" | "read" | "write" | "admin",
): Promise<void> {
  const res = await fetch(`${githubUrl}/__e2e/permission`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login, repo, permission }),
  });
  expect(res.status).toBe(200);
}

/** "Check now" in Settings → You: the office asks GitHub again for this person (at most every 5 s). */
export async function checkGitHubNow(page: Page): Promise<void> {
  const origin = new URL(page.url()).origin;
  await expect
    .poll(
      async () =>
        (await page.request.post("/api/github/link/check", { headers: { origin } })).status(),
      { timeout: 20_000, intervals: [500, 1000, 2000] },
    )
    .toBe(200);
}

/** The fake GitHub the office e2e runs beside the office (playwright.config.ts). */
export const officeGitHubUrl = () => `http://127.0.0.1:${process.env.E2E_GITHUB_PORT}`;

/**
 * Load an org connection and board data into the office flow's fake GitHub for one step;
 * `close()` takes them out again.
 */
export async function loadBoards(
  org: unknown,
  boards: unknown,
): Promise<{ close(): Promise<void> }> {
  const load = async (body: unknown) => {
    const res = await fetch(`${officeGitHubUrl()}/__e2e/boards`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
  };
  await load({ org, boards });
  return { close: () => load({}) };
}
