import { describe, expect, test } from "bun:test";
import { lobbyTemplate, officeL2Template, smallTemplate } from "@regulus/floor-layout";
import type { FloorInfo } from "@regulus/protocol";
import { floorViewFor, LOBBY_VIEW } from "./floorView.ts";

const info = (over: Partial<FloorInfo> = {}): FloorInfo => ({
  floorId: "f1",
  name: "Apollo",
  slug: "apollo",
  index: 2,
  paletteId: "lime-mustard",
  layoutTemplateId: smallTemplate.id,
  archivedAt: null,
  access: "view",
  repos: [],
  ...over,
});

describe("floorViewFor", () => {
  test("the lobby when on no floor or nothing is known yet", () => {
    expect(floorViewFor(null, null, undefined)).toBe(LOBBY_VIEW);
    expect(floorViewFor("f1", null, undefined)).toBe(LOBBY_VIEW);
    expect(LOBBY_VIEW.template).toBe(lobbyTemplate);
  });

  test("a floor's own template, palette and name", () => {
    const view = floorViewFor("f1", null, info());
    expect(view.key).toBe("floor:f1");
    expect(view.template).toBe(smallTemplate);
    expect(view.palette?.id).toBe("lime-mustard");
    expect(view.floorName).toBe("Apollo");
  });

  test("unknown templates fall back to Office L2; never the lobby template", () => {
    expect(floorViewFor("f1", null, info({ layoutTemplateId: "gone" })).template).toBe(
      officeL2Template,
    );
    expect(floorViewFor("f1", null, info({ layoutTemplateId: "lobby" })).template).toBe(
      officeL2Template,
    );
    expect(floorViewFor("f1", null, info({ paletteId: "gone" })).palette?.id).toBe("lime-mustard");
  });
});
