import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { type Mounted, mount, useDom } from "../a11y/dom.ts";
import { FakeHost } from "../terminal/fakeHost.ts";
import {
  cleanTranscript,
  insertIntoField,
  needsSpace,
  registerDictationTerminal,
  resolveTarget,
} from "./targets.ts";

useDom();

let mounted: Mounted | null = null;
const cleanups: Array<() => void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) c();
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

function add<T extends HTMLElement>(html: string): T {
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
  return wrap.firstElementChild as T;
}

function targetOf(el: Element) {
  const lookup = resolveTarget(el);
  if (!lookup || !("target" in lookup)) throw new Error("not a dictation target");
  return lookup.target;
}

describe("dictated text", () => {
  test("is one line of plain text: Enter and control characters never get through", () => {
    expect(cleanTranscript("  run the tests\n")).toBe("run the tests");
    expect(cleanTranscript("one\r\ntwo\tthree")).toBe("one two three");
    expect(cleanTranscript("rm -rf\u0003 \u001b[A now\u007f")).toBe("rm -rf [A now");
    expect(cleanTranscript("a b\u0085c")).toBe("a b c");
    expect(cleanTranscript("\n\n")).toBe("");
  });

  test("gets a space in front only where one is needed", () => {
    expect(needsSpace("", "hello")).toBe(false);
    expect(needsSpace("hello", "there")).toBe(true);
    expect(needsSpace("hello ", "there")).toBe(false);
    expect(needsSpace("hello", ", there")).toBe(false);
    expect(needsSpace("hello", "?")).toBe(false);
  });
});

describe("a text box", () => {
  test("takes the phrase at the caret, replacing the selection, and fires input", () => {
    const input = add<HTMLInputElement>('<input type="text" />');
    input.value = "fix bug today";
    input.setSelectionRange(4, 7);
    let inputs = 0;
    input.addEventListener("input", () => {
      inputs += 1;
    });
    insertIntoField(input, "the flaky test\n");
    expect(input.value).toBe("fix the flaky test today");
    expect(input.selectionStart).toBe(18);
    expect(inputs).toBe(1);
    insertIntoField(input, "please");
    expect(input.value).toBe("fix the flaky test please today");
  });

  test("never grows past its maxLength", () => {
    const input = add<HTMLInputElement>('<input type="text" maxlength="10" />');
    input.value = "12345";
    input.setSelectionRange(5, 5);
    insertIntoField(input, "and a lot more");
    expect(input.value).toBe("12345 and ");
    insertIntoField(input, "more");
    expect(input.value).toBe("12345 and ");
  });

  test("a controlled React field hears it through onChange", async () => {
    function Box() {
      const [value, setValue] = useState("");
      return (
        <>
          <textarea value={value} onChange={(e) => setValue(e.currentTarget.value)} />
          <output>{value}</output>
        </>
      );
    }
    mounted = await mount(<Box />);
    const area = mounted.container.querySelector("textarea") as HTMLTextAreaElement;
    // react-dom loaded before happy-dom registered: its keyup fallback reports the change
    // (in a browser the input event does; the office e2e dictates into a controlled field).
    const say = (phrase: string) =>
      act(async () => {
        area.focus();
        targetOf(area).insert(phrase);
        area.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true }));
      });
    await say("deploy to staging");
    await say("then tell me");
    expect(area.value).toBe("deploy to staging then tell me");
    expect(mounted.container.querySelector("output")?.textContent).toBe(
      "deploy to staging then tell me",
    );
  });

  test("which boxes: text and search inputs and textareas; nothing secret, locked or foreign", () => {
    const yes = (html: string) => expect(resolveTarget(add(html))).not.toBeNull();
    const no = (html: string) => expect(resolveTarget(add(html))).toBeNull();
    yes("<textarea></textarea>");
    yes("<input />");
    yes('<input type="text" />');
    yes('<input type="search" />');
    no('<input type="password" />');
    no('<input type="email" />');
    no('<input type="number" />');
    no('<input type="checkbox" />');
    no('<input type="text" readonly />');
    no("<textarea disabled></textarea>");
    no("<button>Send</button>");
    no('<div contenteditable="true"></div>');
    no("<select><option>a</option></select>");
    expect(resolveTarget(document.body)).toBeNull();
    expect(resolveTarget(null)).toBeNull();
    // The whiteboard's own text editor, and anything a panel opts out.
    const board = add('<div class="rg-whiteboard"><textarea></textarea></div>');
    expect(resolveTarget(board.querySelector("textarea"))).toBeNull();
    const off = add('<div data-dictation="off"><input type="text" /></div>');
    expect(resolveTarget(off.querySelector("input"))).toBeNull();
    // Gone from the page.
    const gone = add<HTMLInputElement>('<input type="text" />');
    gone.remove();
    expect(resolveTarget(gone)).toBeNull();
  });

  test("a box that is locked after the press takes nothing more", () => {
    const input = add<HTMLInputElement>('<input type="text" />');
    const target = targetOf(input);
    input.readOnly = true;
    expect(target.alive()).toBe(false);
    target.insert("nope");
    expect(input.value).toBe("");
  });
});

describe("a terminal", () => {
  /** An xterm as it stands in the page: the box, and the textarea that holds focus. */
  function terminal(readOnly: boolean) {
    const box = add<HTMLDivElement>(
      '<div class="rg-term__xterm"><div class="xterm"><textarea></textarea></div></div>',
    );
    const host = new FakeHost();
    host.setReadOnly(readOnly);
    const sent: string[] = [];
    host.onData((data) => sent.push(data));
    const state = { readOnly };
    cleanups.push(registerDictationTerminal(box, host, () => state.readOnly));
    return { box, host, sent, state, focus: box.querySelector("textarea") as HTMLElement };
  }

  test("one the person controls takes phrases as typed input, without Enter", () => {
    const t = terminal(false);
    const target = targetOf(t.focus);
    expect(target.kind).toBe("terminal");
    expect(target.element).toBe(t.box);
    target.insert("run the tests\n");
    target.insert("and fix what fails\r");
    expect(t.sent).toEqual(["run the tests", " and fix what fails"]);
    expect(t.sent.join("")).not.toMatch(/[\r\n]/);
  });

  test("a watched one is no target: it is blocked, and nothing can be typed", () => {
    const t = terminal(true);
    expect(resolveTarget(t.focus)).toEqual({ blocked: "watch-only" });
    expect(t.sent).toEqual([]);
  });

  test("control taken away mid-hold: the rest of the dictation goes nowhere", () => {
    const t = terminal(false);
    const target = targetOf(t.focus);
    target.insert("first");
    t.state.readOnly = true;
    t.host.setReadOnly(true);
    expect(target.alive()).toBe(false);
    target.insert("second");
    expect(t.sent).toEqual(["first"]);
  });

  test("the host's own read-only gate holds even if the page thinks it has control", () => {
    const t = terminal(false);
    t.host.setReadOnly(true);
    targetOf(t.focus).insert("sneaky");
    expect(t.sent).toEqual([]);
  });

  test("closed: no longer a target", () => {
    const t = terminal(false);
    const target = targetOf(t.focus);
    for (const c of cleanups.splice(0)) c();
    expect(target.alive()).toBe(false);
    target.insert("late");
    expect(t.sent).toEqual([]);
    // Its textarea alone is not a text box either (a laptop screen in the scene).
    expect(resolveTarget(t.focus)).toBeNull();
  });
});
