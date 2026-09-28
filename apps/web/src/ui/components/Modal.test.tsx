import { describe, expect, test } from "bun:test";
import { useState } from "react";
import { click, mount, press, useDom } from "../a11y/dom.ts";
import { Button } from "./Button.tsx";
import { Modal } from "./Modal.tsx";

useDom();

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button id="opener" onClick={() => setOpen(true)}>
        open
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Test dialog"
        footer={
          <Button id="ok" variant="primary" onClick={() => setOpen(false)}>
            OK
          </Button>
        }
      >
        <input id="field" aria-label="field" />
      </Modal>
    </>
  );
}

const active = () => document.activeElement?.id ?? document.activeElement?.tagName;

describe("Modal", () => {
  test("renders nothing when closed and a labelled dialog when open", async () => {
    const m = await mount(<Harness />);
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await click(document.getElementById("opener") as HTMLElement);
    const dialog = document.querySelector("[role=dialog]") as HTMLElement;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelledBy = dialog.getAttribute("aria-labelledby") ?? "";
    expect(document.getElementById(labelledBy)?.textContent).toBe("Test dialog");
    await m.unmount();
  });

  test("moves focus in, traps Tab in both directions, and restores focus on close", async () => {
    const m = await mount(<Harness />);
    const opener = document.getElementById("opener") as HTMLElement;
    opener.focus();
    await click(opener);
    const dialog = document.querySelector("[role=dialog]") as HTMLElement;
    // First focusable is the close button.
    expect((document.activeElement as HTMLElement).getAttribute("aria-label")).toBe("Close");
    await press(dialog, "Tab");
    expect(active()).toBe("field");
    await press(dialog, "Tab");
    expect(active()).toBe("ok");
    await press(dialog, "Tab");
    expect((document.activeElement as HTMLElement).getAttribute("aria-label")).toBe("Close");
    await press(dialog, "Tab", { shiftKey: true });
    expect(active()).toBe("ok");
    await press(dialog, "Escape");
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(active()).toBe("opener");
    await m.unmount();
  });

  test("the round X and the backdrop close it", async () => {
    const m = await mount(<Harness />);
    await click(document.getElementById("opener") as HTMLElement);
    await click(document.querySelector(".rg-modal__close") as HTMLElement);
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await click(document.getElementById("opener") as HTMLElement);
    const backdrop = document.querySelector(".rg-backdrop") as HTMLElement;
    await import("react").then(({ act }) =>
      act(async () => {
        backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      }),
    );
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await m.unmount();
  });
});
