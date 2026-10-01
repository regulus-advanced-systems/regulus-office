/**
 * Furniture by model id (#183): `<LairModels>` draws any list of generator
 * items (model id, footprint, heading) instanced, with the consoles' lamps
 * blinking; `LAIR_MODEL_COMPONENTS` is the published id → component map for
 * one-off use (`<LAIR_MODEL_COMPONENTS.console rect={...} heading={...} />`).
 */
import type { Rect } from "@regulus/room-layout";
import { type ComponentType, useMemo } from "react";
import { LAIR_MODEL_IDS, LAIR_MODELS, type LairModelId, lairModelPlacement } from "../models.ts";
import type { PiecePlacement } from "../placements.ts";
import { BlinkingLamps, type WorldLamp, worldLamps } from "./BlinkingLamps.tsx";
import { BlobShadows } from "./BlobShadows.tsx";
import { PieceSet } from "./InstancedPieces.tsx";

export interface LairModelItem {
  id: LairModelId;
  rect: Rect;
  heading: number;
}

/** Placements and blinking lamps for a list of generator items (pure). */
export function lairModelScene(items: readonly LairModelItem[]): {
  pieces: PiecePlacement[];
  lamps: WorldLamp[];
} {
  const pieces: PiecePlacement[] = [];
  const lamps: WorldLamp[] = [];
  for (const item of items) {
    const p = lairModelPlacement(item.id, item.rect, item.heading);
    pieces.push(p);
    const sockets = LAIR_MODELS[item.id].lamps;
    if (sockets) lamps.push(...worldLamps([p], sockets));
  }
  return { pieces, lamps };
}

export function LairModels({ items }: { items: readonly LairModelItem[] }) {
  const { pieces, lamps } = useMemo(() => lairModelScene(items), [items]);
  return (
    <group name="lair:models">
      <PieceSet items={pieces} />
      <BlobShadows items={pieces} />
      <BlinkingLamps lamps={lamps} />
    </group>
  );
}

export interface LairModelProps {
  rect: Rect;
  heading: number;
}

function componentFor(id: LairModelId): ComponentType<LairModelProps> {
  function LairModelComponent({ rect, heading }: LairModelProps) {
    const items = useMemo(() => [{ id, rect, heading }], [rect, heading]);
    return <LairModels items={items} />;
  }
  LairModelComponent.displayName = `LairModel(${id})`;
  return LairModelComponent;
}

/** The published id → component map: one component per generator model id. */
export const LAIR_MODEL_COMPONENTS = Object.fromEntries(
  LAIR_MODEL_IDS.map((id) => [id, componentFor(id)]),
) as Readonly<Record<LairModelId, ComponentType<LairModelProps>>>;
