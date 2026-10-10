/**
 * The room's bookshelf in the office e2e (#264). The room's repo gets docs pushed to it, one
 * of them hostile (raw HTML with script, a `javascript:` link, a remote picture, a symlink
 * out of the repo). Then:
 *
 * - the member, whose GitHub account cannot see the repo, gets the same 404 for the room's
 *   shelf as for a room that does not exist; with read access on GitHub they get the shelf;
 * - the owner walks in, clicks the shelf, and the reader opens on the README the office
 *   fetched into its mirror; the hostile document renders as text, nothing in it runs, its
 *   picture from the repo loads through the office, and the browser asks no other host for
 *   anything; a link between documents and Back stay in the reader; the box finds a line;
 * - `E` in front of the shelf opens the reader, but not while the chat field is typed into.
 *
 * With `E2E_SHOTS_DIR` set it also saves the screenshots for the PR.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import {
  clickInScene,
  navPose,
  roomNamed,
  waitStill,
  walkInto,
  walkTo,
  walkToLobby,
} from "./compoundProbes.ts";
import { MEMBER_GITHUB } from "./fakeGitHub.ts";
import { checkGitHubNow, officeGitHubUrl, setRepoPermission } from "./githubAccess.ts";
import { sunsetPng } from "./pictureChecks.ts";

const GUIDE = `# Guide

A needle264 in the text. Back to [the README](../README.md), on to [a heading](#the-table),
out to [the web](https://example.com/docs), and to [a file that is not a doc](../src/main.ts).

![a sunset from the repo](img/sunset.png)

![a tracker](https://evil.example/pixel.png)

<script>window.__pwned264 = "script"</script>

<img src="x" onerror="window.__pwned264 = 'onerror'">

[run this](javascript:window.__pwned264='link') and [this](data:text/html,<script>parent.__pwned264=1</script>)

## The table

| Decision | Choice |
|---|:--:|
| D1 | **MIT** |
| D17 | one \\| mirror |
`;

const gitEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: tmpdir(),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
const git = (args: string[], cwd?: string) =>
  execFileSync("git", ["-c", "user.name=E2E", "-c", "user.email=e2e@example.com", ...args], {
    cwd,
    env: gitEnv,
    stdio: "pipe",
  }).toString();

/** Push the docs to the bare remote the office mirrors, unless a run before this one did. */
function pushDocs(dataDir: string, owner: string, name: string): void {
  const bare = join(dataDir, "remotes", owner, `${name}.git`);
  if (git(["--git-dir", bare, "ls-tree", "-r", "--name-only", "HEAD"]).includes("docs/guide.md"))
    return;
  const work = mkdtempSync(join(dataDir, "bookshelf-work-"));
  git(["clone", "--quiet", bare, work]);
  mkdirSync(join(work, "docs", "img"), { recursive: true });
  writeFileSync(join(work, "docs", "guide.md"), GUIDE);
  writeFileSync(join(work, "docs", "img", "sunset.png"), sunsetPng());
  symlinkSync("/etc/passwd", join(work, "docs", "passwd.md"));
  git(["add", "-A"], work);
  git(["commit", "--quiet", "-m", "docs for the bookshelf"], work);
  git(["push", "--quiet", "origin", "HEAD"], work);
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(dir, `${name}.jpg`), quality: 84, type: "jpeg" });
}

/** Where the shelf stands, compound metres. */
const shelfPlace = (page: Page): Promise<{ x: number; z: number } | null> =>
  page.evaluate(() => {
    type V = { x: number; z: number; clone(): V };
    type Obj = { position: V; getWorldPosition(v: V): V };
    const r3f = (
      window as unknown as {
        __regulusR3F?: { scene: { getObjectByName(n: string): Obj | undefined } };
      }
    ).__regulusR3F;
    const shelf = r3f?.scene.getObjectByName("docs-shelf");
    if (!shelf) return null;
    const at = shelf.getWorldPosition(shelf.position.clone());
    return { x: at.x, z: at.z };
  });

export async function checkBookshelf(owner: Page, member: Page, operation: string, repo: string) {
  const [repoOwner = "", repoName = ""] = repo.split("/");
  pushDocs(process.env.E2E_DATA_DIR ?? "", repoOwner, repoName);
  const room = await roomNamed(owner, operation);
  const shelfUrl = (id: string, rest = "") => `/api/operations/${id}/docs${rest}`;

  // Access: the member's own GitHub decides, and a closed room answers as a missing one.
  await walkToLobby(member);
  await setRepoPermission(officeGitHubUrl(), MEMBER_GITHUB, repo, "none");
  await checkGitHubNow(member);
  for (const rest of [
    "",
    "/file?path=README.md",
    "/image?path=docs/img/sunset.png",
    "/search?q=needle264",
  ]) {
    const closed = await member.request.get(shelfUrl(room.id, rest));
    const missing = await member.request.get(shelfUrl("no-such-room", rest));
    expect([rest, closed.status(), await closed.text()]).toEqual([
      rest,
      404,
      '{"error":"not_found"}',
    ]);
    expect([missing.status(), await missing.text()]).toEqual([404, '{"error":"not_found"}']);
  }
  await setRepoPermission(officeGitHubUrl(), MEMBER_GITHUB, repo, "read");
  await checkGitHubNow(member);
  const open = await member.request.get(shelfUrl(room.id));
  expect(open.status()).toBe(200);
  const listed = ((await open.json()) as { docs: { path: string }[] }).docs.map((d) => d.path);
  expect(listed).toEqual(["README.md", "docs/guide.md"]);
  // The symlink in the repo is not a document, and its path opens nothing.
  expect((await member.request.get(shelfUrl(room.id, "/file?path=docs/passwd.md"))).status()).toBe(
    404,
  );
  expect(
    (await member.request.get(shelfUrl(room.id, "/file?path=../../etc/passwd"))).status(),
  ).toBe(400);
  await setRepoPermission(officeGitHubUrl(), MEMBER_GITHUB, repo, "none");
  await checkGitHubNow(member);
  expect((await member.request.get(shelfUrl(room.id))).status()).toBe(404);

  // The owner reads at the shelf. From here on every request the page makes is noted.
  await owner.bringToFront();
  await walkInto(owner, operation);
  const requests: string[] = [];
  const onRequest = (request: { url(): string }) => requests.push(request.url());
  owner.on("request", onRequest);
  const reader = owner.getByRole("dialog", { name: /^Bookshelf/ });
  await clickInScene(owner, "docs-shelf-hotspot", reader);
  await expect(reader.getByRole("heading", { name: `Bookshelf: ${repo}` })).toBeVisible();
  await expect(reader.locator(".rg-doc h1")).toHaveText(repoName);
  await expect(reader.locator('[aria-current="page"]')).toHaveText("README.md");
  await shot(owner, "02-reader-readme");

  await reader.getByRole("button", { name: "guide.md" }).click();
  await expect(reader.locator(".rg-doc h1")).toHaveText("Guide");
  // The repo's picture came through the office and drew; the remote one was never asked for.
  const picture = reader.locator("img.rg-doc__image");
  await expect(picture).toHaveCount(1);
  await expect(picture).toHaveAttribute(
    "src",
    /^\/api\/operations\/[^/]+\/docs\/image\?path=docs%2Fimg%2Fsunset\.png$/,
  );
  await expect
    .poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  // Raw HTML is text; nothing the document carries ran or became an element.
  await expect(reader.locator(".rg-doc")).toContainText(
    '<script>window.__pwned264 = "script"</script>',
  );
  await expect(reader.locator(".rg-doc :is(script, iframe, style, form)")).toHaveCount(0);
  await expect(reader.locator(".rg-doc table td").first()).toHaveText("D1");
  await expect(reader.locator(".rg-doc table")).toContainText("one | mirror");
  for (const label of ["run this", "this"])
    await expect(reader.locator(".rg-doc a", { hasText: new RegExp(`^${label}$`) })).toHaveCount(0);
  const web = reader.getByRole("link", { name: "the web" });
  await expect(web).toHaveAttribute("href", "https://example.com/docs");
  await expect(web).toHaveAttribute("target", "_blank");
  await expect(web).toHaveAttribute("rel", /noopener noreferrer/);
  await expect(reader.getByRole("link", { name: "a file that is not a doc" })).toHaveCount(0);
  await shot(owner, "03-reader-hostile-document");

  // A link between documents stays in the reader, and Back returns.
  await reader.getByRole("link", { name: "the README" }).click();
  await expect(reader.locator(".rg-doc h1")).toHaveText(repoName);
  await reader.getByRole("button", { name: "Back" }).click();
  await expect(reader.locator(".rg-doc h1")).toHaveText("Guide");

  // The box finds file names at once and lines of text after a moment.
  await reader.getByLabel("Find on the shelf").fill("needle264");
  const hit = reader.locator(".rg-shelf__hit");
  await expect(hit).toHaveCount(1);
  await expect(hit).toContainText("docs/guide.md:3");
  await shot(owner, "04-reader-search");
  await hit.click();
  await expect(reader.locator(".rg-doc h1")).toHaveText("Guide");

  expect(
    await owner.evaluate(() => (window as { __pwned264?: unknown }).__pwned264),
  ).toBeUndefined();
  owner.off("request", onRequest);
  const origin = new URL(owner.url()).origin;
  const elsewhere = requests.filter((url) => /^https?:/.test(url) && !url.startsWith(`${origin}/`));
  expect(elsewhere, "the reader made the browser call another host").toEqual([]);
  expect(requests.some((url) => url.includes("/docs/image?path="))).toBe(true);

  await owner.keyboard.press("Escape");
  await expect(reader).toBeHidden();

  // E in front of the shelf opens it; E typed into the chat field is a letter.
  const place = await shelfPlace(owner);
  expect(place, "the room has no docs shelf").not.toBeNull();
  if (!place) return;
  if (await walkTo(owner, place.x, place.z)) await waitStill(owner);
  expect((await navPose(owner)).walking).toBe(false);
  await shot(owner, "01-shelf-in-reach");
  await owner.keyboard.press("t");
  const chat = owner.locator(".rg-chat__input");
  await expect(chat).toBeFocused();
  await owner.keyboard.type("eee");
  await expect(chat).toHaveValue("eee");
  await expect(reader).toBeHidden();
  await chat.fill("");
  await chat.evaluate((el: HTMLElement) => el.blur());
  await owner.keyboard.press("e");
  await expect(reader).toBeVisible();
  await owner.keyboard.press("Escape");
  await expect(reader).toBeHidden();
}
