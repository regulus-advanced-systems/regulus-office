import { afterEach, describe, expect, test } from "bun:test";
import type { OperationState } from "@regulus/protocol";
import { henchmanFixture } from "@regulus/protocol/src/fixtures.ts";
import { deskSeats, smallTemplate } from "@regulus/room-layout";
import { hasHenchmanOverride, useHenchmanOverrides } from "../../../state/henchmanOverrides.ts";
import { useOperationStore } from "../../../state/operation.ts";
import {
  activeSendHomes,
  henchmanSnapshot,
  resetSendHome,
  startSendHome,
  tickSendHome,
  watchRemovedHenchmen,
} from "./controller.ts";

const seatId = deskSeats(smallTemplate)[0]?.id ?? "";
const henchman = { ...henchmanFixture, agentId: "a1", seatId };
const operationWith = (henchmen: Record<string, typeof henchman>) =>
  ({ operationId: "f1", henchmen }) as unknown as OperationState;

afterEach(() => {
  resetSendHome();
  useOperationStore.getState().clear();
});

describe("send-home controller", () => {
  test("a henchman walks out through an override that clears when it is gone", () => {
    expect(startSendHome("a1", { reducedMotion: false, template: smallTemplate, henchman })).toBe(
      true,
    );
    expect(hasHenchmanOverride("a1")).toBe(true);
    const override = useHenchmanOverrides.getState().overrides.a1;
    expect(override?.henchman.agentId).toBe("a1");
    const start = { ...override?.pose };
    tickSendHome(2);
    expect(useHenchmanOverrides.getState().overrides.a1?.carrying).toBe(true);
    expect(override?.pose).not.toEqual(start);
    for (let i = 0; i < 400 && activeSendHomes().length > 0; i++) tickSendHome(0.1);
    expect(hasHenchmanOverride("a1")).toBe(false);
  });

  test("reduced motion, no scene or no henchman: nothing to animate", () => {
    expect(startSendHome("a1", { reducedMotion: true, template: smallTemplate, henchman })).toBe(
      false,
    );
    expect(startSendHome("a1", { reducedMotion: false, henchman })).toBe(false);
    expect(startSendHome("zz", { reducedMotion: false, template: smallTemplate })).toBe(false);
    expect(hasHenchmanOverride("a1")).toBe(false);
  });

  test("henchmen removed from the operation state are remembered for a late leaving notice", () => {
    const off = watchRemovedHenchmen();
    useOperationStore.getState().apply(operationWith({ a1: henchman }));
    expect(henchmanSnapshot("a1")?.seatId).toBe(seatId);
    useOperationStore.getState().apply(operationWith({}));
    expect(henchmanSnapshot("a1")?.agentId).toBe("a1");
    expect(startSendHome("a1", { reducedMotion: false, template: smallTemplate })).toBe(true);
    off();
  });
});
