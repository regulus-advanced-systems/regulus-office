import { afterEach, describe, expect, test } from "bun:test";
import type { Emote } from "@regulus/protocol";
import { act } from "react";
import { type Mounted, mount, press, useDom } from "../a11y/dom.ts";
import { useGlobalHotkeys } from "../hotkeys/useHotkeys.ts";
import { EmoteWheel } from "./EmoteWheel.tsx";
import { CLOSED, sliceAt, TAP_MS, WHEEL_EMOTES, wheelStep } from "./emoteWheel.ts";

describe("wheel logic", () => {
  test("slices go clockwise from the top; the centre picks nothing", () => {
    expect(sliceAt(0, -100)).toBe(0);
    expect(sliceAt(100, -55)).toBe(1);
    expect(sliceAt(0, 100)).toBe(3);
    expect(sliceAt(-100, -55)).toBe(5);
    expect(sliceAt(5, 5)).toBeNull();
  });

  test("hold, arrow, release plays the chosen emote", () => {
    let s = wheelStep(CLOSED, { type: "open", at: 0 }).state;
    s = wheelStep(s, { type: "key", key: "ArrowRight" }).state;
    s = wheelStep(s, { type: "key", key: "ArrowRight" }).state;
    expect(s.selected).toBe(1);
    s = wheelStep(s, { type: "key", key: "ArrowLeft" }).state;
    s = wheelStep(s, { type: "key", key: "ArrowLeft" }).state;
    expect(s.selected).toBe(WHEEL_EMOTES.length - 1);
    const end = wheelStep(s, { type: "release", at: 900 });
    expect(end).toEqual({ state: CLOSED, play: "facepalm" });
  });

  test("a tap stays open; a long hold over nothing closes; Escape cancels", () => {
    const open = wheelStep(CLOSED, { type: "open", at: 1000 }).state;
    const tapped = wheelStep(open, { type: "release", at: 1000 + TAP_MS - 1 }).state;
    expect(tapped).toMatchObject({ open: true, sticky: true });
    expect(wheelStep(tapped, { type: "key", key: "3" }).play).toBe("clap");
    expect(wheelStep(tapped, { type: "open", at: 2000 }).state).toEqual(CLOSED);
    expect(wheelStep(open, { type: "release", at: 1000 + TAP_MS }).state).toEqual(CLOSED);
    expect(wheelStep(tapped, { type: "key", key: "Escape" })).toEqual({
      state: CLOSED,
      play: null,
    });
    expect(wheelStep(tapped, { type: "key", key: "Enter" }).state.open).toBe(true);
  });
});

useDom();

class FakeClient {
  sent: Emote[] = [];
  send(_type: "emote", payload: { emote: Emote }) {
    this.sent.push(payload.emote);
  }
}

function Harness({ client }: { client: FakeClient }) {
  useGlobalHotkeys();
  return <EmoteWheel client={client} />;
}

const wheel = () => document.querySelector('[data-testid="emote-wheel"]');
const checked = () =>
  document.querySelector('[role="menuitemradio"][aria-checked="true"]')?.getAttribute("data-emote");

async function keyUp(key: string) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
  });
}

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe("<EmoteWheel> by keyboard", () => {
  test("hold G, arrow to thumbs up, let go: thumbs up is sent and the wheel closes", async () => {
    const client = new FakeClient();
    mounted = await mount(<Harness client={client} />);
    expect(wheel()).toBeNull();
    await press(window, "g");
    expect(wheel()).not.toBeNull();
    expect(document.querySelectorAll('[role="menuitemradio"]')).toHaveLength(6);
    // Arrows belong to the wheel while it is open, not to walking.
    const walked: string[] = [];
    const walk = (e: KeyboardEvent) => walked.push(e.key);
    window.addEventListener("keydown", walk);
    await press(window, "ArrowRight");
    await press(window, "ArrowRight");
    window.removeEventListener("keydown", walk);
    expect(walked).toEqual([]);
    expect(checked()).toBe("thumbs_up");
    await new Promise((r) => setTimeout(r, TAP_MS + 10));
    await keyUp("g");
    expect(client.sent).toEqual(["thumbs_up"]);
    expect(wheel()).toBeNull();
  });

  test("a tap keeps it open; a digit plays at once; Escape closes", async () => {
    const client = new FakeClient();
    mounted = await mount(<Harness client={client} />);
    await press(window, "g");
    await keyUp("g");
    expect(wheel()).not.toBeNull();
    await press(window, "4");
    expect(client.sent).toEqual(["dance"]);
    expect(wheel()).toBeNull();
    await press(window, "g");
    await keyUp("g");
    await press(window, "Escape");
    expect(wheel()).toBeNull();
    expect(client.sent).toEqual(["dance"]);
  });
});
