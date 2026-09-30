/**
 * #164: when the async Clipboard API is missing or refused, copyText falls back to
 * execCommand("copy"): first a copy listener that hands over the text, then a hidden
 * textarea inside the given container (a dialog's focus trap must not steal its focus).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { useDom } from "../a11y/dom.ts";
import { copyText, copyWithCommand } from "./clipboard.ts";

useDom();

const refused = {
  writeText: async () => {
    throw new DOMException("Write permission denied.", "NotAllowedError");
  },
};

type Exec = (doc: Document) => boolean;
const realExec = () => document.execCommand;
let restore: (() => void) | null = null;
function stubExec(run: Exec) {
  const original = realExec();
  document.execCommand = ((command: string) => command === "copy" && run(document)) as never;
  restore = () => {
    document.execCommand = original;
  };
}
afterEach(() => {
  restore?.();
  restore = null;
  document.body.innerHTML = "";
});

/** Dispatches the copy event a browser would, with a clipboardData that records the text. */
function fireCopy(doc: Document, target: EventTarget = doc.body): { data: string | null } {
  const out = { data: null as string | null };
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { setData: (_type: string, text: string) => void (out.data = text) },
  });
  target.dispatchEvent(event);
  return out;
}

describe("copy fallback", () => {
  test("a refused writeText falls back to the copy command, which carries the text", async () => {
    const seen = { copied: null as string | null };
    let xtermSaw = false;
    const xterm = document.createElement("div");
    document.body.appendChild(xterm);
    // xterm's own copy handler (on its element) must not replace the text.
    xterm.addEventListener("copy", () => {
      xtermSaw = true;
    });
    stubExec((doc) => {
      doc.dispatchEvent(new Event("beforecopy", { cancelable: true }));
      seen.copied = fireCopy(doc, xterm).data;
      return true;
    });
    expect(await copyText("npm test\nall green", refused)).toBe(true);
    expect(seen.copied).toBe("npm test\nall green");
    expect(xtermSaw).toBe(false);
  });

  test("no Clipboard API at all (plain http) uses the copy command too", async () => {
    const seen = { copied: null as string | null };
    stubExec((doc) => {
      seen.copied = fireCopy(doc).data;
      return true;
    });
    expect(await copyText("hello", {})).toBe(true);
    expect(seen.copied).toBe("hello");
  });

  test("Chromium enables Copy without a selection only when beforecopy is cancelled", () => {
    let enabled = false;
    stubExec((doc) => {
      const before = new Event("beforecopy", { cancelable: true });
      doc.dispatchEvent(before);
      enabled = before.defaultPrevented;
      if (enabled) fireCopy(doc);
      return enabled;
    });
    expect(copyWithCommand("x")).toBe(true);
    expect(enabled).toBe(true);
  });

  test("without a copy event, a hidden textarea in the container is copied and removed", () => {
    const dialog = document.createElement("div");
    const button = document.createElement("button");
    dialog.appendChild(button);
    document.body.appendChild(dialog);
    button.focus();
    let selectedText = "";
    let parent: Node | null = null;
    stubExec((doc) => {
      const area = doc.activeElement as HTMLTextAreaElement | null;
      if (area?.tagName !== "TEXTAREA") return false;
      parent = area.parentNode;
      selectedText = area.value.slice(area.selectionStart, area.selectionEnd);
      return true;
    });
    expect(copyWithCommand("https://example.com/x", { container: dialog })).toBe(true);
    expect(selectedText).toBe("https://example.com/x");
    expect(parent === dialog).toBe(true);
    expect(dialog.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  test("a focus trap that pulls focus out of the textarea is a failure, not a false Copied", () => {
    const trapTarget = document.createElement("button");
    document.body.appendChild(trapTarget);
    const onFocusIn = (event: FocusEvent) => {
      if (event.target !== trapTarget) trapTarget.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    // The browser "succeeds" but copies nothing useful: the old bug showed Copied here.
    stubExec(() => true);
    try {
      expect(copyWithCommand("lost")).toBe(false);
    } finally {
      document.removeEventListener("focusin", onFocusIn);
    }
  });

  test("the browser refusing the copy command too is a failure", async () => {
    stubExec(() => false);
    expect(await copyText("nope", refused)).toBe(false);
    stubExec(() => {
      throw new Error("SecurityError");
    });
    expect(await copyText("nope", refused)).toBe(false);
    expect(await copyText("", refused)).toBe(false);
  });
});
