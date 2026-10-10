import { afterEach, describe, expect, test } from "bun:test";
import { BUZZ_MS, type BuildingState, JITTER_CUPS } from "@regulus/protocol";
import { act } from "react";
import { useBuildingStore } from "../../state/building.ts";
import { mount, useDom } from "../a11y/dom.ts";
import { BuzzMeter } from "./BuzzMeter.tsx";

useDom();

const UNTIL = 2_000_000;
const buzzed = (cups: number, buzzUntil = UNTIL) =>
  act(async () =>
    useBuildingStore.setState({
      sessionId: "me",
      state: {
        humans: { me: { cups, buzzUntil }, you: { cups: 5, buzzUntil } },
      } as unknown as BuildingState,
    }),
  );

afterEach(async () => {
  await act(async () => useBuildingStore.getState().clear());
});

describe("BuzzMeter", () => {
  test("draws nothing without a buzz, whatever anyone else drank", async () => {
    await buzzed(0, 0);
    const m = await mount(<BuzzMeter now={() => UNTIL - BUZZ_MS} />);
    expect(document.querySelector(".rg-buzz")).toBeNull();
    await m.unmount();
  });

  test("shows the cups, the boost, the time left and a bar; it goes when the buzz ends", async () => {
    await buzzed(2);
    const m = await mount(<BuzzMeter now={() => UNTIL - 30_000} />);
    const meter = document.querySelector(".rg-buzz") as HTMLElement;
    expect(meter.getAttribute("aria-label")).toBe("Coffee buzz");
    expect(meter.querySelectorAll(".rg-buzz__cup--full")).toHaveLength(2);
    expect(meter.querySelector(".rg-buzz__text")?.textContent).toBe("+25% speed");
    expect(meter.querySelector(".rg-buzz__time")?.textContent).toBe("30 s");
    const bar = meter.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    expect(bar.getAttribute("aria-label")).toBe("Coffee buzz: 2 cups, 25% faster, 30 seconds left");
    expect((meter.querySelector(".rg-buzz__fill") as HTMLElement).style.width).toBe("50.0%");
    expect(meter.querySelector(".rg-buzz__jitters")).toBeNull();

    // The server ended the buzz: the meter is gone at once.
    await buzzed(0, 0);
    expect(document.querySelector(".rg-buzz")).toBeNull();
    await m.unmount();
  });

  test("says Jitters from the third cup", async () => {
    await buzzed(JITTER_CUPS);
    const m = await mount(<BuzzMeter now={() => UNTIL - BUZZ_MS} />);
    expect(document.querySelector(".rg-buzz__jitters")?.textContent).toContain("Jitters");
    expect(document.querySelector('[role="progressbar"]')?.getAttribute("aria-label")).toContain(
      "jitters",
    );
    await m.unmount();
  });
});
