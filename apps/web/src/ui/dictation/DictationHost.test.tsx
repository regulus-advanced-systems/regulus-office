import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { click, type Mounted, mount, useDom } from "../a11y/dom.ts";
import { helpBindings } from "../hotkeys/HotkeyHelp.tsx";
import { FakeHost } from "../terminal/fakeHost.ts";
import { DictationController } from "./controller.ts";
import { DictationHost, phaseLabel, pillPosition } from "./DictationHost.tsx";
import { DictationSettings } from "./DictationSettings.tsx";
import { DEFAULT_DICTATION_PREFS, useDictationStore } from "./dictationStore.ts";
import { ENGINE_AUDIO } from "./engine.ts";
import { fakeEngines } from "./fakeEngine.ts";
import { useDictationTerminal } from "./useDictationTerminal.ts";

useDom();

let engines: ReturnType<typeof fakeEngines>;
let controller: DictationController;
let mounted: Mounted | null = null;

beforeEach(() => {
  engines = fakeEngines();
  controller = new DictationController({ engines, browserLang: () => "en-US" });
  useDictationStore.setState({
    prefs: { ...DEFAULT_DICTATION_PREFS, introSeen: true },
    phase: "idle",
    interim: "",
    notice: null,
    recordingAt: null,
    voicePaused: false,
  });
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

const q = <T extends HTMLElement>(testId: string) =>
  document.querySelector(`[data-testid="${testId}"]`) as T | null;
const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

async function focus(el: HTMLElement | null) {
  await act(async () => el?.focus());
  await tick();
}

/** Ctrl+Space as the browser sends it, on whatever has focus. */
async function key(type: "keydown" | "keyup", init: KeyboardEventInit = {}) {
  const event = new window.KeyboardEvent(type, {
    key: " ",
    code: "Space",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  const seen: string[] = [];
  const target = document.activeElement ?? document.body;
  const spy = () => void seen.push("target");
  target.addEventListener(type, spy);
  await act(async () => {
    target.dispatchEvent(event);
  });
  target.removeEventListener(type, spy);
  await tick();
  return { prevented: event.defaultPrevented, reachedTarget: seen.length > 0 };
}

function Page({ readOnly = false, host }: { readOnly?: boolean; host?: FakeHost }) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  useDictationTerminal(box, host ?? null, readOnly);
  return (
    <>
      <input type="text" data-testid="prompt" />
      <input type="password" data-testid="secret" />
      <button type="button" data-testid="other">
        Other
      </button>
      <div ref={setBox} data-testid="term">
        <textarea data-testid="term-focus" />
      </div>
      <DictationHost controller={controller} />
    </>
  );
}

describe("the mic button", () => {
  test("stands by a focused text box and nowhere else", async () => {
    mounted = await mount(<Page />);
    expect(q("dictation-mic")).toBeNull();
    await focus(q("prompt"));
    expect(q("dictation-mic")).not.toBeNull();
    expect(q("dictation-mic")?.tabIndex).toBe(-1);
    await focus(q("secret"));
    expect(q("dictation-mic")).toBeNull();
    await focus(q("other"));
    expect(q("dictation-mic")).toBeNull();
  });

  test("held: listens; let go: stops; the words are in the box", async () => {
    mounted = await mount(<Page />);
    const prompt = q<HTMLInputElement>("prompt");
    await focus(prompt);
    const mic = q("dictation-mic") as HTMLElement;
    await act(async () => {
      mic.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    await tick();
    expect(q("dictation-indicator")?.textContent).toContain("Listening");
    expect(mic.getAttribute("aria-pressed")).toBe("true");
    await act(async () => engines.local.say("hello there"));
    await act(async () => {
      mic.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true }));
    });
    expect(engines.local.stops).toBe(1);
    expect(q("dictation-indicator")).toBeNull();
    expect(prompt?.value).toBe("hello there");
  });
});

describe("Ctrl+Space", () => {
  test("in a text box: a clear indicator while held, text on the way, nothing after", async () => {
    mounted = await mount(<Page />);
    const prompt = q<HTMLInputElement>("prompt");
    await focus(prompt);
    const down = await key("keydown");
    expect(down).toEqual({ prevented: true, reachedTarget: false });
    expect(engines.local.starts).toEqual(["en-US"]);
    expect(q("dictation-pill")?.dataset.phase).toBe("listening");
    expect(q("dictation-indicator")?.getAttribute("role")).toBe("status");

    await act(async () => engines.local.hear("spawn a"));
    expect(q("dictation-interim")?.textContent).toBe("spawn a");
    await act(async () => engines.local.say("spawn a henchman"));
    expect(prompt?.value).toBe("spawn a henchman");
    expect(q("dictation-interim")).toBeNull();

    const up = await key("keyup");
    expect(up.reachedTarget).toBe(false);
    expect(engines.local.listening).toBe(false);
    expect(q("dictation-indicator")).toBeNull();
    expect(useDictationStore.getState().phase).toBe("idle");
  });

  test("with nothing to dictate into, the key is the page's", async () => {
    mounted = await mount(<Page />);
    expect(await key("keydown")).toEqual({ prevented: false, reachedTarget: true });
    await focus(q("secret"));
    expect(await key("keydown")).toEqual({ prevented: false, reachedTarget: true });
    await focus(q("other"));
    expect(await key("keydown")).toEqual({ prevented: false, reachedTarget: true });
    expect(engines.local.starts).toEqual([]);
    expect(q("dictation-notice")).toBeNull();
  });

  test("the first time: where the audio goes, before any recording", async () => {
    useDictationStore.setState({ prefs: { ...DEFAULT_DICTATION_PREFS } });
    mounted = await mount(<Page />);
    await focus(q("prompt"));
    await key("keydown");
    expect(q("dictation-notice")?.dataset.kind).toBe("intro");
    expect(q("dictation-notice")?.textContent).toContain(ENGINE_AUDIO.local);
    expect(engines.local.starts).toEqual([]);
    await key("keyup");
    await click(q("dictation-intro-ok") as HTMLElement);
    expect(q("dictation-notice")).toBeNull();
    await key("keydown");
    expect(engines.local.starts.length).toBe(1);
  });

  test("no on-device engine: the online service is named, and used only after the click", async () => {
    engines.local.available = "unavailable";
    mounted = await mount(<Page />);
    await focus(q("prompt"));
    await key("keydown");
    await key("keyup");
    expect(q("dictation-notice")?.dataset.kind).toBe("local-unavailable");
    expect(q("dictation-notice")?.textContent).toContain(ENGINE_AUDIO.vendor);
    expect(engines.vendor.starts).toEqual([]);
    await click(q("dictation-use-vendor") as HTMLElement);
    await key("keydown");
    expect(engines.vendor.starts).toEqual(["en-US"]);
  });

  test("the window losing focus stops the recording", async () => {
    mounted = await mount(<Page />);
    await focus(q("prompt"));
    await key("keydown");
    expect(engines.local.listening).toBe(true);
    await act(async () => {
      window.dispatchEvent(new window.Event("blur"));
    });
    expect(engines.local.listening).toBe(false);
  });

  test("leaving the page stops the recording", async () => {
    mounted = await mount(<Page />);
    await focus(q("prompt"));
    await key("keydown");
    await mounted.unmount();
    mounted = null;
    expect(engines.local.listening).toBe(false);
    expect(engines.local.aborts).toBe(1);
  });
});

describe("a terminal", () => {
  test("in control: the words go in as typed input, never Enter", async () => {
    const host = new FakeHost();
    host.setReadOnly(false);
    const sent: string[] = [];
    host.onData((d) => sent.push(d));
    mounted = await mount(<Page host={host} />);
    await focus(q("term-focus"));
    expect(q("dictation-mic")).not.toBeNull();
    expect(await key("keydown")).toEqual({ prevented: true, reachedTarget: false });
    await act(async () => engines.local.say("run the tests\n"));
    await key("keyup");
    expect(sent).toEqual(["run the tests"]);
  });

  test("watching only: no mic button, the key says why, nothing is recorded or typed", async () => {
    const host = new FakeHost();
    const sent: string[] = [];
    host.onData((d) => sent.push(d));
    mounted = await mount(<Page host={host} readOnly />);
    await focus(q("term-focus"));
    expect(q("dictation-mic")).toBeNull();
    await key("keydown");
    expect(q("dictation-notice")?.dataset.kind).toBe("watch-only");
    expect(engines.local.starts).toEqual([]);
    expect(sent).toEqual([]);
  });

  test("control granted while focused: the mic button appears", async () => {
    const host = new FakeHost();
    mounted = await mount(<Page host={host} readOnly />);
    await focus(q("term-focus"));
    expect(q("dictation-mic")).toBeNull();
    await mounted.rerender(<Page host={host} />);
    await tick();
    expect(q("dictation-mic")).not.toBeNull();
  });
});

describe("settings", () => {
  test("off: no mic button and the key is left alone", async () => {
    mounted = await mount(
      <>
        <Page />
        <DictationSettings />
      </>,
    );
    await focus(q("prompt"));
    expect(q("dictation-mic")).not.toBeNull();
    await click(document.querySelector('[role="switch"]') as HTMLElement);
    expect(useDictationStore.getState().prefs.enabled).toBe(false);
    expect(q("dictation-engines")).toBeNull();
    await focus(q("prompt"));
    expect(q("dictation-mic")).toBeNull();
    expect((await key("keydown")).prevented).toBe(false);
  });

  test("both engines are described where they are chosen; on this computer is the default", async () => {
    useDictationStore.setState({ prefs: { ...DEFAULT_DICTATION_PREFS } });
    mounted = await mount(<DictationSettings />);
    const text = q("dictation-engines")?.textContent ?? "";
    expect(text).toContain(ENGINE_AUDIO.local);
    expect(text).toContain(ENGINE_AUDIO.vendor);
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.map((r) => [r.value, r.checked])).toEqual([
      ["local", true],
      ["vendor", false],
    ]);
    await click(radios[1] as HTMLElement);
    expect(useDictationStore.getState().prefs.engine).toBe("vendor");
  });
});

describe("bits", () => {
  test("the shortcut is in the help while the HUD is up", async () => {
    mounted = await mount(<Page />);
    expect(helpBindings().find((b) => b.id === "dictation")?.key).toBe("Ctrl+Space");
    await mounted.unmount();
    mounted = null;
    expect(helpBindings().some((b) => b.id === "dictation")).toBe(false);
  });

  test("the pill sits above a small box and inside the corner of a tall one", () => {
    expect(pillPosition({ top: 700, right: 400, height: 32 })).toEqual({
      left: 400,
      top: 694,
      transform: "translate(-100%, -100%)",
    });
    expect(pillPosition({ top: 100, right: 900, height: 480 })).toEqual({
      left: 892,
      top: 108,
      transform: "translate(-100%, 0)",
    });
    // Never off the top of the window.
    expect(pillPosition({ top: 10, right: 400, height: 32 }).top).toBe(36);
  });

  test("each phase has its words", () => {
    expect(phaseLabel("starting")).toContain("Starting");
    expect(phaseLabel("listening")).toContain("Let go");
    expect(phaseLabel("finishing")).toContain("Finishing");
    expect(phaseLabel("idle")).toBe("");
  });
});
