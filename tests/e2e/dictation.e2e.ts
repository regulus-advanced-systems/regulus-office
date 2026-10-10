/**
 * Dictation in the office (#260), in a real browser with a scripted speech recogniser
 * (dictationProbes.ts; a headless browser has no microphone): holding Ctrl+Space in the lobby
 * chat first says where the audio goes and records nothing, then listens with a clear
 * indicator, types what was said and sends nothing; the key is left alone where there is
 * nothing to dictate into and on the whiteboard; a controlled React field (search) takes the
 * words too; a browser without on-device recognition records nothing until the person picks
 * its online service from the notice that names who gets the audio; Settings turns it off.
 *
 * Its own spec with its own browser (officeSession.ts), after the setup project. With
 * `E2E_SHOTS_DIR` set it saves the screenshots for the PR.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  forgetDictationChoices,
  hear,
  holdKey,
  installFakeSpeech,
  releaseKey,
  say,
  speech,
} from "./dictationProbes.ts";
import { type OfficeSession, openOffice } from "./officeSession.ts";
import { OFFICE_PROBE_PATH, waitForScene } from "./probes.ts";
import { openLobbyBoard } from "./whiteboardChecks.ts";

let session: OfficeSession;
let page: Page;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  session = await openOffice(browser);
  page = session.ownerPage;
  await session.memberCtx.close();
});

test.afterAll(async () => {
  await session?.ownerCtx.close();
});

/** A first visit: no dictation choices made, the office open, nothing focused. */
test.beforeEach(async () => {
  await page.bringToFront();
  await forgetDictationChoices(page);
  await page.goto(OFFICE_PROBE_PATH);
  await waitForScene(page);
});

async function shot(name: string): Promise<void> {
  const dir = process.env.E2E_SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

const pill = () => page.getByTestId("dictation-pill");
const indicator = () => page.getByTestId("dictation-indicator");
const notice = () => page.getByTestId("dictation-notice");
const chat = () => page.getByTestId("chat-input");
const ownLines = () => page.getByTestId("chat-log").locator("li.rg-chat__line--own");

test("hold Ctrl+Space in the chat: told where the audio goes, then listening, typed, not sent (#260)", async () => {
  await installFakeSpeech(page, "available");
  const sentBefore = await ownLines().count();

  // Nothing that takes text has focus: the key is not dictation's.
  await holdKey(page);
  await page.waitForTimeout(300);
  await releaseKey(page);
  await expect(pill()).toBeHidden();
  await expect(notice()).toBeHidden();
  expect((await speech(page)).made).toBe(0);

  // T focuses the chat; the mic button stands by it.
  await page.keyboard.press("t");
  await expect(chat()).toBeFocused();
  await expect(page.getByTestId("dictation-mic")).toBeVisible();
  await shot("01-mic-button-by-the-chat");

  // The first hold ever records nothing: it says where the audio goes.
  await holdKey(page);
  await expect(notice()).toHaveAttribute("data-kind", "intro");
  await expect(notice()).toContainText("No audio is sent to the office or to anyone else");
  await expect(indicator()).toBeHidden();
  expect((await speech(page)).made).toBe(0);
  await releaseKey(page);
  await shot("02-first-use-where-the-audio-goes");
  await page.getByTestId("dictation-intro-ok").click();
  await expect(notice()).toBeHidden();
  await expect(chat()).toBeFocused();

  // Held: on-device recognition, a clear indicator, the phrase in progress shown.
  await holdKey(page);
  await expect(pill()).toHaveAttribute("data-phase", "listening");
  await expect(indicator()).toContainText("Listening");
  const started = await speech(page);
  expect(started.starts).toHaveLength(1);
  expect(started.starts[0]?.processLocally).toBe(true);
  await hear(page, "send two henchmen");
  await expect(page.getByTestId("dictation-interim")).toHaveText("send two henchmen");
  await shot("03-listening");
  await say(page, "send two henchmen to the lab\n");
  await expect(chat()).toHaveValue("send two henchmen to the lab");
  await say(page, "and report back");
  await expect(chat()).toHaveValue("send two henchmen to the lab and report back");

  // Let go: the microphone closes, the indicator goes, and nothing was sent.
  await releaseKey(page);
  await expect(indicator()).toBeHidden();
  const stopped = await speech(page);
  expect(stopped.stops).toBe(1);
  expect(stopped.live).toBe(false);
  await expect(chat()).toHaveValue("send two henchmen to the lab and report back");
  await expect(chat()).toBeFocused();
  expect(await ownLines().count()).toBe(sentBefore);
  await shot("04-typed-not-sent");

  // The keys are the box's own again: Space types a space.
  await page.keyboard.type(" now");
  await expect(chat()).toHaveValue("send two henchmen to the lab and report back now");

  // Ctrl released first: stops at once, and the still-held Space types nothing.
  await page.keyboard.down("Control");
  await page.keyboard.down("Space");
  await expect(indicator()).toBeVisible();
  await page.keyboard.up("Control");
  await expect(indicator()).toBeHidden();
  await page.keyboard.up("Space");
  await expect(chat()).toHaveValue("send two henchmen to the lab and report back now");
  expect((await speech(page)).live).toBe(false);

  // The mic button, held with the mouse, does the same and keeps the focus in the box.
  const mic = await page.getByTestId("dictation-mic").boundingBox();
  if (!mic) throw new Error("no mic button");
  await page.mouse.move(mic.x + mic.width / 2, mic.y + mic.height / 2);
  await page.mouse.down();
  await expect(pill()).toHaveAttribute("data-phase", "listening");
  await say(page, "please");
  await page.mouse.up();
  await expect(indicator()).toBeHidden();
  await expect(chat()).toBeFocused();
  await expect(chat()).toHaveValue("send two henchmen to the lab and report back now please");
  await chat().fill("");

  // The shortcut is in the help.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Help" }).click();
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toContainText(
    "Ctrl+Space",
  );
  await page.keyboard.press("Escape");
});

test("dictation into a field React controls, and none on the whiteboard (#260)", async () => {
  test.setTimeout(180_000);
  await installFakeSpeech(page, "available");
  await page.evaluate(() =>
    localStorage.setItem("regulus.dictation.v1", JSON.stringify({ introSeen: true })),
  );
  await page.goto(OFFICE_PROBE_PATH);
  await waitForScene(page);
  await installFakeSpeech(page, "available");

  // Search is a dialog with a controlled input: the words must reach React's state.
  await page.keyboard.press("/");
  const search = page.getByTestId("search-input");
  await expect(search).toBeFocused();
  await holdKey(page);
  await expect(pill()).toHaveAttribute("data-phase", "listening");
  await say(page, "zzqx nothing says this");
  await releaseKey(page);
  await expect(indicator()).toBeHidden();
  await expect(search).toHaveValue("zzqx nothing says this");
  // The search ran on the dictated words (React heard the change), and kept them.
  await expect(page.getByTestId("search-status")).toHaveText("No matches you can see.");
  await expect(search).toHaveValue("zzqx nothing says this");
  await page.keyboard.press("Escape");

  // The whiteboard's text tool: Ctrl+Space stays the whiteboard's.
  const made = (await speech(page)).made;
  await openLobbyBoard(page);
  const dialog = page.getByRole("dialog", { name: "Whiteboard: Lobby" });
  await dialog.locator("label", { has: page.getByTestId("toolbar-text") }).click();
  const area = await dialog.locator(".rg-whiteboard__body").boundingBox();
  if (!area) throw new Error("no board area");
  await page.mouse.click(area.x + area.width * 0.4, area.y + area.height * 0.5);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.activeElement;
        return el?.tagName === "TEXTAREA" && el.closest(".rg-whiteboard") !== null;
      }),
    )
    .toBe(true);
  await expect(page.getByTestId("dictation-mic")).toBeHidden();
  await holdKey(page);
  await page.waitForTimeout(300);
  await releaseKey(page);
  await expect(pill()).toBeHidden();
  expect((await speech(page)).made).toBe(made);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Close whiteboard" }).click();
  await expect(dialog).toBeHidden();
});

test("no on-device recognition: nothing recorded until the person picks the online service; Settings turns dictation off (#260)", async () => {
  // Web Speech as most browsers have it today: no on-device API.
  await installFakeSpeech(page, null);
  await page.keyboard.press("t");
  await expect(chat()).toBeFocused();

  await holdKey(page);
  await expect(notice()).toHaveAttribute("data-kind", "local-unavailable");
  await expect(notice()).toContainText("sent to the company that makes your browser");
  await releaseKey(page);
  expect((await speech(page)).made).toBe(0);
  await shot("05-online-service-is-the-persons-choice");

  // Declined: the next hold still records nothing.
  await notice().getByRole("button", { name: "Not now" }).click();
  await holdKey(page);
  await expect(notice()).toHaveAttribute("data-kind", "local-unavailable");
  await releaseKey(page);
  expect((await speech(page)).made).toBe(0);

  // Chosen: the browser's online service runs, without the on-device flag.
  await page.getByTestId("dictation-use-vendor").click();
  await expect(notice()).toBeHidden();
  await holdKey(page);
  await expect(pill()).toHaveAttribute("data-phase", "listening");
  expect((await speech(page)).starts).toEqual([{ lang: expect.any(String), processLocally: null }]);
  await say(page, "hello");
  await releaseKey(page);
  await expect(chat()).toHaveValue("hello");
  await chat().fill("");

  // Settings says where the audio goes for both, and remembers the choice.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("tab", { name: "Display and sound" }).click();
  const engines = settings.getByTestId("dictation-engines");
  await engines.scrollIntoViewIfNeeded();
  await expect(engines.getByRole("radio", { name: /online service/ })).toBeChecked();
  await expect(engines).toContainText("No audio is sent to the office or to anyone else");
  await shot("06-settings");
  await engines.getByRole("radio", { name: /On this computer/ }).check();

  // Off: no mic button, and the key is the chat's again.
  await settings.getByRole("switch", { name: /Dictation/ }).click();
  await settings.getByRole("button", { name: "Done" }).click();
  await page.keyboard.press("t");
  await expect(chat()).toBeFocused();
  await expect(page.getByTestId("dictation-mic")).toBeHidden();
  const made = (await speech(page)).made;
  await holdKey(page);
  await page.waitForTimeout(300);
  await releaseKey(page);
  await expect(pill()).toBeHidden();
  await expect(notice()).toBeHidden();
  expect((await speech(page)).made).toBe(made);
});
