import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type BuildingState, type JukeboxState, type JukeboxTrack } from "@regulus/protocol";
import { buildingFixture } from "@regulus/protocol/src/fixtures.ts";
import { useBuildingStore } from "../../state/building.ts";
import { useSessionStore } from "../../state/session.ts";
import { click, type Mounted, mount, press, useDom } from "../a11y/dom.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import { JukeboxPanel } from "./JukeboxPanel.tsx";
import { addedLabel, clock, controlsFor, syncLabel } from "./model.ts";
import type { JukeboxSend } from "./send.ts";

useDom();

const LIBRARY: JukeboxTrack[] = [
  {
    id: "bundled:spy-glass",
    title: "Spy Glass",
    artist: "Kevin MacLeod",
    source: "file",
    videoId: "",
    durationMs: 226_978,
    license: "CC-BY-4.0",
    attribution: '"Spy Glass" Kevin MacLeod (incompetech.com)',
    bundled: true,
    addedBy: "",
    addedByName: "",
    createdAt: 1,
  },
];

const entry = (id: string, addedBy: string, addedByName: string) => ({
  entryId: id,
  trackId: `t-${id}`,
  title: `Track ${id}`,
  artist: "Artist",
  source: "file" as const,
  videoId: "",
  durationMs: 120_000,
  addedBy,
  addedByName,
});

const jukebox: JukeboxState = {
  current: entry("now", "u-otto", "Otto"),
  startedAtServerMs: Date.now() - 30_000,
  pausedAtMs: 0,
  playing: true,
  volume: 0.6,
  queue: [entry("mine", "u-mia", "Mia"), entry("theirs", "u-otto", "Otto")],
};

const as = (id: string, role: "member" | "admin" | "viewer") =>
  useSessionStore.setState({
    status: "authenticated",
    user: { id, displayName: id, role },
    error: null,
  });

let mounted: Mounted | null = null;
const realFetch = globalThis.fetch;
beforeEach(() => {
  useBuildingStore.setState({
    state: { ...(buildingFixture as BuildingState), jukebox },
    sessionId: null,
  });
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ tracks: LIBRARY }), {
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  globalThis.fetch = realFetch;
});

describe("jukebox panel (#47)", () => {
  test("a member queues a library track and removes only their own entry; someone else's track is not theirs to skip", async () => {
    as("u-mia", "member");
    const sent: [string, unknown][] = [];
    const send: JukeboxSend = (type, payload) => sent.push([type, payload]);
    mounted = await mount(<JukeboxPanel send={send} />);
    await settle();
    expect(text()).toContain("Track now");
    expect(text()).toContain("queued by Otto");
    expect(text()).toContain("Kevin MacLeod (incompetech.com)");
    expect(button("Skip")?.disabled).toBe(true);
    expect(button("Pause")?.disabled).toBe(true);
    expect(document.querySelector('[aria-label="Take “Track theirs” off the queue"]')).toBeNull();
    const remove = document.querySelector('[aria-label="Take “Track mine” off the queue"]');
    const queue = document.querySelector('[aria-label="Queue “Spy Glass”"]');
    if (!remove || !queue) throw new Error("missing buttons");
    await click(queue);
    await click(remove);
    expect(sent).toEqual([
      ["jukebox.enqueue", { trackId: "bundled:spy-glass" }],
      ["jukebox.remove", { entryId: "mine" }],
    ]);
    expect(text()).not.toContain("Jukebox volume for everyone");
  });

  test("an admin controls any track and the office volume; the seek slider works by keyboard", async () => {
    as("u-ada", "admin");
    const sent: [string, unknown][] = [];
    const send: JukeboxSend = (type, payload) => sent.push([type, payload]);
    mounted = await mount(<JukeboxPanel send={send} />);
    await settle();
    expect(button("Skip")?.disabled).toBe(false);
    expect(text()).toContain("Jukebox volume for everyone");
    const pause = button("Pause");
    if (!pause) throw new Error("no pause");
    await click(pause);
    expect(sent).toEqual([["jukebox.pause", {}]]);
    const slider = document.querySelector<HTMLInputElement>(".rg-jukebox__seek");
    if (!slider) throw new Error("no slider");
    expect(slider.disabled).toBe(false);
    expect(slider.getAttribute("aria-valuetext")).toMatch(/of 2:00$/);
    await press(slider, "ArrowRight");
  });

  test("a viewer listens: no queue buttons, no add-music form", async () => {
    as("u-vic", "viewer");
    mounted = await mount(<JukeboxPanel send={() => undefined} />);
    await settle();
    expect(text()).toContain("Spy Glass");
    expect(document.querySelector('[aria-label="Queue “Spy Glass”"]')).toBeNull();
    expect(document.querySelector('[aria-label="Add music"]')).toBeNull();
  });
});

describe("jukebox panel model", () => {
  test("controls follow the protocol's rules", () => {
    expect(controlsFor(null, jukebox)).toEqual({ use: false, current: false, manage: false });
    expect(controlsFor({ userId: "u-otto", role: "member" }, jukebox).current).toBe(true);
    expect(controlsFor({ userId: "u-mia", role: "member" }, jukebox).current).toBe(false);
  });

  test("labels", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(226_978)).toBe("3:46");
    expect(clock(3_723_000)).toBe("1:02:03");
    expect(clock(Number.NaN)).toBe("--:--");
    expect(addedLabel({ addedBy: "", addedByName: "" })).toBe("picked by the jukebox");
    expect(syncLabel({ driftMs: -7.4, action: "settle" })).toBe("In sync with the office (7 ms)");
    expect(syncLabel({ driftMs: 0, action: "idle" })).toBe("");
  });
});
