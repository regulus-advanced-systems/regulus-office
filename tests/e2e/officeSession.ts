/**
 * The two signed-in browsers the office e2e shares (#248). `office.setup.ts` (the `setup`
 * project) registers the owner and the member once per run and saves their sessions here;
 * every step in `office.e2e.ts` then runs in browsers opened from those sessions, so a step
 * that fails costs a fresh pair of pages (Playwright restarts the worker), not the steps after it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { walkToLobby } from "./compoundProbes.ts";
import type { GeniusLook } from "./geniusChecks.ts";
import { OFFICE_PROBE_PATH, waitForScene } from "./probes.ts";

/** One id per run; the config sets E2E_RUN_ID before the setup and the steps' workers start. */
const run = (process.env.E2E_RUN_ID ?? Date.now().toString(36)).replace(/\W/g, "");

export interface Account {
  name: string;
  email: string;
  password: string;
}

export const owner: Account = {
  name: "Ada Owner",
  email: `owner-${run}@example.com`,
  password: `owner-pw-${run}`,
};
export const member: Account = {
  name: "Ben Member",
  email: `member-${run}@example.com`,
  password: `member-pw-${run}`,
};

/** Next to the server's throwaway data (removed by the global teardown), else in test-results. */
const AUTH_DIR = process.env.E2E_DATA_DIR
  ? join(process.env.E2E_DATA_DIR, "e2e-auth")
  : join("test-results", ".auth");
const statePath = (who: "owner" | "member") => join(AUTH_DIR, `${who}.json`);
/** The owner's saved session, for a spec that launches a browser of its own (#260). */
export const ownerStatePath = (): string => statePath("owner");
const geniusPath = join(AUTH_DIR, "owner-genius.json");

/** Save both sessions (cookies and local storage) for the steps' browsers. */
export async function saveSessions(ownerCtx: BrowserContext, memberCtx: BrowserContext) {
  mkdirSync(AUTH_DIR, { recursive: true });
  await ownerCtx.storageState({ path: statePath("owner") });
  await memberCtx.storageState({ path: statePath("member") });
}

/** The owner's genius as picked at first login (#185). */
export function saveOwnerGenius(look: GeniusLook): void {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(geniusPath, JSON.stringify(look));
}

export function loadOwnerGenius(): GeniusLook {
  return JSON.parse(readFileSync(geniusPath, "utf8")) as GeniusLook;
}

export interface OfficeSession {
  ownerCtx: BrowserContext;
  memberCtx: BrowserContext;
  ownerPage: Page;
  memberPage: Page;
}

/** Open the office for both saved sessions and wait until both scenes draw. */
export async function openOffice(browser: Browser): Promise<OfficeSession> {
  const ownerCtx = await browser.newContext({ storageState: statePath("owner") });
  const memberCtx = await browser.newContext({ storageState: statePath("member") });
  const ownerPage = await ownerCtx.newPage();
  const memberPage = await memberCtx.newPage();
  await ownerPage.goto(OFFICE_PROBE_PATH);
  await memberPage.goto(OFFICE_PROBE_PATH);
  await waitForScene(ownerPage);
  await waitForScene(memberPage);
  // People come back where they left (#262), so after a failed step these new pages open
  // wherever that step left them. Every step starts from the lobby, as before.
  await walkToLobby(ownerPage);
  await walkToLobby(memberPage);
  // A first gesture, as a person's first click: the browser lets a page play sound only after
  // one (audio/context.ts), and the jukebox step must not depend on earlier steps' typing.
  for (const page of [memberPage, ownerPage]) {
    await page.bringToFront();
    await page.getByRole("navigation", { name: "Rooms" }).getByRole("heading").click();
  }
  return { ownerCtx, memberCtx, ownerPage, memberPage };
}
