/**
 * M0 smoke test (docs/SPEC.md §10 M0 exit criteria). The `setup` project (office.setup.ts)
 * registers the owner, who picks a genius by keyboard (#185) and mints an invite in the UI, and a
 * second browser joins through the link. Here both reach /office and see each other's genius (and
 * a genius changed in Settings at once), one walks and the other sees it move,
 * chat crosses between them and `/` search finds it (#41), a chat line floats as a bubble, an emote
 * from the wheel, sitting on the sofa and "Who's where" reach the other browser (#49),
 * both draw on the lobby whiteboard and the wall shows it (#45),
 * the first-person view toggles on V and back,
 * the owner turns to follow the mouse and walks face-first to a click,
 * the owner adds an operation bound to a (local) repo and rides to it, Operation
 * settings and Add operation fit a 1280×720 window with the round X in view
 * (#149), clicking a free desk there opens the spawn dialog, whose agent.spawn gets
 * an answer from the server (no agent CLI runs in e2e), and a second operation
 * is archived, restored and deleted for good, files included (#150). Last, with a (fake) org
 * token connected, the issue board fills from GitHub, a card is opened and carried to a free
 * desk, and the spawn dialog opens prefilled from it (#36). And merging a PR on the PR board
 * rings the merge gong, with confetti and any henchmen cheering and sitting back as they were;
 * the gong can be banged by hand, rate-limited (#43). Then the owner presses the lobby's
 * blast door button: it opens for the member's browser too, the owner walks out onto the dock,
 * the door shuts by itself after the (shortened) open time and the beach is cut off again (#188).
 * Last, both walk up to the lobby jukebox, the owner queues a track and both browsers play it
 * at the same playhead within a tolerance (#47). Then the owner hangs a picture uploaded from
 * the PC on a free wall of Apollo, the member (given view access) sees it without a reload,
 * and the owner removes it again (#46). Last, the owner takes that access away while the member
 * stands in Apollo: the member reads a plain message and the browser does not retry (#244).
 *
 * Structure (#248): the steps run in order in one worker and share two browsers opened from the
 * sessions the setup saved (officeSession.ts), but they are not serial: a failed step does not
 * skip the ones after it. Playwright then restarts the worker, and `beforeAll` opens the office
 * again for both sessions (a fresh pair of pages, both in the lobby). So each step stands on the
 * shared setup alone: a step that needs what an earlier step made (the Apollo operation) makes
 * sure of it itself (`ensureApollo`), and a step starts by going where it needs to be (or the
 * step before leaves people where it found them). To add a step, add a `test()` at the end (or
 * where it fits) that calls its `xxxChecks.ts` function with `ownerPage` and `memberPage`; give it
 * `test.setTimeout` if it needs more than 90 s. A new spec file that needs the two signed-in
 * browsers opens them with `openOffice` in its own `beforeAll` (and runs after the setup, too).
 *
 * Runs against office-server in production mode (see playwright.config.ts),
 * so room joins are authorised by the Better Auth session cookie only.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { checkAccessWithdrawn } from "./accessChecks.ts";
import { checkAgentForm } from "./agentFormChecks.ts";
import { checkAgentMind } from "./agentMindChecks.ts";
import { checkBlastDoor } from "./blastDoorChecks.ts";
import { checkBoardLayout } from "./boardLayoutChecks.ts";
import { checkBookshelf } from "./bookshelfChecks.ts";
import {
  addDeskInRoomSettings,
  aimAt,
  buildProbe,
  ensureOperation,
  middleOf,
  openBuildMode,
  settledVerdict,
} from "./buildChecks.ts";
import { checkCoffee } from "./coffeeChecks.ts";
import {
  cameraSettled,
  cameraState,
  clickInScene,
  goToLevelOf,
  goToLobbyLevel,
  navPose,
  navRooms,
  roomNamed,
  travelButton,
  travelInto,
  walkInto,
  walkToLobby,
  wheelZoomTo,
} from "./compoundProbes.ts";
import { insideViewport, settledDialogLayout } from "./dialogLayout.ts";
import { checkFirstPersonWindow } from "./fpvWindowChecks.ts";
import { type GeniusLook, geniusOf } from "./geniusChecks.ts";
import { loadBoards } from "./githubAccess.ts";
import { ensureRemoteRepo } from "./gitRemote.ts";
import { checkMergeGong } from "./gongChecks.ts";
import { checkHermesConnection } from "./hermesChecks.ts";
import { checkJukebox } from "./jukeboxChecks.ts";
import { checkLift, checkOpenAndClosedRooms } from "./liftChecks.ts";
import { checkLinkedTask } from "./linkedTaskChecks.ts";
import { checkAgentsInTheWorld } from "./officeAgentWorldChecks.ts";
import { loadOwnerGenius, type OfficeSession, openOffice, owner } from "./officeSession.ts";
import { checkCommandPalette, checkWhiteboardKeepsCtrlK } from "./paletteChecks.ts";
import { reportFramePerf } from "./perfProbe.ts";
import { checkWallPictures } from "./pictureChecks.ts";
import {
  angleBetween,
  cameraName,
  cameraPosition,
  cameraType,
  carriedCardsInScene,
  distance,
  freeDeskPoint,
  groundUnder,
  headingToward,
  humans,
  localPose,
  remoteHumans,
  sampleLocalPoses,
  screenPointOf,
} from "./probes.ts";
import { checkReturnWhereYouLeft } from "./returnChecks.ts";
import {
  backToLobbyMiddle,
  checkChatBubbles,
  checkEmoteWheel,
  checkSitAndStand,
  checkWhereabouts,
} from "./socialChecks.ts";
import { checkWatchdog } from "./watchdogChecks.ts";
import { checkWhiteboard } from "./whiteboardChecks.ts";

const run = Date.now().toString(36);

let session: OfficeSession | undefined;
let ownerPage: Page;
let memberPage: Page;
/** The desk the spawn step used. */
let spawnSeat = "";
/** The owner's genius as picked at first login (#185). */
let ownerGenius: GeniusLook;

// Once per worker: at the start, and again after a failed step (Playwright restarts the worker).
test.beforeAll(async ({ browser }) => {
  // Two scenes loading in software GL on a loaded runner.
  test.setTimeout(120_000);
  session = await openOffice(browser);
  ({ ownerPage, memberPage } = session);
  ownerGenius = loadOwnerGenius();
});

test.afterAll(async () => {
  await session?.ownerCtx.close();
  await session?.memberCtx.close();
});

/** The operation the operation steps work in: built by the build-mode step, or here if that failed. */
async function ensureApollo(): Promise<void> {
  ensureRemoteRepo(process.env.E2E_DATA_DIR ?? "", "octo", "hello");
  await ensureOperation(ownerPage, "Apollo", "octo/hello");
}

test("both reach the office and see each other's avatar", async () => {
  await expect.poll(() => remoteHumans(ownerPage)).toHaveLength(1);
  await expect.poll(() => remoteHumans(memberPage)).toHaveLength(1);
  // Each sees the other's chosen genius (#185), and their own.
  const [memberOnOwner] = await remoteHumans(ownerPage);
  const [ownerOnMember] = await remoteHumans(memberPage);
  await expect.poll(() => geniusOf(ownerPage, "local-human")).toEqual(ownerGenius);
  await expect.poll(() => geniusOf(memberPage, ownerOnMember ?? "")).toEqual(ownerGenius);
  await expect
    .poll(async () => (await geniusOf(ownerPage, memberOnOwner ?? ""))?.archetype)
    .toBe("diva");
});

test("the owner changes genius in Settings; the member sees it at once (#185)", async () => {
  await ownerPage.bringToFront();
  await ownerPage.getByRole("button", { name: "Settings" }).click();
  const settings = ownerPage.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("tab", { name: "You" }).click();
  await expect(settings.getByText(/Scientist in crimson with flask/)).toBeVisible();
  await settings.getByRole("button", { name: "Change genius…" }).click();
  const picker = ownerPage.getByRole("dialog", { name: "Change your genius" });
  await picker.getByText("General", { exact: true }).click();
  await picker.getByRole("radio", { name: "Medals" }).check();
  await picker.getByRole("button", { name: "Save genius" }).click();
  // Back in Settings, which now describes the new genius.
  await expect(settings.getByText(/General in crimson with medals/)).toBeVisible();
  await settings.getByRole("button", { name: "Done" }).click();
  ownerGenius = { ...ownerGenius, archetype: "general", accessory: "medals" };
  const [ownerOnMember] = await remoteHumans(memberPage);
  await expect.poll(() => geniusOf(memberPage, ownerOnMember ?? "")).toEqual(ownerGenius);
  await expect.poll(() => geniusOf(ownerPage, "local-human")).toEqual(ownerGenius);
});

test("the member sees the owner walk", async () => {
  const [ownerOnMember] = await remoteHumans(memberPage);
  if (!ownerOnMember) throw new Error("owner avatar missing on the member's page");
  const before = (await humans(memberPage))[ownerOnMember];
  const selfBefore = (await humans(ownerPage))["local-human"];
  if (!before || !selfBefore) throw new Error("positions missing");

  // WASD walk; D is screen-right in the isometric view, away from the spawn wall.
  await ownerPage.bringToFront();
  await ownerPage.locator("canvas").first().hover();
  const walked = async () => {
    const self = (await humans(ownerPage))["local-human"];
    return self ? distance(self, selfBefore) : 0;
  };
  // Right after the genius change (previous step), the first walk on a loaded software-GL
  // machine can stall to a single capped frame step (also on master); walk again if so.
  for (let attempt = 0; attempt < 3 && (await walked()) <= 0.5; attempt++) {
    for (const key of ["d", "s"]) {
      await ownerPage.keyboard.down(key);
      await ownerPage.waitForTimeout(700);
      await ownerPage.keyboard.up(key);
    }
    await ownerPage.waitForTimeout(500);
  }

  await expect.poll(walked).toBeGreaterThan(0.5);
  await expect
    .poll(async () => {
      const seen = (await humans(memberPage))[ownerOnMember];
      return seen ? distance(seen, before) : 0;
    })
    .toBeGreaterThan(0.5);
  // Once settled, the member's copy ends where the owner actually stopped.
  await expect
    .poll(async () => {
      const self = (await humans(ownerPage))["local-human"];
      const seen = (await humans(memberPage))[ownerOnMember];
      return self && seen ? distance(self, seen) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(0.3);
});

test("chat from one browser arrives in the other", async () => {
  const text = `hello from the owner ${run}`;
  const input = ownerPage.getByTestId("chat-input");
  await input.fill(text);
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(
    ownerPage.getByTestId("chat-log").locator("li.rg-chat__line--own", { hasText: text }),
  ).toBeVisible();
  await expect(
    memberPage.getByTestId("chat-log").locator("li.rg-chat__line", { hasText: text }),
  ).toBeVisible();

  const reply = `hi back ${run}`;
  const memberInput = memberPage.getByTestId("chat-input");
  await memberInput.fill(reply);
  await memberInput.press("Enter");
  await expect(
    ownerPage.getByTestId("chat-log").locator("li.rg-chat__line", { hasText: reply }),
  ).toBeVisible();
  await input.press("Escape");
  await memberInput.press("Escape");
});

test("both draw on the lobby whiteboard and see each other's strokes; the wall shows the snapshot (#45)", async () => {
  // Two editors load in software GL, plus walking to the board: more than the default 90 s.
  test.setTimeout(240_000);
  await checkWhiteboard(ownerPage, memberPage);
});

test("/ opens search; chat is found, highlighted, for everyone who saw it (#41)", async () => {
  const word = `zephyr${run}`;
  const input = ownerPage.getByTestId("chat-input");
  await input.fill(`the ${word} deploy is green`);
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await input.press("Escape");
  for (const page of [ownerPage, memberPage]) {
    await page.bringToFront();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("/");
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    const box = page.getByTestId("search-input");
    await expect(box).toBeFocused();
    // Typed the way people do, including FTS5 syntax that must stay plain text.
    await box.pressSequentially(`${word} OR "`);
    await box.fill(word.slice(0, -2));
    const group = page.locator('[data-group="chat:lobby"]');
    await expect(group).toContainText("Chat · Lobby");
    const hit = group.getByTestId("search-hit").filter({ hasText: `the ${word} deploy` });
    await expect(hit).toBeVisible();
    await expect(hit.locator("mark")).toHaveText(word);
    await box.fill(`${word} "no such phrase anywhere"`);
    await expect(page.getByTestId("search-status")).toHaveText("No matches you can see.");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
});

test("a chat line floats as a bubble over the speaker, on the other browser too (#49)", async () => {
  await checkChatBubbles(ownerPage, memberPage, `bubble from the owner ${run}`);
});

test("hold G, arrow to an emote, let go: the other browser sees it (#49)", async () => {
  await checkEmoteWheel(ownerPage, memberPage);
});

test("E sits on the lobby sofa and stands up again; the other browser sees both (#49)", async () => {
  await checkSitAndStand(ownerPage, memberPage);
});

test("Who's where lists the owner in the lobby; clicking the name walks there (#49)", async () => {
  await checkWhereabouts(ownerPage, memberPage, owner.name);
  // Clear of the sofa again: later steps press E and click the floor.
  await backToLobbyMiddle(ownerPage);
  await backToLobbyMiddle(memberPage);
});

test("Ctrl+K opens the command palette, by keyboard alone; a text field and an open dialog keep the key (#261)", async () => {
  await checkCommandPalette(ownerPage, memberPage);
});

test("Ctrl+K on the whiteboard is the whiteboard's (Excalidraw's link editor), not the palette's (#261)", async () => {
  await checkWhiteboardKeepsCtrlK(ownerPage);
});

test("the status box unfolds the viewer's own usage (#40)", async () => {
  const status = ownerPage.getByRole("region", { name: "Status" });
  await status.getByRole("button", { name: "Usage", exact: true }).click();
  const panel = ownerPage.getByRole("region", { name: "Usage", exact: true });
  await expect(panel).toContainText("Your plan windows");
  await expect(panel).toContainText("No plan windows reported yet.");
  await expect(panel).toContainText("Office today");
  const res = await ownerPage.request.get("/api/usage/me?tz=0");
  expect(res.status()).toBe(200);
  expect(((await res.json()) as { limits: unknown[] }).limits).toEqual([]);
  await status.getByRole("button", { name: "Hide usage", exact: true }).click();
  await expect(panel).toBeHidden();
});

test("V toggles the first-person view and back", async () => {
  await ownerPage.bringToFront();
  const toggle = ownerPage.getByRole("button", { name: /First person/ });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  // The compound's 3/4 camera (#186) is a perspective camera too; first person swaps in its own.
  expect(await cameraType(ownerPage)).toBe("PerspectiveCamera");
  expect(await cameraName(ownerPage)).not.toBe("fpv-camera");

  await ownerPage.keyboard.press("v");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => cameraName(ownerPage)).toBe("fpv-camera");
  // #144: the projection matches the canvas (it once stayed at aspect 1).
  const projection = await ownerPage.evaluate(() => {
    const r3f = (
      window as unknown as {
        __regulusR3F?: {
          get(): {
            camera: { aspect?: number; fov?: number };
            size: { width: number; height: number };
          };
        };
      }
    ).__regulusR3F;
    const s = r3f?.get();
    return s
      ? { aspect: s.camera.aspect, fov: s.camera.fov, canvas: s.size.width / s.size.height }
      : null;
  });
  expect(projection?.aspect).toBeCloseTo(projection?.canvas ?? 0, 3);
  expect(projection?.fov).toBe(60);

  await ownerPage.keyboard.press("v");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => cameraName(ownerPage)).not.toBe("fpv-camera");
});

test("Z, C and a right-drag turn the camera, E does not; the wheel zooms out to the compound and back (#186, #190)", async () => {
  await ownerPage.bringToFront();
  const canvas = ownerPage.locator("canvas").first();
  await canvas.hover();
  /** The camera's yaw round the player (0 looks north), measured from where it is drawn. */
  const drawnYaw = async () => {
    const cam = await cameraPosition(ownerPage);
    const me = await localPose(ownerPage);
    if (!cam || !me) throw new Error("camera or player missing");
    return Math.atan2(cam.x - me.x, cam.z - me.z);
  };
  const start = await cameraSettled(ownerPage);
  expect(angleBetween(await drawnYaw(), start.yaw)).toBeLessThan(0.01);
  await ownerPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // The first view is a room-level framing, not the close third person (#190).
  expect(start.distance).toBeGreaterThan(20);
  await ownerPage.keyboard.press("z");
  const left = await cameraSettled(ownerPage);
  expect(angleBetween(left.yaw, start.yaw)).toBeCloseTo(Math.PI / 4, 2);
  expect(angleBetween(await drawnYaw(), left.yaw)).toBeLessThan(0.01);
  // E only interacts (#190): with nothing in reach the camera stays put.
  await ownerPage.keyboard.press("e");
  expect(angleBetween((await cameraSettled(ownerPage)).wantYaw, left.wantYaw)).toBeLessThan(0.001);
  await ownerPage.keyboard.press("c");
  const back = await cameraSettled(ownerPage);
  expect(angleBetween(back.yaw, start.yaw)).toBeLessThan(0.01);
  // A right-drag turns freely.
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  await ownerPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await ownerPage.mouse.down({ button: "right" });
  await ownerPage.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2, { steps: 8 });
  await ownerPage.mouse.up({ button: "right" });
  const dragged = await cameraSettled(ownerPage);
  expect(angleBetween(dragged.yaw, back.yaw)).toBeGreaterThan(0.3);
  // The wheel: out to the compound overview, then in close behind the player.
  for (let i = 0; i < 6; i++) await ownerPage.mouse.wheel(0, 400);
  const far = await cameraSettled(ownerPage);
  for (let i = 0; i < 12; i++) await ownerPage.mouse.wheel(0, -400);
  const near = await cameraSettled(ownerPage);
  expect(far.zoom).toBeCloseTo(1, 2);
  expect(far.distance).toBeGreaterThan(50);
  expect(near.zoom).toBeCloseTo(0, 2);
  expect(near.distance).toBeLessThan(6);
  // Back to the default framing for the next steps.
  await wheelZoomTo(ownerPage, start.wantZoom);
  await ownerPage.keyboard.press("z");
  await cameraSettled(ownerPage);
});

test("the player turns to follow the cursor and walks face-first to a click", async () => {
  await ownerPage.bringToFront();
  const start = await localPose(ownerPage);
  const at = start && (await screenPointOf(ownerPage, start));
  if (!start || !at) throw new Error("local player missing");

  /** Point the mouse at a viewport spot; the standing player ends up facing the floor under it. */
  const faceCursorAt = async (x: number, y: number) => {
    await ownerPage.mouse.move(x, y, { steps: 4 });
    const ground = await groundUnder(ownerPage, x, y);
    const self = await localPose(ownerPage);
    if (!ground || !self) throw new Error("cursor ground point or player missing");
    const want = headingToward(self, ground);
    await expect
      .poll(async () => angleBetween((await localPose(ownerPage))?.heading ?? Number.NaN, want))
      .toBeLessThan(0.05);
    return want;
  };

  // Sweep the cursor around the player: the heading follows it.
  const right = await faceCursorAt(at.x + 180, at.y + 60);
  const left = await faceCursorAt(at.x - 180, at.y + 60);
  expect(angleBetween(right, left)).toBeGreaterThan(0.5);

  // Over a HUD panel the cursor is ignored: the heading holds.
  const settled = (await localPose(ownerPage))?.heading ?? Number.NaN;
  const settings = await ownerPage.getByRole("button", { name: "Settings" }).boundingBox();
  if (!settings) throw new Error("Settings button missing");
  await ownerPage.mouse.move(settings.x + settings.width / 2, settings.y + settings.height / 2);
  await ownerPage.waitForTimeout(400);
  expect((await localPose(ownerPage))?.heading).toBeCloseTo(settled, 5);

  // Click open floor in the lobby: the player walks there, facing where it goes.
  const lobby = (await navRooms(ownerPage)).find((r) => r.kind === "lobby");
  if (!lobby) throw new Error("lobby missing");
  const target = { x: lobby.x + lobby.w / 2 - 4, z: lobby.z + lobby.d / 2 + 2 };
  const click = await screenPointOf(ownerPage, target);
  if (!click) throw new Error("target not on screen");
  await ownerPage.mouse.click(click.x, click.y);
  const samples = await sampleLocalPoses(ownerPage, 1500);
  const steps = samples.slice(1).flatMap((p, i) => {
    const prev = samples[i];
    if (!prev || distance(p, prev) < 0.01) return [];
    return [angleBetween(p.heading, headingToward(prev, p))];
  });
  expect(steps.length).toBeGreaterThan(5);
  // Never walks more than 45 degrees off its travel (turns on the spot first) and mostly dead on.
  expect(Math.max(...steps)).toBeLessThan(Math.PI / 4 + 0.15);
  expect(steps.filter((d) => d < 0.2).length / steps.length).toBeGreaterThan(0.8);
  await expect
    .poll(async () => {
      const self = await localPose(ownerPage);
      return self ? distance(self, target) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(0.75);

  // Standing again, it turns back toward the cursor.
  const there = await screenPointOf(ownerPage, target);
  if (!there) throw new Error("player not on screen");
  await faceCursorAt(there.x, there.y - 160);
});

test("the owner adds an operation in build mode: a refused spot, then placed, built and walked into (#186, #187)", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the locally started server (local git remotes)");
  ensureRemoteRepo(process.env.E2E_DATA_DIR ?? "", "octo", "hello");
  await ownerPage.bringToFront();
  // Add operation continues into build mode (#187): the ghost starts on a free spot.
  const first = await openBuildMode(ownerPage, "Apollo", "octo/hello");
  expect(first).toMatchObject({ kind: "create", server: { ok: true } });
  const status = ownerPage.getByTestId("build-status");
  const build = ownerPage.getByRole("button", { name: "Build here (Enter)" });
  await expect(status).toContainText("Clear to build");
  const spot = first.placement;
  if (!spot) throw new Error("no ghost");

  // The room goes on its repo owner's level (#268): build mode shows that level's grid, for a
  // new owner the grid the new level will have, with its lift landing and nothing else (#269).
  expect((await navRooms(ownerPage)).map((r) => r.kind)).toEqual(["landing"]);
  // Over the lift landing the ghost turns red with the server's reason, and nothing can be built.
  const landing = (await navRooms(ownerPage)).find((r) => r.kind === "landing");
  if (!landing) throw new Error("landing missing");
  await aimAt(ownerPage, landing.x + landing.w / 2, landing.z + landing.d / 2);
  const refused = await settledVerdict(ownerPage);
  expect(refused.server).toMatchObject({ ok: false, reason: "overlap", conflicts: ["landing"] });
  await expect(status).toHaveText("It overlaps the lift landing.");
  await expect(build).toBeDisabled();

  // Back over the free spot with the mouse; a click holds the ghost there.
  const middle = middleOf(spot);
  await aimAt(ownerPage, middle.x, middle.z);
  await ownerPage.mouse.down();
  await ownerPage.mouse.up();
  await expect.poll(async () => (await buildProbe(ownerPage)).pinned).toBe(true);
  expect((await buildProbe(ownerPage)).placement).toEqual(spot);
  // The keyboard: R turns the door, Shift+R back; arrows nudge the ghost a tile and back.
  await ownerPage.keyboard.press("r");
  expect((await buildProbe(ownerPage)).placement?.doorSide).not.toBe(spot.doorSide);
  await ownerPage.keyboard.press("Shift+R");
  await ownerPage.keyboard.press("ArrowLeft");
  expect((await buildProbe(ownerPage)).placement).not.toEqual(spot);
  await ownerPage.keyboard.press("ArrowRight");
  expect((await buildProbe(ownerPage)).placement).toEqual(spot);
  expect((await settledVerdict(ownerPage)).server?.ok).toBe(true);
  await expect(build).toBeEnabled();
  await ownerPage.keyboard.press("Enter");
  await expect(ownerPage.getByRole("dialog", { name: "Build Apollo" })).toHaveCount(0);
  const added = ownerPage.getByRole("dialog", { name: "Operation set up" });
  await expect(added.getByText("Ready on trunk")).toBeVisible();

  // The compound (#181): Apollo got a room on the map, which finishes its build phase.
  const apolloRoom = async () => {
    const res = await ownerPage.request.get("/api/compound");
    const body = (await res.json()) as {
      rooms: Array<{
        name: string;
        gridX: number;
        gridY: number;
        width: number;
        depth: number;
        doorSide: string;
        buildState: string;
      }>;
    };
    return body.rooms.find((r) => r.name === "Apollo");
  };
  await expect.poll(async () => (await apolloRoom())?.buildState).toBe("ready");
  // Built exactly where it was placed.
  expect(await apolloRoom()).toMatchObject({
    gridX: spot.gridX,
    gridY: spot.gridY,
    width: spot.width,
    depth: spot.depth,
    doorSide: spot.doorSide,
  });
  await added.getByRole("button", { name: "Done" }).click();
  await expect(added).toHaveCount(0);

  // Walk there from the lobby with the mouse: zoom out until Apollo is on screen, click inside.
  const apollo = await roomNamed(ownerPage, "Apollo");
  await ownerPage.locator("canvas").first().hover();
  const zoom = (await cameraState(ownerPage)).wantZoom;
  await expect(async () => {
    const pose = await navPose(ownerPage);
    if (pose.room === apollo.id) return;
    if (!pose.walking) {
      const inside = await screenPointOf(ownerPage, apollo.inside);
      const viewport = ownerPage.viewportSize();
      const onScreen =
        inside &&
        viewport &&
        inside.x > 300 &&
        inside.x < viewport.width - 300 &&
        inside.y > 150 &&
        inside.y < viewport.height - 200;
      if (onScreen) await ownerPage.mouse.click(inside.x, inside.y);
      else await ownerPage.mouse.wheel(0, 300);
    }
    throw new Error("walking to Apollo");
  }).toPass({ timeout: 90_000, intervals: [700] });
  await expect(ownerPage.locator(".rg-topbar__operation")).toHaveText("Apollo");
  await expect(ownerPage.getByRole("list", { name: "Work in this operation" })).toBeVisible();
  await wheelZoomTo(ownerPage, zoom);
  // The perf probe (#190): frame times in a room, report only (tests/e2e/perfProbe.ts).
  await reportFramePerf(ownerPage, "owner-in-apollo");

  // The member's GitHub account sees no repo on Apollo's level (#270, D26): to them there is
  // no such level and no such room. Quick travel offers neither, the layout the server gives
  // them has only the lobby level, and the owner inside Apollo is not drawn for them.
  expect((await navRooms(memberPage)).some((r) => r.name === "Apollo")).toBe(false);
  expect(await goToLevelOf(memberPage, "Apollo")).toBe(false);
  await memberPage.bringToFront();
  await memberPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await memberPage.keyboard.press("f");
  const travel = memberPage.getByRole("dialog", { name: "Quick travel" });
  // One level is all they are shown (#269): no other level's group, no way to one.
  await expect(travel.getByRole("button", { name: /^Go to / })).toHaveCount(0);
  await expect(travel.locator("section")).toHaveCount(1);
  await expect(travelButton(travel, "Lobby")).toBeVisible();
  await expect(travelButton(travel, "Apollo")).toHaveCount(0);
  await memberPage.keyboard.press("Escape");
  await expect(travel).toHaveCount(0);
  const layout = await (await memberPage.request.get("/api/compound")).text();
  expect(layout).not.toContain("Apollo");
  expect((JSON.parse(layout) as { levels: unknown[]; rooms: unknown[] }).levels).toHaveLength(1);
  expect((JSON.parse(layout) as { rooms: unknown[] }).rooms).toEqual([]);
  expect(await (await memberPage.request.get("/api/operations")).text()).not.toContain("Apollo");
  await expect.poll(() => remoteHumans(memberPage)).toHaveLength(0);

  // Still inside, the owner is on a level the member cannot reach, so not drawn; back on
  // the shared lobby level (the lobby is only there, #269) the member sees them again.
  await memberPage.waitForTimeout(500);
  expect(await remoteHumans(memberPage)).toHaveLength(0);
  await ownerPage.bringToFront();
  await walkToLobby(ownerPage);
  await expect.poll(() => remoteHumans(memberPage)).toHaveLength(1);
});

test("Operation settings and Add operation fit a 1280×720 window with the X in view", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the locally started server (local git remotes)");
  await ensureApollo();
  await ownerPage.bringToFront();
  await ownerPage.setViewportSize({ width: 1280, height: 720 });
  const rooms = ownerPage.getByRole("navigation", { name: "Rooms" });
  const dialogs = [
    {
      name: "Operation settings",
      open: async () => {
        await rooms.getByRole("button", { name: "Quick travel (F)" }).click();
        await ownerPage
          .getByRole("dialog", { name: "Quick travel" })
          .getByRole("button", { name: "Operation settings: Apollo" })
          .click();
      },
    },
    {
      name: "New operation",
      open: () => rooms.getByRole("button", { name: "New operation…" }).click(),
    },
  ];
  for (const { name, open } of dialogs) {
    await open();
    const dialog = ownerPage.getByRole("dialog", { name });
    const layout = await settledDialogLayout(ownerPage, dialog);
    expect(insideViewport(layout), `${name}: X inside the viewport`).toBe(true);
    expect(layout.closeHittable, `${name}: X not clipped or covered`).toBe(true);
    expect(layout.horizontalOverflow, `${name}: no horizontal scrollbar`).toEqual([]);
    expect(layout.frameScrolls, `${name}: only the body scrolls`).toBe(false);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  await ownerPage.setViewportSize({ width: 1280, height: 800 });
});

test("Settings: tabs by keyboard, and a skin rule picked from the thumbnail gallery (#225)", async () => {
  await ownerPage.bringToFront();
  await ownerPage.setViewportSize({ width: 1280, height: 720 });
  await ownerPage.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = ownerPage.getByRole("dialog", { name: "Settings", exact: true });
  const layout = await settledDialogLayout(ownerPage, dialog);
  expect(insideViewport(layout), "Settings: X inside the viewport").toBe(true);
  expect(layout.closeHittable, "Settings: X not clipped or covered").toBe(true);
  expect(layout.horizontalOverflow, "Settings: no horizontal scrollbar").toEqual([]);

  const tab = (name: string) => dialog.getByRole("tab", { name, exact: true });
  await tab("You").click();
  await ownerPage.keyboard.press("ArrowDown");
  await expect(tab("Office")).toHaveAttribute("aria-selected", "true");
  await expect(tab("Office")).toBeFocused();
  await expect(dialog.getByRole("tabpanel")).toContainText("GitHub");
  await ownerPage.keyboard.press("End");
  await expect(tab("Display and sound")).toBeFocused();
  await expect(dialog.getByRole("tabpanel")).toContainText("Reduce motion");
  await ownerPage.keyboard.press("Home");
  await expect(tab("You")).toHaveAttribute("aria-selected", "true");

  await tab("Henchmen").click();
  const skins = dialog.getByRole("region", { name: "Henchman skins" });
  await skins.getByRole("button", { name: "Add a rule…" }).click();
  const editor = skins.getByRole("form", { name: "New skin rule" });
  await editor.getByRole("radio", { name: /^The PM/ }).check();
  await editor.getByRole("radio", { name: "Chef" }).check();
  // The gallery's thumbnails are images drawn once by one offscreen renderer.
  await expect(editor.locator('.rg-skin-gallery img[src^="data:image/png"]')).toHaveCount(5);
  await expect(editor).toContainText("The PM wears the Chef.");
  await editor.getByRole("button", { name: "Add rule" }).click();
  const rules = skins.getByRole("list", { name: "Skin rules" });
  await expect(rules.getByRole("listitem")).toHaveCount(1);
  await expect(rules).toContainText("The PM");
  await expect(rules).toContainText("wears the Chef");
  const listed = await (await ownerPage.request.get("/api/skin-rules")).json();
  expect(listed.rules).toMatchObject([{ match: "role:pm", skinId: "chef", priority: 0 }]);
  await skins.getByRole("button", { name: "Delete rule for The PM" }).click();
  await expect(skins.getByText(/No rules yet/)).toBeVisible();

  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
  await ownerPage.setViewportSize({ width: 1280, height: 800 });
});

test("Settings → Agents: an agent is created and changed in plain words, with a model and an appearance (#280)", async () => {
  await checkAgentForm(ownerPage, process.env.E2E_AGENT_FORM_SHOTS);
});

test("office agents in the world: a personal one follows its owner and only they can talk to it; a shared one wanders and both can (#252)", async () => {
  test.setTimeout(420_000);
  if (process.env.E2E_DATA_DIR) await ensureApollo();
  await checkAgentsInTheWorld(ownerPage, memberPage, process.env.E2E_AGENT_WORLD_SHOTS);
});

test("Settings → Agents: the owner connects their existing Hermes, and a gateway that is away is said plainly (#58)", async () => {
  await checkHermesConnection(ownerPage, process.env.E2E_HERMES_SHOTS);
});

test("Settings → Agents: who an agent is, what it remembers and its notes; a personal agent's stay private (#136)", async () => {
  await checkAgentMind(ownerPage, memberPage, process.env.E2E_AGENT_MIND_SHOTS);
});

test("Settings → Watchdog: the owner sets it up with keys that only go in; each person sees the findings they may (#253)", async () => {
  test.setTimeout(240_000);
  if (process.env.E2E_DATA_DIR) await ensureApollo();
  await checkWatchdog(ownerPage, memberPage, process.env.E2E_WATCHDOG_SHOTS);
});

test("clicking a free desk opens the spawn dialog and the server answers agent.spawn", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the locally started server (local git remotes)");
  await ensureApollo();
  await ownerPage.bringToFront();
  // Quick travel to Apollo's door and walk in; the HUD counters appear once its OperationRoom is in.
  await travelInto(ownerPage, "Apollo");

  await expect.poll(() => freeDeskPoint(ownerPage)).not.toBeNull();
  const desk = await freeDeskPoint(ownerPage);
  if (!desk) throw new Error("no free desk in the scene");
  // A runner may take the spawn (the henchman then sits there); the board step picks another desk.
  spawnSeat = desk.seatId;
  await ownerPage.mouse.click(desk.x, desk.y);
  const dialog = ownerPage.getByRole("dialog", { name: "Spawn a henchman" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(desk.seatId)).toBeVisible();
  // Repo preselected, model and effort defaulted: Spawn right away, with no prompt (#142).
  await expect(dialog.getByRole("radio", { name: "Opus" })).toBeChecked();
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  await dialog.getByRole("button", { name: "Spawn henchman" }).click();
  // Without an agent CLI in the e2e server the spawn is refused (shown in the
  // dialog), unless a runner took it, in which case the henchman sits down.
  await expect(dialog.getByRole("alert").or(ownerPage.getByText("Henchman spawned"))).toBeVisible({
    timeout: 30_000,
  });
  if (await dialog.isVisible())
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("a room manager adds a desk in room settings; the room shows it live (#187)", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the locally started server (local git remotes)");
  await ensureApollo();
  await ownerPage.bringToFront();
  const apollo = await walkInto(ownerPage, "Apollo");
  await addDeskInRoomSettings(ownerPage, apollo.id, "Apollo");
});

test("the owner archives, restores and deletes an operation; its files go with it", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the locally started server (local git remotes)");
  const dataDir = process.env.E2E_DATA_DIR ?? "";
  await ensureApollo();
  await ownerPage.bringToFront();
  const rooms = ownerPage.getByRole("navigation", { name: "Rooms" });
  const travel = ownerPage.getByRole("dialog", { name: "Quick travel" });
  const hermes = travel.getByRole("button", { name: /^Hermes/ });
  /** Hermes's row in quick travel (rooms you can enter), checked with the menu open. */
  const inQuickTravel = async (count: number) => {
    await rooms.getByRole("button", { name: "Quick travel (F)" }).click();
    await expect(hermes).toHaveCount(count);
    await ownerPage.keyboard.press("Escape");
    await expect(travel).toHaveCount(0);
  };
  const openSettings = async () => {
    await rooms.getByRole("button", { name: "Quick travel (F)" }).click();
    await travel.getByRole("button", { name: "Operation settings: Hermes" }).click();
  };
  // Escape leaves build mode and builds nothing (#187); the second time it builds where offered.
  await openBuildMode(ownerPage, "Hermes", "octo/hello");
  await ownerPage.keyboard.press("Escape");
  await expect(ownerPage.getByRole("dialog", { name: "Build Hermes" })).toHaveCount(0);
  expect((await buildProbe(ownerPage)).active).toBe(false);
  expect((await navRooms(ownerPage)).some((r) => r.name === "Hermes")).toBe(false);
  expect((await openBuildMode(ownerPage, "Hermes", "octo/hello")).server?.ok).toBe(true);
  await ownerPage.keyboard.press("Enter");
  const added = ownerPage.getByRole("dialog", { name: "Operation set up" });
  await expect(added.getByText("Ready on trunk")).toBeVisible();
  await added.getByRole("button", { name: "Done" }).click();
  await expect
    .poll(async () => (await navRooms(ownerPage)).find((r) => r.name === "Hermes")?.buildState)
    .toBe("ready");
  await inQuickTravel(1);
  const mirror = join(dataDir, "projects", "hermes");
  expect(existsSync(join(mirror, "hello", ".git"))).toBe(true);
  // A human's area on the operation, as a spawn would leave it.
  const area = join(dataDir, "worktrees", "hermes", "u1", "_clones", "hello");
  mkdirSync(area, { recursive: true });
  writeFileSync(join(area, "work.txt"), "work\n");

  // Archive from the Danger zone of Operation settings: its room goes from the compound, files kept.
  const settings = ownerPage.getByRole("dialog", { name: "Operation settings" });
  await openSettings();
  await settings.getByRole("button", { name: "Archive operation" }).click();
  await expect(settings).toBeHidden();
  await expect
    .poll(async () => (await navRooms(ownerPage)).some((r) => r.name === "Hermes"))
    .toBe(false);
  await inQuickTravel(0);
  expect(existsSync(mirror)).toBe(true);

  // Restore from Settings → Office → Archived operations.
  await ownerPage.getByRole("button", { name: "Settings", exact: true }).click();
  const panel = ownerPage.getByRole("dialog", { name: "Settings", exact: true });
  await panel.getByRole("tab", { name: "Office" }).click();
  await expect(panel.getByRole("list", { name: "Archived operations" })).toContainText("Hermes");
  await panel.getByRole("button", { name: "Restore Hermes" }).click();
  await expect(panel.getByText("Hermes is back in the compound.")).toBeVisible();
  // The Restore button went with the list row, and keyboard focus with it: close with Done.
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(panel).toBeHidden();
  await expect
    .poll(async () => (await navRooms(ownerPage)).find((r) => r.name === "Hermes")?.buildState)
    .toBe("ready");
  await inQuickTravel(1);

  // Delete for good, after typing the name.
  await openSettings();
  await settings.getByRole("button", { name: "Delete operation…" }).click();
  const confirm = settings.getByRole("button", { name: "Delete operation", exact: true });
  await expect(confirm).toBeDisabled();
  await settings.getByLabel("Type the operation name to confirm").fill("Hermes");
  await confirm.click();
  await expect(settings).toBeHidden();
  await expect
    .poll(async () => (await navRooms(ownerPage)).some((r) => r.name === "Hermes"))
    .toBe(false);
  // The dialog closes as soon as the operation is archived (step one of the delete).
  await expect.poll(() => existsSync(mirror)).toBe(false);
  await expect.poll(() => existsSync(join(dataDir, "worktrees", "hermes"))).toBe(false);
  // The other operation is untouched.
  expect(existsSync(join(dataDir, "projects", "apollo", "hello", ".git"))).toBe(true);
  expect((await navRooms(ownerPage)).some((r) => r.name === "Apollo")).toBe(true);
});

test("a card from the issue board carried to a free desk opens the spawn dialog prefilled", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the locally started server and its fake GitHub");
  await ensureApollo();
  const orgToken = "github_pat_E2Eboards_0123456789abcdefghij";
  const issue = {
    number: 7,
    title: "Fix the lift doors",
    state: "open",
    labels: [{ name: "bug" }],
    assignees: [],
    user: { login: "olga" },
    html_url: "https://github.com/octo/hello/issues/7",
    body: "The doors stick.\n\n- [ ] oil them\n\n<script>alert(1)</script>",
    updated_at: new Date().toISOString(),
  };
  const pull = {
    ...issue,
    number: 8,
    title: "Oil the lift doors",
    body: "Fixes #7",
    html_url: "https://github.com/octo/hello/pull/8",
    draft: false,
    merged_at: null,
    requested_reviewers: [{ login: "olga" }],
    requested_teams: [],
    head: { ref: "office/oil", sha: "e2e8" },
    base: { ref: "trunk" },
  };
  let gh: { close(): Promise<void> } | undefined;
  try {
    // The fake GitHub runs beside the office (#270); this step loads its org and boards into it.
    gh = await loadBoards(
      { orgToken, repos: [{ owner: "octo", name: "hello", defaultBranch: "trunk" }] },
      { "octo/hello": { issues: [issue], pulls: [pull] } },
    );
    await ownerPage.bringToFront();
    const origin = new URL(ownerPage.url()).origin;
    const connect = await ownerPage.request.put("/api/github/pat", {
      data: { token: orgToken },
      headers: { origin },
    });
    expect(connect.status()).toBe(200);

    await walkInto(ownerPage, "Apollo");
    const panel = ownerPage.getByRole("dialog", { name: "Issue board" });
    await clickInScene(ownerPage, "board-hotspot-issue-board", panel);
    // The poller fills the board from the fake GitHub shortly after the connection.
    const card = panel.getByRole("button", { name: "#7 Fix the lift doors" });
    await expect(card).toBeVisible({ timeout: 45_000 });
    await expect(panel.getByRole("region", { name: "Open" })).toContainText("#7");
    // The board window is wide and still fits a 1280×720 window (#282).
    await checkBoardLayout(ownerPage, panel, card);
    // In first person a window frees the cursor and holds the view; closing it resumes (#282).
    await checkFirstPersonWindow(ownerPage, panel, card);
    await card.click();
    await expect(panel.getByRole("region", { name: "Description" })).toContainText(
      "The doors stick.",
    );
    // Raw HTML in the body is text, not markup.
    await expect(panel.getByRole("region", { name: "Description" })).toContainText(
      "<script>alert(1)</script>",
    );
    await expect(panel.locator("script")).toHaveCount(0);
    await panel.getByRole("button", { name: "Carry to a desk" }).click();
    await expect(panel).toHaveCount(0);
    const chip = ownerPage.getByRole("status", { name: "Carried card" });
    await expect(chip).toContainText("#7");
    await expect.poll(() => carriedCardsInScene(ownerPage)).toHaveLength(1);

    const desk = await freeDeskPoint(ownerPage, [spawnSeat]);
    if (!desk) throw new Error("no free desk in the scene");
    await ownerPage.mouse.click(desk.x, desk.y);
    const dialog = ownerPage.getByRole("dialog", { name: "Spawn a henchman" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(desk.seatId)).toBeVisible();
    await expect(dialog.getByLabel("Task title")).toHaveValue("#7 Fix the lift doors");
    await expect(dialog.getByLabel("Issue", { exact: true })).toHaveValue("7");
    await expect(dialog.getByLabel(/Prompt/)).toHaveValue(
      /^Work on issue #7 in octo\/hello: Fix the lift doors/,
    );
    // The card went down on the desk.
    await expect(chip).toHaveCount(0);
    await expect.poll(() => carriedCardsInScene(ownerPage)).toHaveLength(0);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  } finally {
    await ownerPage.request
      .delete("/api/github/connection", { headers: { origin: new URL(ownerPage.url()).origin } })
      .catch(() => undefined);
    await gh?.close();
  }
});

test("a PR merged on the board rings the gong; henchmen cheer and sit back as they were (#43)", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the locally started server and its fake GitHub");
  await ensureApollo();
  await checkMergeGong(ownerPage, { operation: "Apollo" });
});

test("the blast door opens for everyone, the owner walks out onto the dock, it shuts by itself (#188)", async () => {
  test.setTimeout(240_000);
  await checkBlastDoor(ownerPage, memberPage, owner.name);
});

test("coffee: E at the break-room machine buzzes the owner; the member sees the cup and the jitters (#63)", async () => {
  // Two people walk to the break room and back.
  test.setTimeout(180_000);
  await checkCoffee(ownerPage, memberPage, owner.name);
});

test("the lift: E opens its panel; the owner rides to Apollo's level, the member sees them gone, and back (#269)", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the locally started server (local git remotes)");
  await ensureApollo();
  await checkLift(ownerPage, memberPage, owner.name);
});

test("a second person on a level: one room opens for them, the other is a sealed door that says nothing (#269)", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the locally started server (local git remotes)");
  // A second room is built, a page reloads and two people walk: more than one step's default.
  test.setTimeout(300_000);
  await ensureApollo();
  ensureRemoteRepo(process.env.E2E_DATA_DIR ?? "", "octo", "forge");
  await ensureOperation(ownerPage, "Vulcan", "octo/forge");
  await checkOpenAndClosedRooms(ownerPage, memberPage, "Apollo", "octo/hello", "Vulcan");
});

test("back where you left: a reload returns the owner to Apollo; the member, who lost Apollo while away, arrives in the lobby with no word of it (#262)", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the locally started server (local git remotes)");
  // Two people walk into a room on another level and three pages load.
  test.setTimeout(300_000);
  await ensureApollo();
  await checkReturnWhereYouLeft(
    ownerPage,
    memberPage,
    "Apollo",
    "octo/hello",
    process.env.E2E_RETURN_SHOTS,
  );
});

test("one task across two rooms: a part in each for the owner; an ordinary task for someone who sees one room (#257)", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the locally started server (local git remotes)");
  test.setTimeout(300_000);
  await ensureApollo();
  ensureRemoteRepo(process.env.E2E_DATA_DIR ?? "", "octo", "forge");
  await ensureOperation(ownerPage, "Vulcan", "octo/forge");
  await checkLinkedTask(
    ownerPage,
    memberPage,
    { first: "Apollo", firstRepo: "octo/hello", second: "Vulcan", secondRepo: "octo/forge" },
    process.env.E2E_LINKED_TASK_SHOTS,
  );
});

test("the jukebox: E opens it, a queued track plays in both browsers at the same playhead (#47)", async () => {
  test.setTimeout(240_000);
  await checkJukebox(ownerPage, memberPage);
});

test("wall pictures: uploaded, hung on a free wall, seen by the other browser, removed (#46)", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the locally started server (local git remotes)");
  test.setTimeout(240_000);
  await ensureApollo();
  await checkWallPictures(ownerPage, memberPage, "Apollo", "octo/hello");
});

test("the bookshelf: the repo's docs for those who may see the repo, a hostile document rendered as text (#264)", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the locally started server (local git remotes)");
  test.setTimeout(240_000);
  await ensureApollo();
  await checkBookshelf(ownerPage, memberPage, "Apollo", "octo/hello");
});

test("access taken away while in a room: a plain message, no reconnect loop (#244)", async () => {
  test.skip(!process.env.E2E_DATA_DIR, "needs the locally started server (local git remotes)");
  test.setTimeout(240_000);
  await ensureApollo();
  await checkAccessWithdrawn(ownerPage, memberPage, "Apollo", "octo/hello");
});
