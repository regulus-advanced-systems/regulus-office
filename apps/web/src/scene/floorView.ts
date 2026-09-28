/**
 * What the office canvas draws for the floor we are on (SPEC §9.1): the
 * lobby for floor 0, otherwise the floor's own template and palette with its
 * name on the exterior stub wall. Metadata comes from the joined FloorRoom
 * when available, else from the REST floor list (so the switch is instant).
 */
import {
  type FloorTemplate,
  lobbyTemplate,
  officeL2Template,
  type Palette,
  paletteById,
  paletteForFloor,
  templateById,
} from "@regulus/floor-layout";
import type { FloorInfo, FloorState } from "@regulus/protocol";

export interface FloorView {
  /** Changes whenever the player must respawn (another floor). */
  key: string;
  template: FloorTemplate;
  /** Undefined = the canvas default (the lobby palette). */
  palette?: Palette;
  /** Undefined = the template's own name (the lobby). */
  floorName?: string;
}

export const LOBBY_VIEW: FloorView = { key: "lobby", template: lobbyTemplate };

export function floorViewFor(
  floorId: string | null,
  state: FloorState | null,
  info: FloorInfo | undefined,
): FloorView {
  if (!floorId) return LOBBY_VIEW;
  const live = state && state.floorId === floorId ? state : null;
  const meta = live ?? info;
  if (!meta) return LOBBY_VIEW;
  const template = templateById(meta.layoutTemplateId);
  return {
    key: `floor:${floorId}`,
    template: template && template.kind !== "lobby" ? template : officeL2Template,
    palette: paletteById(meta.paletteId) ?? paletteForFloor(info?.index ?? 1),
    floorName: meta.name,
  };
}
