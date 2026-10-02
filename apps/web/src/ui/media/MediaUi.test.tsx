/** Voice and lounge TV controls (#48): hidden without media, per role with it, sofa auto-focus. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type BuildingState, LOBBY_OPERATION_ID, seatKey } from "@regulus/protocol";
import { buildingFixture, humanFixture } from "@regulus/protocol/src/fixtures.ts";
import { act } from "react";
import { type MediaController, useMediaStore } from "../../media/store.ts";
import { voiceBadgeKind } from "../../scene/social/VoiceBadge.tsx";
import { useBuildingStore } from "../../state/building.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { button, text } from "../auth/testDom.tsx";
import { VoiceSettings } from "../settings/VoiceSettings.tsx";
import { MediaStrip, micLabel } from "./MediaStrip.tsx";
import { TvOverlay } from "./TvOverlay.tsx";

useDom();

let mounted: Mounted | null = null;
const calls: string[] = [];
const controller: MediaController = {
  setMic: async (on) => void calls.push(`mic:${on}`),
  setTalking: (held) => void calls.push(`talk:${held}`),
  startShare: async () => void calls.push("share"),
  stopShare: async () => void calls.push("stop"),
  stopShareOf: (id) => void calls.push(`stopOf:${id}`),
  switchMic: async (id) => void calls.push(`switch:${id}`),
};

function building(humans: Record<string, Partial<typeof humanFixture>>, self = "s-me") {
  const state: BuildingState = {
    ...buildingFixture,
    humans: Object.fromEntries(
      Object.entries(humans).map(([id, h]) => [
        id,
        { ...humanFixture, sessionId: id, operationId: LOBBY_OPERATION_ID, ...h },
      ]),
    ),
  };
  useBuildingStore.setState({ state, sessionId: self });
}

const as = (role: "member" | "admin" | "viewer") =>
  useSessionStore.setState({
    status: "authenticated",
    user: { id: "u-me", displayName: "Me", role },
    error: null,
  } as never);

beforeEach(() => {
  calls.length = 0;
  useMediaStore.getState().reset();
  useUiStore.getState().updateSettings({ pushToTalk: false });
  building({ "s-me": { userId: "u-me", displayName: "Me" } });
  as("member");
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe("without media", () => {
  test("no voice or share controls; settings explain how to turn them on", async () => {
    useMediaStore.getState().setStatus({ enabled: false, canPublish: false });
    mounted = await mount(
      <>
        <MediaStrip />
        <VoiceSettings />
      </>,
    );
    expect(document.querySelector('[data-testid="media-strip"]')).toBeNull();
    expect(button("Share screen")).toBeUndefined();
    expect(button("Mic on")).toBeUndefined();
    expect(text()).toContain("Not set up on this office");
    expect(text()).toContain("scripts/setup.sh --media");
  });

  test("nothing at all before the office answered", async () => {
    mounted = await mount(<MediaStrip />);
    expect(document.querySelector('[data-testid="media-strip"]')).toBeNull();
  });
});

describe("with media", () => {
  beforeEach(() => {
    useMediaStore.getState().setStatus({ enabled: true, canPublish: true });
    useMediaStore.getState().setConnection("connected", null);
    useMediaStore.getState().setController(controller);
  });

  test("a member turns the mic on, mutes, and shares the screen", async () => {
    mounted = await mount(<MediaStrip />);
    expect(text()).toContain("Voice");
    await click(button("Mic on") as HTMLButtonElement);
    expect(calls).toEqual(["mic:true"]);
    act(() =>
      useMediaStore.getState().setVoices({ "s-me": { mic: "on", speaking: false, level: 0 } }),
    );
    await click(button("Mute mic") as HTMLButtonElement);
    expect(calls.at(-1)).toBe("mic:false");
    await click(button("Share screen") as HTMLButtonElement);
    expect(calls.at(-1)).toBe("share");
  });

  test("someone else on the TV: watch it; our own share: stop it", async () => {
    building({
      "s-me": { userId: "u-me", displayName: "Me" },
      "s-ada": { userId: "u-ada", displayName: "Ada", sharingScreen: true },
    });
    useMediaStore.getState().setScreen({ sessionId: "s-ada", track: {} as MediaStreamTrack });
    mounted = await mount(<MediaStrip />);
    expect(button("Share screen")).toBeUndefined();
    await click(button("Watch Ada") as HTMLButtonElement);
    expect(useMediaStore.getState().tvOpen).toBe(true);
    act(() =>
      building({
        "s-me": { userId: "u-me", displayName: "Me", sharingScreen: true },
      }),
    );
    await click(button("Stop sharing") as HTMLButtonElement);
    expect(calls.at(-1)).toBe("stop");
  });

  test("viewers listen and watch, but get no mic or share buttons", async () => {
    as("viewer");
    useMediaStore.getState().setStatus({ enabled: true, canPublish: false });
    mounted = await mount(
      <>
        <MediaStrip />
        <VoiceSettings />
      </>,
    );
    expect(text()).toContain("Listening");
    expect(button("Mic on")).toBeUndefined();
    expect(button("Share screen")).toBeUndefined();
    expect(text()).toContain("Viewers hear voices nearby");
  });

  test("push-to-talk: the button says hold M", () => {
    expect(micLabel("none", false, false)).toBe("Mic on");
    expect(micLabel("on", false, false)).toBe("Mute mic");
    expect(micLabel("muted", false, false)).toBe("Unmute mic");
    expect(micLabel("muted", true, false)).toBe("Hold M to talk");
    expect(micLabel("on", true, true)).toBe("Talking");
  });

  test("sitting on the sofa with a share on opens the TV; standing up closes it", async () => {
    building({
      "s-me": { userId: "u-me", displayName: "Me" },
      "s-ada": { userId: "u-ada", displayName: "Ada", sharingScreen: true },
    });
    useMediaStore.getState().setScreen({ sessionId: "s-ada", track: {} as MediaStreamTrack });
    mounted = await mount(<TvOverlay />);
    expect(useMediaStore.getState().tvOpen).toBe(false);
    await act(async () =>
      building({
        "s-me": {
          userId: "u-me",
          displayName: "Me",
          seatId: seatKey(LOBBY_OPERATION_ID, "sofa-1"),
        },
        "s-ada": { userId: "u-ada", displayName: "Ada", sharingScreen: true },
      }),
    );
    expect(useMediaStore.getState().tvOpen).toBe(true);
    expect(text()).toContain("Lounge TV: Ada's screen");
    expect(document.querySelector('[data-testid="tv-video"]')).not.toBeNull();
    // A member cannot take Ada's screen off; an admin could.
    expect(button("Take it off the TV")).toBeUndefined();
    await act(async () =>
      building({
        "s-me": { userId: "u-me", displayName: "Me" },
        "s-ada": { userId: "u-ada", displayName: "Ada", sharingScreen: true },
      }),
    );
    expect(useMediaStore.getState().tvOpen).toBe(false);
  });

  test("an admin can take someone else's screen off the TV", async () => {
    as("admin");
    building({
      "s-me": { userId: "u-me", displayName: "Me" },
      "s-ada": { userId: "u-ada", displayName: "Ada", sharingScreen: true },
    });
    useMediaStore.getState().setScreen({ sessionId: "s-ada", track: {} as MediaStreamTrack });
    useMediaStore.getState().openTv();
    mounted = await mount(<TvOverlay />);
    await click(button("Take it off the TV") as HTMLButtonElement);
    expect(calls).toEqual(["stopOf:s-ada"]);
  });
});

describe("badges over heads", () => {
  test("muted mic, or on the TV", () => {
    expect(voiceBadgeKind(undefined, false)).toBeNull();
    expect(voiceBadgeKind("none", false)).toBeNull();
    expect(voiceBadgeKind("on", false)).toBeNull();
    expect(voiceBadgeKind("muted", false)).toBe("muted");
    expect(voiceBadgeKind("muted", true)).toBe("sharing");
  });
});
