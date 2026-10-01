import { describe, expect, test } from "bun:test";
import type { RoomSettingsInfo } from "@regulus/protocol";
import { act } from "react";
import { useRoomDraftStore } from "../../scene/compound/build/preview.ts";
import { click, mount, press, useDom } from "../a11y/dom.ts";
import { fakeFetch } from "../auth/fakeFetch.ts";
import { button, settle, text } from "../auth/testDom.tsx";
import { createRoomSettingsApi } from "./api.ts";
import { RoomSettingsDock, useRoomSettingsDock } from "./RoomSettingsDock.tsx";
import { RoomSettingsPanel } from "./RoomSettingsPanel.tsx";

useDom();

const PATH = "/api/floors/f1/room-settings";
const INFO: RoomSettingsInfo = {
  floorId: "f1",
  deskCount: 2,
  decorStyle: "ops_room",
  size: { width: 6, depth: 6, doorSide: "south" },
  maxDeskCount: 2,
  occupiedDesks: [2],
  generated: true,
  canManage: true,
};

const select = (label: string) => {
  const el = [...document.querySelectorAll("label")].find((l) => l.textContent === label);
  return document.getElementById(el?.htmlFor ?? "") as HTMLSelectElement;
};

async function change(el: HTMLSelectElement, value: string) {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("room settings panel", () => {
  test("a manager sees the capacity, cannot drop an occupied desk, and saves a style", async () => {
    const { fetch, calls } = fakeFetch({
      [`GET ${PATH}`]: { body: INFO },
      [`PUT ${PATH}`]: (call) => ({ body: { ...INFO, ...(call.body as object) } }),
    });
    const ui = await mount(
      <RoomSettingsPanel floorId="f1" api={createRoomSettingsApi({ fetch })} />,
    );
    await settle();
    expect(text()).toContain("This 6×6 room fits up to 2 desks.");
    expect(text()).toContain("Henchmen are working at desk 2");
    const desks = select("Desks (4 seats each)");
    expect([...desks.options].map((o) => [o.value, o.disabled])).toEqual([
      ["1", true],
      ["2", false],
    ]);
    expect(button("Save")?.disabled).toBe(true);
    await change(select("Decor style"), "war_room");
    expect(text()).toContain("red beacon");
    const save = button("Save");
    if (!save) throw new Error("no save button");
    await click(save);
    await settle();
    expect(calls.at(-1)).toMatchObject({ method: "PUT", body: { decorStyle: "war_room" } });
    await ui.unmount();
  });

  test("viewers get a read-only panel; refusals are worded", async () => {
    const { fetch } = fakeFetch({
      [`GET ${PATH}`]: { body: { ...INFO, canManage: false, generated: false, occupiedDesks: [] } },
    });
    const ui = await mount(
      <RoomSettingsPanel floorId="f1" api={createRoomSettingsApi({ fetch })} />,
    );
    await settle();
    expect(select("Desks (4 seats each)").disabled).toBe(true);
    expect(select("Decor style").disabled).toBe(true);
    expect(button("Save")).toBeUndefined();
    expect(text()).toContain("Desks can change once this room uses the new room layout.");
    await ui.unmount();

    const refused = fakeFetch({
      [`PUT ${PATH}`]: { status: 409, body: { error: "desks_occupied", desks: [3] } },
    });
    const res = await createRoomSettingsApi({ fetch: refused.fetch }).update("f1", {
      deskCount: 1,
    });
    expect(res).toEqual({
      ok: false,
      status: 409,
      code: "desks_occupied",
      maxDeskCount: undefined,
      desks: [3],
    });
  });

  test("docked: every unsaved change is previewed in the room; closing drops the preview", async () => {
    const { fetch } = fakeFetch({
      [`GET ${PATH}`]: { body: { ...INFO, maxDeskCount: 4, occupiedDesks: [] } },
    });
    const ui = await mount(<RoomSettingsDock api={createRoomSettingsApi({ fetch })} />);
    await act(async () => useRoomSettingsDock.getState().open("f1"));
    await settle();
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("false");
    expect(useRoomDraftStore.getState().draft).toEqual({
      floorId: "f1",
      deskCount: 2,
      decorStyle: "ops_room",
    });
    await change(select("Desks (4 seats each)"), "4");
    expect(useRoomDraftStore.getState().draft?.deskCount).toBe(4);
    expect(text()).toContain("The room shows your changes; save to keep them.");
    await press(document.querySelector('[role="dialog"]') as Element, "Escape");
    expect(useRoomSettingsDock.getState().floorId).toBeNull();
    expect(useRoomDraftStore.getState().draft).toBeNull();
    await ui.unmount();
  });
});
