/**
 * Modal layout (#149): the frame never scrolls or clips, so the round X is
 * whole; only the body scrolls, vertically; long words and wide children
 * cannot push the dialog sideways. Happy DOM has no layout engine, so this
 * checks the structure and the cascade from the real stylesheet; the e2e
 * step (tests/e2e/office.e2e.ts) measures real boxes in Chromium.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mount, useDom } from "../a11y/dom.ts";
import { Button } from "./Button.tsx";
import { Modal } from "./Modal.tsx";

useDom();

const css = readFileSync(new URL("../components.css", import.meta.url), "utf8");
let sheet: HTMLStyleElement;
beforeAll(() => {
  sheet = document.createElement("style");
  sheet.textContent = css;
  document.head.append(sheet);
});
afterAll(() => sheet.remove());

const LONG_WORD = "a".repeat(400);

async function openDialog() {
  const m = await mount(
    <Modal
      open
      onClose={() => {}}
      title={`Floor settings ${LONG_WORD}`}
      footer={<Button variant="primary">Done</Button>}
    >
      <p>{LONG_WORD}</p>
      <pre>{`${LONG_WORD} ${LONG_WORD}`}</pre>
      <input aria-label="wide" style={{ width: 2000 }} />
      {Array.from({ length: 30 }, (_, i) => (
        <p key={i}>Row {i}</p>
      ))}
    </Modal>,
  );
  const dialog = document.querySelector("[role=dialog]") as HTMLElement;
  const part = (cls: string) => dialog.querySelector(`:scope > .${cls}`) as HTMLElement;
  return {
    m,
    dialog,
    close: part("rg-modal__close"),
    title: part("rg-modal__title"),
    body: part("rg-modal__body"),
    footer: part("rg-modal__footer"),
  };
}

describe("Modal layout", () => {
  test("the frame does not scroll or clip, so nothing overflows it sideways", async () => {
    const { m, dialog } = await openDialog();
    const style = getComputedStyle(dialog);
    // No `overflow: auto/hidden/clip` on the frame: that is what clipped the X
    // and gave the frame its own scrollbars.
    expect(style.overflow).toBe("visible");
    expect(style.display).toBe("flex");
    expect(style.flexDirection).toBe("column");
    await m.unmount();
  });

  test("the close button sits in the frame, outside the scrolling body", async () => {
    const { m, dialog, close, body } = await openDialog();
    expect(close).not.toBeNull();
    expect(close.getAttribute("aria-label")).toBe("Close");
    expect(close.parentElement).toBe(dialog);
    expect(body.contains(close)).toBe(false);
    expect(getComputedStyle(close).position).toBe("absolute");
    await m.unmount();
  });

  test("only the body scrolls, vertically, between a fixed title and footer", async () => {
    const { m, title, body, footer } = await openDialog();
    const b = getComputedStyle(body);
    expect(b.overflowY).toBe("auto");
    expect(b.overflowX).toBe("hidden");
    expect(Number.parseFloat(b.minHeight)).toBe(0);
    expect(Number.parseFloat(b.minWidth)).toBe(0);
    expect(b.overflowWrap).toBe("break-word");
    expect(getComputedStyle(title).flexShrink).toBe("0");
    expect(getComputedStyle(footer).flexShrink).toBe("0");
    expect(getComputedStyle(title).overflowWrap).toBe("anywhere");
    await m.unmount();
  });

  test("wide children are capped at the body width and preformatted text wraps", async () => {
    const { m, body } = await openDialog();
    const input = body.querySelector("input") as HTMLElement;
    const pre = body.querySelector("pre") as HTMLElement;
    expect(getComputedStyle(input).maxWidth).toBe("100%");
    expect(getComputedStyle(pre).maxWidth).toBe("100%");
    expect(getComputedStyle(pre).whiteSpace).toBe("pre-wrap");
    await m.unmount();
  });
});
