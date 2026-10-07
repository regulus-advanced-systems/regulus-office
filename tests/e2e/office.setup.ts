/**
 * The office e2e's `setup` project (#248): the owner registers and picks a genius by keyboard in
 * the first-login picker (#185), mints an invite in the UI, and a second browser joins through
 * the link. Both sessions (and the owner's genius) are saved for the steps in office.e2e.ts
 * (officeSession.ts). These steps build on each other and register the owner, which works once
 * per database, so they run in order and every other office step depends on them.
 */
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { MEMBER_GITHUB, OWNER_GITHUB } from "./fakeGitHub.ts";
import { pickGenius, pickGeniusByKeyboard } from "./geniusChecks.ts";
import { linkGitHub } from "./githubAccess.ts";
import { type Account, member, owner, saveOwnerGenius, saveSessions } from "./officeSession.ts";

test.describe.configure({ mode: "serial" });

let ownerCtx: BrowserContext;
let memberCtx: BrowserContext;
let ownerPage: Page;
let memberPage: Page;
let inviteUrl = "";

test.beforeAll(async ({ browser }) => {
  ownerCtx = await browser.newContext();
  memberCtx = await browser.newContext();
  ownerPage = await ownerCtx.newPage();
  memberPage = await memberCtx.newPage();
});

test.afterAll(async () => {
  await ownerCtx?.close();
  await memberCtx?.close();
});

async function register(page: Page, who: Account, submit: string): Promise<void> {
  await page.getByLabel("Display name").fill(who.name);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByLabel("Confirm password").fill(who.password);
  await page.getByRole("button", { name: submit }).click();
  await expect(page).toHaveURL(/\/office/);
}

test("the first account becomes the owner", async () => {
  await ownerPage.goto("/login");
  await expect(ownerPage.getByRole("heading", { name: "Set up your office" })).toBeVisible();
  await register(ownerPage, owner, "Create the owner account");
  const me = await ownerPage.request.get("/api/me");
  expect(await me.json()).toMatchObject({ displayName: owner.name, role: "owner" });
});

test("the first-login genius picker works by keyboard; the server keeps the pick (#185)", async () => {
  const picked = await pickGeniusByKeyboard(ownerPage);
  saveOwnerGenius(picked);
  expect(await (await ownerPage.request.get("/api/me")).json()).toMatchObject({
    avatar: picked,
    avatarChosen: true,
  });
  // Chosen once: the picker does not come back on the next visit.
  await ownerPage.reload();
  await expect(ownerPage.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(ownerPage.getByRole("dialog", { name: "Choose your genius" })).toBeHidden();
});

test("without a linked GitHub account every room is closed; the lobby says so, and linking opens them (#270)", async () => {
  // The office owner too: the role runs the office, GitHub opens the rooms (D27).
  const prompt = ownerPage.getByTestId("github-link-prompt");
  await expect(prompt).toHaveText("Link your GitHub account to enter your rooms.");
  const section = ownerPage.getByRole("region", { name: "Link your GitHub account" });
  await expect(section.getByRole("button", { name: "Link GitHub account…" })).toBeVisible();
  const origin = new URL(ownerPage.url()).origin;
  const refused = await ownerPage.request.post("/api/operations", {
    data: { name: "Too early", repos: [{ repo: "octo/hello" }] },
    headers: { origin },
  });
  expect(refused.status()).toBe(403);
  expect(((await refused.json()) as { error: string }).error).toBe("github_link_required");

  await linkGitHub(ownerPage, OWNER_GITHUB);
  await ownerPage.reload();
  await expect(ownerPage.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(prompt).toHaveCount(0);
});

test("the owner creates an invite link in the UI", async () => {
  await ownerPage.getByRole("button", { name: "Settings" }).click();
  await ownerPage.getByRole("tab", { name: "You" }).click();
  await ownerPage.getByRole("button", { name: "Invite someone…" }).click();
  const dialog = ownerPage.getByRole("dialog", { name: "Invite someone" });
  await dialog.getByRole("button", { name: "Create invite link" }).click();
  const link = dialog.getByLabel(/Invite link for member/);
  await expect(link).toHaveValue(/\/join\/[\w-]+$/);
  inviteUrl = await link.inputValue();
  expect(new URL(inviteUrl).origin).toBe(new URL(ownerPage.url()).origin);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
});

test("a second browser joins through the invite", async () => {
  await memberPage.goto(inviteUrl);
  await expect(memberPage.getByRole("heading", { name: "You're invited" })).toBeVisible();
  await register(memberPage, member, "Create account and join");
  const me = await memberPage.request.get("/api/me");
  expect(await me.json()).toMatchObject({ displayName: member.name, role: "member" });
  await pickGenius(memberPage, "Diva");
  // The member links too; their account sees no repo until a step gives it one (#270).
  await expect(memberPage.getByTestId("github-link-prompt")).toBeVisible();
  await linkGitHub(memberPage, MEMBER_GITHUB);
  await saveSessions(ownerCtx, memberCtx);
});
