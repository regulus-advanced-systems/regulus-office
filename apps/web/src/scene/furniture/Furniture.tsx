/**
 * Places every obstacle, seat chair and the elevator from the floor template
 * (SPEC §9.1): Kenney GLBs where the catalog has one, boxes otherwise.
 */
import {
  type FloorTemplate,
  type ObstacleKind,
  type Palette,
  wallById,
} from "@regulus/floor-layout";
import { chairForSeat, FURNITURE_MODELS, PLACEHOLDER_HEIGHTS, smallPlantUrl } from "./catalog.ts";
import { GltfProp } from "./GltfProp.tsx";
import { Bookshelf, Planter, PropLayer } from "./LivedIn.tsx";
import { ElevatorBank, Jukebox, PlaceholderBox } from "./Procedural.tsx";
import {
  furnitureHeading,
  propTargetHeight,
  restingHeight,
  SEAT_FOOTPRINT,
  visualFootprint,
} from "./placement.ts";
import { WallDecor } from "./WallDecor.tsx";

export interface FurnitureProps {
  template: FloorTemplate;
  palette: Palette;
}

const heightOfKind = (kind: ObstacleKind) =>
  FURNITURE_MODELS[kind]?.targetHeight ?? PLACEHOLDER_HEIGHTS[kind];

export function Furniture({ template, palette }: FurnitureProps) {
  return (
    <group name="furniture">
      {template.obstacles.map((o) => {
        const rect = visualFootprint(o, template.seats);
        const heading = furnitureHeading(o, template.seats, template.size);
        if (o.kind === "jukebox") return <Jukebox key={o.id} rect={rect} heading={heading} />;
        if (o.kind === "bookshelf")
          return <Bookshelf key={o.id} rect={rect} heading={heading} palette={palette} />;
        if (o.kind === "planter")
          return <Planter key={o.id} id={o.id} rect={rect} palette={palette} />;
        const base = FURNITURE_MODELS[o.kind];
        const spec =
          base && o.kind === "plant_small" ? { ...base, url: smallPlantUrl(o.id) } : base;
        const y = restingHeight(o, template.obstacles, heightOfKind);
        if (spec)
          return (
            <GltfProp
              key={o.id}
              spec={spec}
              targetHeight={propTargetHeight(o.kind, rect, spec.targetHeight)}
              rect={rect}
              heading={heading}
              palette={palette}
              y={y}
            />
          );
        return (
          <PlaceholderBox
            key={o.id}
            rect={rect}
            height={PLACEHOLDER_HEIGHTS[o.kind]}
            palette={palette}
          />
        );
      })}
      {template.seats.map((s) => {
        const spec = chairForSeat(s.kind);
        if (!spec) return null;
        const half = SEAT_FOOTPRINT / 2;
        const rect = {
          x: s.pose.x - half,
          z: s.pose.z - half,
          w: SEAT_FOOTPRINT,
          d: SEAT_FOOTPRINT,
        };
        return (
          <GltfProp
            key={`seat-${s.id}`}
            spec={spec}
            rect={rect}
            heading={s.pose.heading}
            palette={palette}
          />
        );
      })}
      <PropLayer template={template} palette={palette} />
      <WallDecor template={template} palette={palette} />
      <ElevatorBank
        elevator={template.elevator}
        wall={wallById(template, template.elevator.wallId)}
      />
    </group>
  );
}
