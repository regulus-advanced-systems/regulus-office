/**
 * Dictation against the browser's real on-device speech API (#260), not the scripted stand-in:
 * the privacy claim ("no audio leaves the computer") rests on `SpeechRecognition.processLocally`,
 * `SpeechRecognition.available()` and `SpeechRecognition.install()` being what the page thinks
 * they are, so a wrong name, argument shape or return value must fail here.
 *
 * - The contract: the attribute and the static methods exist under those names;
 *   `available({ langs, processLocally })` resolves to one of the four AvailabilityStatus values;
 *   `langs` is required; and where the language pack is not installed, a start with
 *   `processLocally = true` fires an error ("language-not-supported" in Chromium,
 *   "service-not-allowed" in the spec) and never starts: no fallback to the online service.
 * - The page's own engine on the real object: holding Ctrl+Space in the chat asks the real
 *   `available()` and shows the notice that answer calls for, and no recogniser is started.
 *
 * It launches the full Chromium build in headless mode (`channel: "chromium"`, installed by
 * `playwright install chromium`): in the headless shell the other specs use, the on-device
 * service is missing and `available({ processLocally: true })` crashes the renderer (seen with
 * Chromium 153). No microphone is opened and no language pack is downloaded: this does not
 * replace a person dictating once in Chrome or Edge.
 */
import { type Browser, chromium, expect, type Page, test } from "@playwright/test";
import { holdKey, releaseKey } from "./dictationProbes.ts";
import { ownerStatePath } from "./officeSession.ts";
import { OFFICE_PROBE_PATH, waitForScene } from "./probes.ts";

const STATUSES = ["unavailable", "downloadable", "downloading", "available"];
/** What the page shows for each answer of `available()` on a first use. */
const NOTICE: Readonly<Record<string, string>> = {
  unavailable: "local-unavailable",
  downloadable: "download",
  downloading: "downloading",
  available: "intro",
};

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch({
    channel: "chromium",
    // As playwright.config.ts: the scene on the GPU when asked, else in software.
    args:
      process.env.E2E_WEBGL === "hardware"
        ? ["--use-angle=gl-egl", "--enable-gpu", "--ignore-gpu-blocklist"]
        : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
});

test.afterAll(async () => {
  await browser?.close();
});

const localStatus = (page: Page, lang: string) =>
  page.evaluate(
    (l) =>
      (
        window as unknown as {
          SpeechRecognition: { available(o: object): Promise<string> };
        }
      ).SpeechRecognition.available({ langs: [l], processLocally: true }),
    lang,
  );

test("the browser's on-device speech API is what the dictation engine expects (#260)", async ({
  baseURL,
}) => {
  const page = await browser.newPage({ baseURL });
  // Any page of the office: the API needs a secure context (loopback or https).
  await page.goto("/login");
  const shape = await page.evaluate(() => {
    type Ctor = {
      new (): { processLocally: boolean };
      prototype: object;
      available?: unknown;
      install?: unknown;
    };
    const C = (window as unknown as { SpeechRecognition?: Ctor }).SpeechRecognition;
    if (!C) return null;
    const rec = new C();
    const initial = rec.processLocally;
    rec.processLocally = true;
    return {
      secure: window.isSecureContext,
      attribute: "processLocally" in C.prototype,
      available: typeof C.available,
      install: typeof C.install,
      initial,
      set: rec.processLocally,
    };
  });
  expect(shape, `Chromium ${browser.version()} has no SpeechRecognition`).toEqual({
    secure: true,
    attribute: true,
    available: "function",
    install: "function",
    initial: false,
    set: true,
  });

  const answers = await page.evaluate(async () => {
    const C = (
      window as unknown as { SpeechRecognition: { available(o: object): Promise<string> } }
    ).SpeechRecognition;
    const lang = navigator.language;
    return {
      lang,
      local: await C.available({ langs: [lang], processLocally: true }),
      either: await C.available({ langs: [lang], processLocally: false }),
      noLangs: await C.available({ processLocally: true }).then(
        (v) => `resolved ${v}`,
        (e: Error) => e.name,
      ),
    };
  });
  expect(STATUSES).toContain(answers.local);
  expect(STATUSES).toContain(answers.either);
  expect(answers.noLangs).toBe("TypeError");

  // Without the language pack, a start that must be local fails and never listens.
  test.info().annotations.push({
    type: "on-device speech",
    description: `Chromium ${browser.version()}: ${answers.lang} is "${answers.local}"`,
  });
  if (answers.local !== "available") {
    const events = await page.evaluate(
      (lang) =>
        new Promise<string[]>((resolve) => {
          type Rec = {
            lang: string;
            processLocally: boolean;
            onstart: (() => void) | null;
            onerror: ((e: { error: string }) => void) | null;
            start(): void;
            abort(): void;
          };
          const rec = new (
            window as unknown as { SpeechRecognition: new () => Rec }
          ).SpeechRecognition();
          rec.lang = lang;
          rec.processLocally = true;
          const seen: string[] = [];
          const done = () => {
            rec.abort();
            resolve(seen);
          };
          rec.onstart = () => {
            seen.push("start");
            done();
          };
          rec.onerror = (e) => {
            seen.push(`error:${e.error}`);
            // A moment more: a `start` after the error would be a fallback.
            setTimeout(done, 1500);
          };
          setTimeout(done, 10_000);
          rec.start();
        }),
      answers.lang,
    );
    expect(events).toHaveLength(1);
    expect(["error:language-not-supported", "error:service-not-allowed"]).toContain(events[0]);
  }
  await page.close();
});

test("the page's engine asks the real API and starts nothing it may not (#260)", async ({
  baseURL,
}) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({
    baseURL,
    storageState: ownerStatePath(),
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto(OFFICE_PROBE_PATH);
  await page.evaluate(() => localStorage.removeItem("regulus.dictation.v1"));
  await page.goto(OFFICE_PROBE_PATH);
  await waitForScene(page);
  // Count real starts: none may happen on a first use, whatever the browser answers.
  await page.evaluate(() => {
    const w = window as unknown as {
      SpeechRecognition: { prototype: { start(): void } };
      __realStarts: number;
    };
    w.__realStarts = 0;
    const start = w.SpeechRecognition.prototype.start;
    w.SpeechRecognition.prototype.start = function (this: unknown) {
      w.__realStarts += 1;
      return start.call(this);
    };
  });
  const status = await localStatus(page, await page.evaluate(() => navigator.language));
  expect(STATUSES).toContain(status);

  await page.getByRole("navigation", { name: "Rooms" }).getByRole("heading").click();
  await page.keyboard.press("t");
  await expect(page.getByTestId("chat-input")).toBeFocused();
  await holdKey(page);
  await expect(page.getByTestId("dictation-notice")).toHaveAttribute(
    "data-kind",
    NOTICE[status] ?? "",
  );
  await releaseKey(page);
  await expect(page.getByTestId("dictation-indicator")).toBeHidden();
  expect(
    await page.evaluate(() => (window as unknown as { __realStarts: number }).__realStarts),
  ).toBe(0);
  await context.close();
});
