/**
 * What `generateRoom` returns (#182): a `FloorTemplate` (the shape the scene,
 * nav grid, validation and server already use) plus a `room` record with
 * the generator's inputs, the desks, materials, lighting and model ids.
 */
import type { DecorStyle } from "@regulus/protocol";
import type { CompassDirection, Pose } from "../geometry.ts";
import type { FloorTemplate, Palette } from "../types.ts";

export interface GenerateRoomInput {
  /** Tiles along x (1 tile = 2 m), 4..12. */
  readonly width: number;
  /** Tiles along z, 4..12. */
  readonly depth: number;
  readonly doorSide: CompassDirection;
  /** 1..maxDeskCount(width, depth). */
  readonly deskCount: number;
  readonly decorStyle: DecorStyle;
}

export interface RoomDesk {
  /** `d<n>`. */
  readonly id: string;
  /** 1-based desk number. */
  readonly number: number;
  /** The table obstacle id. */
  readonly tableId: string;
  /** `d<n>s1` .. `d<n>s4`. */
  readonly seatIds: readonly string[];
}

export type RoomLightKind = "pendant" | "lamp" | "accent";

/** A pooled point light (SPEC §12: a few per visible room). */
export interface RoomLight {
  readonly id: string;
  readonly kind: RoomLightKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: string;
  readonly intensity: number;
  /** Fall-off distance, metres. */
  readonly range: number;
}

export interface RoomLighting {
  /** Hemisphere light. */
  readonly sky: string;
  readonly ground: string;
  readonly ambient: number;
  readonly lights: readonly RoomLight[];
}

export interface RoomMaterials {
  readonly floor: string;
  readonly wall: string;
  /** Colours for today's toon materials (same shape as the floor palettes). */
  readonly palette: Palette;
}

export interface RoomInfo {
  readonly width: number;
  readonly depth: number;
  readonly doorSide: CompassDirection;
  readonly deskCount: number;
  readonly maxDeskCount: number;
  readonly decorStyle: DecorStyle;
  /** The door: its frame wall, span along its side (metres) and the pose just inside. */
  readonly door: {
    readonly wallId: string;
    readonly side: CompassDirection;
    readonly start: number;
    readonly end: number;
    readonly pose: Pose;
  };
  readonly desks: readonly RoomDesk[];
  readonly materials: RoomMaterials;
  readonly lighting: RoomLighting;
  /**
   * Model id for every obstacle, decor item, wall decor item and wall anchor
   * (by id), and for every seat's chair (by seat id). The art kit (#183)
   * swaps models by these ids; function never depends on them.
   */
  readonly models: Readonly<Record<string, string>>;
}

export interface RoomLayout extends FloorTemplate {
  readonly room: RoomInfo;
}
